/**
 * Admin "Media" API core — pack image management shared by the Pages Function
 * (functions/api/admin/[[catchall]].ts, R2 + D1 + ASSETS) and the Vite dev
 * server (server/auth/dev-auth-plugin.ts, local filesystem). Both supply a
 * MediaBackend; every rule below (validation, version bump, upload checks)
 * lives here once so dev and production cannot drift.
 *
 * Edit model. A bundled pack's pack.json + species.ndjson are static files in
 * git, so an edit never touches them: the edited copies are written to R2 at
 * overrides/<packId>/ and functions/packs/[[path]].ts serves those in
 * preference to the static files. The editor starts from whichever manifest
 * the public route serves (override only while its version is above the
 * deployed one, see pack-manifest-source.ts); when a deploy has superseded the
 * override the editor reads the deployed files and the next save writes a new
 * override at deployed+1. Every save bumps the manifest version by one so
 * clients see "update available". A community pack is edited in place under
 * its own prefix.
 *
 * Saves are optimistic: the body carries the manifest version the editor
 * started from (baseVersion), and a mismatch is a 409 so two admins cannot
 * silently overwrite each other.
 *
 * Media is immutable: an upload never overwrites an existing object. A replace
 * writes a content-derived name (<name>-<hash8>.<ext>) and the species entry
 * points at it, so clients only ever fetch URLs they do not already hold.
 *
 * Invariants enforced on save: every image carries credit + licence, no
 * NoDerivatives licence (plates are redrawn), aspects belong to the pack's
 * traitSchema, required aspects stay satisfied, and image URLs are relative
 * pack paths (the app resolves them against the pack's base URL; an absolute
 * URL would render broken for every user).
 */
import { contentType, sanitizePath } from './submissions'
import { manifestVersion, overrideIsLive } from './pack-manifest-source'

export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024
export const PAGE_SIZE = 40
const MAX_IMAGES_PER_SPECIES = 24
const MAX_TEXT = 500

/** Storage seam: R2/D1/ASSETS in production, the filesystem in dev. */
export interface MediaBackend {
  bundledIds(): Promise<string[]>
  /** Published community packs and the R2 prefix their files live under. */
  communityPacks(): Promise<{ id: string; prefix: string }[]>
  /** A file shipped in the deploy (git), or null. */
  readStatic(packId: string, file: string): Promise<string | null>
  staticExists(packId: string, rel: string): Promise<boolean>
  getObject(key: string): Promise<string | null>
  hasObject(key: string): Promise<boolean>
  putObject(key: string, body: string | Uint8Array, contentType: string): Promise<void>
}

export interface MediaRequest {
  method: string
  /** Path after /api/admin/media, e.g. /packs/bird-th/species. */
  path: string
  query: URLSearchParams
  contentType: string | null
  contentLength: number | null
  json(): Promise<unknown>
  bytes(): Promise<Uint8Array>
}

export interface MediaResult {
  status: number
  body: unknown
  audit?: { action: string; detail: string }
}

const ok = (body: unknown, audit?: MediaResult['audit']): MediaResult => ({ status: 200, body, audit })
const fail = (status: number, error: string, extra: object = {}): MediaResult => ({ status, body: { error, ...extra } })

/* ---- licence flags ----------------------------------------------------------- */

/** "CC-BY-ND", "CC BY-ND 4.0", "no derivatives" — token match, so "BY-NDX" does not count. */
export const isNdLicense = (l: string) => /(^|[\s_-])ND($|[\s_.-])/i.test(l) || /no\s*-?deriv/i.test(l)
export const isNcLicense = (l: string) => /(^|[\s_-])NC($|[\s_.-])/i.test(l) || /non\s*-?commercial/i.test(l)
/** A family archetype stand-in rather than a photo plate of the species. */
export const isArchetypeImage = (im: { thumbUrl?: string; fullUrl?: string }) =>
  /archetype/i.test(im.thumbUrl ?? '') || /archetype/i.test(im.fullUrl ?? '')

interface Flags { nc: boolean; nd: boolean; archetype: boolean }
const imageFlags = (im: any): Flags => ({
  nc: isNcLicense(String(im?.license ?? '')),
  nd: isNdLicense(String(im?.license ?? '')),
  archetype: isArchetypeImage(im ?? {}),
})

/* ---- ndjson helpers ---------------------------------------------------------- */

function parseLines(text: string): { raw: string; rec: any | null }[] {
  return text.split('\n').map((raw) => {
    if (!raw.trim()) return { raw, rec: null }
    try { return { raw, rec: JSON.parse(raw) } } catch { return { raw, rec: null } }
  })
}

/** Replace one species' images, leaving every other line byte-identical. */
export function replaceSpeciesImages(text: string, speciesId: string, images: unknown[]): string | null {
  let found = false
  const out = parseLines(text).map(({ raw, rec }) => {
    if (!rec || rec.id !== speciesId) return raw
    found = true
    return JSON.stringify({ ...rec, images })
  })
  return found ? out.join('\n') : null
}

/* ---- validation -------------------------------------------------------------- */

const REL_URL = /^(?!\/)(?!.*\.\.)[A-Za-z0-9._/-]+$/
/** Relative pack paths only: the app prefixes every image URL with the pack base. */
export const isSafeImageUrl = (u: unknown): u is string =>
  typeof u === 'string' && u.length > 0 && u.length <= 2048 && REL_URL.test(u)
const isAbsoluteUrl = (u: unknown) => typeof u === 'string' && /^[a-z][a-z0-9+.-]*:|^\/\//i.test(u)
const urlProblem = (field: string, v: unknown) =>
  isAbsoluteUrl(v)
    ? `${field} must be a relative pack path such as img/<file>, not an absolute URL (the app cannot load it)`
    : `${field} must be a relative pack path such as img/<file>`

export interface CleanImage {
  id: string; aspect: string; credit: string; license: string; thumbUrl: string; fullUrl?: string
}

export function validateImages(
  input: unknown,
  aspects: { required: string[]; optional?: string[] },
): { images: CleanImage[] } | { errors: string[] } {
  if (!Array.isArray(input)) return { errors: ['images must be an array'] }
  if (!input.length) return { errors: ['a species needs at least one image'] }
  if (input.length > MAX_IMAGES_PER_SPECIES) return { errors: [`at most ${MAX_IMAGES_PER_SPECIES} images`] }
  const allowed = new Set([...aspects.required, ...(aspects.optional ?? [])])
  const errors: string[] = []
  const images: CleanImage[] = []
  const ids = new Set<string>()
  const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '')

  input.forEach((raw: any, i) => {
    const at = `image ${i + 1}`
    const id = text(raw?.id), aspect = text(raw?.aspect), credit = text(raw?.credit), license = text(raw?.license)
    if (!id) errors.push(`${at}: id required`)
    else if (ids.has(id)) errors.push(`${at}: duplicate id "${id}"`)
    ids.add(id)
    if (!allowed.has(aspect)) errors.push(`${at}: aspect "${aspect}" is not in this pack's traitSchema`)
    if (!credit) errors.push(`${at}: credit required`)
    if (!license) errors.push(`${at}: license required`)
    if ([id, credit, license].some((s) => s.length > MAX_TEXT)) errors.push(`${at}: text too long`)
    if (license && isNdLicense(license)) errors.push(`${at}: NoDerivatives licences are not allowed`)
    if (!isSafeImageUrl(raw?.thumbUrl)) errors.push(`${at}: ${urlProblem('thumbUrl', raw?.thumbUrl)}`)
    const hasFull = raw?.fullUrl != null && raw.fullUrl !== ''
    if (hasFull && !isSafeImageUrl(raw.fullUrl)) errors.push(`${at}: ${urlProblem('fullUrl', raw.fullUrl)}`)
    images.push({
      id, aspect, credit, license, thumbUrl: raw?.thumbUrl,
      ...(hasFull ? { fullUrl: raw.fullUrl } : {}),
    })
  })

  const present = new Set(images.map((im) => im.aspect))
  for (const need of aspects.required) {
    if (!present.has(need)) errors.push(`missing required aspect "${need}"`)
  }
  return errors.length ? { errors } : { images }
}

/* ---- upload checks ----------------------------------------------------------- */

const IMG_PATH_EXT = /\.(webp|jpe?g|png|gif|avif)$/i

/** img/<file> under the existing pack-path rules; raster images only (no SVG). */
export function sanitizeUploadPath(raw: string): string | null {
  const p = sanitizePath(raw)
  return p && p.startsWith('img/') && IMG_PATH_EXT.test(p) ? p : null
}

/** Cheap magic-byte check so a renamed non-image cannot be stored as one. */
export function looksLikeImage(b: Uint8Array): boolean {
  const at = (o: number, s: string) => [...s].every((c, i) => b[o + i] === c.charCodeAt(0))
  return (
    (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) ||
    (b[0] === 0x89 && at(1, 'PNG')) ||
    at(0, 'GIF8') ||
    (at(0, 'RIFF') && at(8, 'WEBP')) ||
    // ISO-BMFF is also HEIC and MP4; only the AVIF brands are an image browsers decode here.
    (at(4, 'ftyp') && (at(8, 'avif') || at(8, 'avis')))
  )
}

/** First 8 hex chars of the SHA-256 of the bytes: the content-derived part of an immutable name. */
async function contentHash8(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>))
  return [...digest.slice(0, 4)].map((x) => x.toString(16).padStart(2, '0')).join('')
}

/* ---- pack access ------------------------------------------------------------- */

type PackFile = 'pack.json' | 'species.ndjson'

interface PackHandle {
  community: boolean
  uploadPrefix: string
  /** Reads are memoised per request: a listing would otherwise refetch each file. */
  read(file: PackFile): Promise<string | null>
  write(file: PackFile, text: string): Promise<void>
}

const PACK_ID = /^[a-z0-9][a-z0-9-]{0,62}$/

async function openPack(b: MediaBackend, id: string, community?: { id: string; prefix: string }[]): Promise<PackHandle | null> {
  if (!PACK_ID.test(id)) return null
  const memo = new Map<string, Promise<string | null>>()
  const memoised = (load: () => Promise<string | null>, key: string) => () => {
    let hit = memo.get(key)
    if (!hit) memo.set(key, (hit = load()))
    return hit
  }

  if ((await b.bundledIds()).includes(id)) {
    // The live copy is the one the public route serves: the override only while
    // its version is above the deployed one. The two manifests are read once and
    // reused when pack.json itself is then requested.
    const overrideManifest = memoised(() => b.getObject(`overrides/${id}/pack.json`), 'override')
    const shippedManifest = memoised(() => b.readStatic(id, 'pack.json'), 'shipped')
    const useOverride = async () => {
      const [override, shipped] = await Promise.all([overrideManifest(), shippedManifest()])
      return overrideIsLive(manifestVersion(override), manifestVersion(shipped))
    }
    return {
      community: false,
      uploadPrefix: `bundled/${id}`,
      read: async (f) => {
        const live = await useOverride()
        if (f === 'pack.json') return live ? overrideManifest() : shippedManifest()
        return memoised(() => (live ? b.getObject(`overrides/${id}/${f}`) : b.readStatic(id, f)), f)()
      },
      write: (f, text) => b.putObject(`overrides/${id}/${f}`, text, contentType(f)),
    }
  }
  const c = (community ?? (await b.communityPacks())).find((p) => p.id === id)
  if (!c) return null
  return {
    community: true,
    uploadPrefix: c.prefix,
    read: (f) => memoised(() => b.getObject(`${c.prefix}/${f}`), f)(),
    write: (f, text) => b.putObject(`${c.prefix}/${f}`, text, contentType(f)),
  }
}

async function readManifest(pack: PackHandle): Promise<any | null> {
  const t = await pack.read('pack.json')
  if (!t) return null
  try { return JSON.parse(t) } catch { return null }
}

/* ---- routes ------------------------------------------------------------------ */

export async function handleMedia(b: MediaBackend, req: MediaRequest): Promise<MediaResult> {
  const { method, path } = req
  // A malformed %-escape in an id is a bad request, not a server error.
  const dec = (v: string) => { try { return decodeURIComponent(v) } catch { return null } }
  const bad = () => fail(400, 'Malformed path')

  if (method === 'GET' && path === '/packs') return listPacks(b)

  const species = path.match(/^\/packs\/([^/]+)\/species$/)
  if (species && method === 'GET') {
    const id = dec(species[1]!)
    return id == null ? bad() : listSpecies(b, id, req.query)
  }

  const images = path.match(/^\/packs\/([^/]+)\/species\/([^/]+)\/images$/)
  if (images && method === 'PUT') {
    const [id, sp] = [dec(images[1]!), dec(images[2]!)]
    return id == null || sp == null ? bad() : saveImages(b, id, sp, req)
  }

  const upload = path.match(/^\/packs\/([^/]+)\/upload$/)
  if (upload && method === 'POST') {
    const id = dec(upload[1]!)
    return id == null ? bad() : uploadImage(b, id, req)
  }

  return fail(404, 'Not found')
}

/**
 * Subrequest budget (Workers Free allows 50 per invocation): one D1 query for
 * the community list, then at most two reads per pack (manifest, species) —
 * a bundled pack with a live override adds one more for the deployed manifest,
 * which the production backend caches per isolate.
 */
async function listPacks(b: MediaBackend): Promise<MediaResult> {
  const community = await b.communityPacks()
  const ids = [
    ...(await b.bundledIds()).map((id) => ({ id, community: false })),
    ...community.map((p) => ({ id: p.id, community: true })),
  ]
  const packs = []
  for (const { id, community: isCommunity } of ids) {
    const pack = await openPack(b, id, community)
    if (!pack) continue
    const manifest = await readManifest(pack)
    const ndjson = await pack.read('species.ndjson')
    if (!manifest || ndjson == null) { packs.push({ id, community: isCommunity, missing: true }); continue }
    const licenses: Record<string, number> = {}
    const counts = { images: 0, nc: 0, nd: 0, archetype: 0 }
    let speciesCount = 0
    for (const { rec } of parseLines(ndjson)) {
      if (!rec) continue
      speciesCount++
      for (const im of Array.isArray(rec.images) ? rec.images : []) {
        const f = imageFlags(im)
        counts.images++
        if (f.nc) counts.nc++
        if (f.nd) counts.nd++
        if (f.archetype) counts.archetype++
        const key = String(im?.license ?? '')
        licenses[key] = (licenses[key] ?? 0) + 1
      }
    }
    packs.push({ id, community: isCommunity, name: manifest.name, version: manifest.version, speciesCount, licenses, counts })
  }
  return ok({ packs })
}

type SpeciesFilter = 'all' | 'nc' | 'nd' | 'archetype'

async function listSpecies(b: MediaBackend, packId: string, query: URLSearchParams): Promise<MediaResult> {
  const pack = await openPack(b, packId)
  if (!pack) return fail(404, 'Pack not found')
  const ndjson = await pack.read('species.ndjson')
  if (ndjson == null) return fail(404, 'Pack data not found')

  const filter = (query.get('filter') ?? 'all') as SpeciesFilter
  if (!['all', 'nc', 'nd', 'archetype'].includes(filter)) return fail(400, 'Unknown filter')
  const q = (query.get('q') ?? '').trim().toLowerCase()
  const offset = Math.max(0, Number.parseInt(query.get('cursor') ?? '0', 10) || 0)

  const rows = []
  for (const { rec } of parseLines(ndjson)) {
    if (!rec?.id) continue
    const imgs: any[] = Array.isArray(rec.images) ? rec.images : []
    const flagged = imgs.map((im) => ({ ...im, flags: imageFlags(im) }))
    const flags = {
      nc: flagged.some((i) => i.flags.nc),
      nd: flagged.some((i) => i.flags.nd),
      archetype: flagged.some((i) => i.flags.archetype),
    }
    if (filter !== 'all' && !flags[filter]) continue
    const name = String(rec.commonNames?.en ?? '')
    if (q && !`${rec.id} ${rec.sciName ?? ''} ${name}`.toLowerCase().includes(q)) continue
    rows.push({ id: rec.id, sciName: rec.sciName ?? '', name, family: rec.family ?? '', flags, images: flagged })
  }
  const page = rows.slice(offset, offset + PAGE_SIZE)
  const next = offset + PAGE_SIZE < rows.length ? String(offset + PAGE_SIZE) : null
  const manifest = await readManifest(pack)
  return ok({
    species: page, total: rows.length, nextCursor: next,
    /** The manifest version this listing reflects; a save must send it back as baseVersion. */
    version: Number.isInteger(manifest?.version) ? manifest.version : 0,
    aspects: manifest?.traitSchema?.aspects ?? { required: [], optional: [] },
  })
}

async function saveImages(b: MediaBackend, packId: string, speciesId: string, req: MediaRequest): Promise<MediaResult> {
  const pack = await openPack(b, packId)
  if (!pack) return fail(404, 'Pack not found')
  const [manifest, ndjson] = [await readManifest(pack), await pack.read('species.ndjson')]
  if (!manifest || ndjson == null) return fail(404, 'Pack data not found')

  let body: any
  try { body = await req.json() } catch { return fail(400, 'Body must be JSON') }
  const current = Number.isInteger(manifest.version) ? manifest.version : 0
  if (!Number.isInteger(body?.baseVersion)) return fail(400, 'baseVersion (the pack version you loaded) is required')
  if (body.baseVersion !== current) {
    return fail(409, 'Someone else saved this pack since you loaded it. Reload and try again.', { version: current })
  }
  const checked = validateImages(body?.images, manifest.traitSchema?.aspects ?? { required: [] })
  if ('errors' in checked) return fail(400, checked.errors[0]!, { issues: checked.errors })

  const next = replaceSpeciesImages(ndjson, speciesId, checked.images)
  if (next == null) return fail(404, 'Species not found')
  const version = current + 1

  // Data first: a failure between the two writes leaves the old version number
  // on new data (a missed update prompt) rather than a bump with no change.
  await pack.write('species.ndjson', next)
  await pack.write('pack.json', JSON.stringify({ ...manifest, version }, null, 2))
  return ok({ ok: true, version, images: checked.images }, { action: 'media.images.save', detail: `${packId}:${speciesId}:v${version}` })
}

async function uploadImage(b: MediaBackend, packId: string, req: MediaRequest): Promise<MediaResult> {
  const pack = await openPack(b, packId)
  if (!pack) return fail(404, 'Pack not found')
  const rel = sanitizeUploadPath(req.query.get('path') ?? '')
  if (!rel) return fail(400, 'path must be img/<file> with a .webp/.jpg/.png/.gif/.avif name')

  const type = (req.contentType ?? '').split(';')[0]!.trim().toLowerCase()
  if (!type.startsWith('image/') || type === 'image/svg+xml') return fail(415, 'Only raster image/* uploads are accepted')
  if (req.contentLength != null && req.contentLength > MAX_UPLOAD_BYTES) return fail(413, 'Image too large (8 MB max)')

  const bytes = await req.bytes()
  if (!bytes.length) return fail(400, 'Empty body')
  if (bytes.length > MAX_UPLOAD_BYTES) return fail(413, 'Image too large (8 MB max)')
  if (!looksLikeImage(bytes)) return fail(415, 'File content is not a recognised image')

  // A file shipped in the deploy wins over the bucket when served, so writing
  // the same path would silently have no effect — never allow it.
  if (!pack.community && (await b.staticExists(packId, rel))) return fail(409, 'A shipped file already uses that path')

  // Media is immutable: an existing object is never overwritten, because
  // clients keep what they already fetched under that URL. With replace=1 the
  // new bytes get a content-derived name and the caller points the species at it.
  let finalRel = rel
  if (!(await b.hasObject(`${pack.uploadPrefix}/${rel}`))) {
    await b.putObject(`${pack.uploadPrefix}/${rel}`, bytes, contentType(rel))
  } else {
    if (req.query.get('replace') !== '1') return fail(409, 'File already exists (use replace=1 to store the new bytes under a new name)')
    const dot = rel.lastIndexOf('.')
    const hash = await contentHash8(bytes)
    // A name that already carries this content's hash holds these exact bytes.
    if (!rel.slice(0, dot).endsWith(`-${hash}`)) {
      finalRel = `${rel.slice(0, dot)}-${hash}${rel.slice(dot)}`
      if (!(await b.hasObject(`${pack.uploadPrefix}/${finalRel}`))) {
        await b.putObject(`${pack.uploadPrefix}/${finalRel}`, bytes, contentType(finalRel))
      }
    }
  }
  return ok({ ok: true, url: finalRel, renamed: finalRel !== rel }, { action: 'media.upload', detail: `${packId}:${finalRel}` })
}
