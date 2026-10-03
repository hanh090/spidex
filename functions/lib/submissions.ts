/**
 * Community pack submissions — shared between the public
 * /api/submissions/* routes (authors) and /api/admin/* moderation.
 *
 * Storage model: a signed-in author declares a pack (`POST /api/submissions`)
 * then uploads its files one request each (`PUT .../files?path=`) — individual
 * pack files are small enough that no multipart machinery is needed. Objects
 * land at `submissions/<submissionId>/<path>` in the PACKS bucket — a staging
 * area that is never served. Approval writes a `kind='pack'` D1 row whose
 * meta.prefix points at that staging prefix, and both the catalogue merge
 * (packs/index.json) and the asset route (packs/[[path]]) serve through that
 * row. Withdraw/reject only ever delete the submission's own staging prefix,
 * so a live pack can neither be overwritten nor wiped by a later submission.
 * Community packs approved before staging existed carry no meta.prefix and
 * keep serving from `packs/<packId>/`.
 *
 * Submission bookkeeping reuses admin_resources rows with kind='submission'
 * — no extra migration.
 */
import { isNdLicense } from './license'

/** Slug rules match what the author tooling generates: lowercase, dashes. */
export const PACK_ID_RE = /^[a-z0-9][a-z0-9-]{0,62}$/

/**
 * Ids that would collide with a static top-level path or a cache-key segment
 * (pack-download matches on `/<id>/`), so no pack may claim them.
 */
export const RESERVED_PACK_IDS: ReadonlySet<string> = new Set([
  'img', 'audio', 'fonts', 'packs', 'icons', 'assets', 'submissions', 'index',
])

export function isValidPackId(id: string): boolean {
  return PACK_ID_RE.test(id) && !RESERVED_PACK_IDS.has(id)
}

/** R2 staging prefix for one submission (trailing slash excluded). */
export const submissionPrefix = (submissionId: string) => `submissions/${submissionId}`

/**
 * A static-assets hit counts only when it is a real file. Pages answers a
 * missing path with the SPA fallback (200 text/html), which must read as a miss.
 */
export function isRealAsset(res: Response): boolean {
  return res.ok && !(res.headers.get('Content-Type') ?? '').toLowerCase().startsWith('text/html')
}

/**
 * What may be uploaded into a pack: the two data files, images (SVG included —
 * bundled packs use SVG plates), audio and fonts, and nothing else. No
 * html/js can be served from a pack path, and every response from the bucket
 * carries CSP `script-src 'none'`, which keeps uploaded SVG inert same-origin.
 */
const ALLOWED_TOP = /^(pack\.json|species\.ndjson|img\/|audio\/|fonts\/)/

/** Known extensions serve their real type; anything else is octet-stream. */
export const CONTENT_TYPES: Record<string, string> = {
  '.json': 'application/json',
  '.ndjson': 'application/x-ndjson',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.avif': 'image/avif',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/opus',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
}

export const MAX_FILE_BYTES = 100 * 1024 * 1024 // per-request ceiling
export const MAX_TOTAL_BYTES = 600 * 1024 * 1024 // one pack, all tiers
export const MAX_FILES = 8000
export const MAX_PENDING_PER_USER = 3

export interface SubmissionMeta {
  packId: string
  note?: string
  submitter: { userId: string; email: string }
  status: 'uploading' | 'pending' | 'published' | 'rejected' | 'withdrawn'
  fileCount: number
  totalBytes: number
  receivedFiles: number
  receivedBytes: number
  issues?: { path: string; message: string }[]
  summary?: {
    name?: { en: string }
    region?: string
    taxonGroup?: string
    version?: number
    speciesCount?: number
    sizeBytes?: { thumb: number; full: number }
  }
  reviewedBy?: string
  reviewedAt?: number
}

/**
 * Delete every object under `prefix/` (paginated: R2 lists at most 1000 per
 * call, a pack may hold MAX_FILES). Guarded so a malformed prefix can never
 * widen into the bucket root.
 */
export async function deletePrefix(
  bucket: { list: (o?: any) => Promise<any>; delete: (k: any) => Promise<any> },
  prefix: string,
): Promise<number> {
  if (!isSafePackPrefix(prefix)) throw new Error(`refusing to delete prefix "${prefix}"`)
  let deleted = 0
  let cursor: string | undefined
  do {
    const page: any = await bucket.list({ prefix: `${prefix}/`, cursor })
    const keys: string[] = (page.objects ?? []).map((o: { key: string }) => o.key)
    if (keys.length) {
      await bucket.delete(keys)
      deleted += keys.length
    }
    cursor = page.truncated ? page.cursor : undefined
  } while (cursor)
  return deleted
}

export function sanitizePath(raw: string): string | null {
  const p = raw.trim().replace(/^\/+/, '')
  if (!p || p.length > 220) return null
  if (p.includes('..') || p.includes('//') || p.includes('\\')) return null
  if (!/^[a-zA-Z0-9._/-]+$/.test(p)) return null
  if (!ALLOWED_TOP.test(p)) return null
  const ext = p.slice(p.lastIndexOf('.')).toLowerCase()
  if (!CONTENT_TYPES[ext]) return null
  return p
}

export function contentType(path: string): string {
  const ext = path.slice(path.lastIndexOf('.')).toLowerCase()
  return CONTENT_TYPES[ext] ?? 'application/octet-stream'
}

export interface CommunityPackRow {
  published: boolean
  meta: {
    community?: boolean
    /** R2 prefix serving this pack; absent on packs approved before staging. */
    prefix?: string
    submittedBy?: { userId?: string; email?: string }
    [k: string]: unknown
  }
}

/**
 * R2 prefixes a community pack may be served from, uploaded into or swept:
 * `submissions/<id>` (staging) or `packs/<id>` (legacy). Anything else — above
 * all `user-photos/<userId>`, which holds private data in the same bucket — is
 * never a pack prefix, however the admin row's meta came to say so.
 */
const SAFE_PACK_PREFIX = /^(submissions|packs)\/[A-Za-z0-9_-]+$/
export const isSafePackPrefix = (p: unknown): p is string => typeof p === 'string' && SAFE_PACK_PREFIX.test(p)

/** Where a community pack's files live in R2; an unsafe meta.prefix falls back to packs/<id>. */
export function servingPrefix(packId: string, meta: CommunityPackRow['meta']): string {
  return isSafePackPrefix(meta.prefix) ? meta.prefix : `packs/${packId}`
}

export interface CatalogueRow { id: string; published: boolean; community: boolean }

/**
 * Apply publish flags to the static catalogue index: unpublished ids are
 * hidden everywhere; published community rows unknown to the static index join
 * at the end (only when the bucket that serves them exists).
 */
export function mergeCatalogue(
  index: { packs?: string[]; featured?: string[]; [k: string]: unknown },
  rows: CatalogueRow[],
  includeCommunity: boolean,
) {
  const base = index.packs ?? []
  const hidden = new Set(rows.filter((r) => !r.published).map((r) => r.id))
  const community = includeCommunity
    ? rows.filter((r) => r.published && r.community && !base.includes(r.id)).map((r) => r.id)
    : []
  return {
    ...index,
    packs: [...base.filter((id) => !hidden.has(id)), ...community],
    featured: (index.featured ?? []).filter((id) => !hidden.has(id)),
  }
}

/**
 * Read the D1 row for a pack id. Community packs carry meta.community; the
 * published flag on the row is the single gate both the catalogue merge and
 * the asset route consult.
 */
export async function communityPackRow(
  db: any,
  packId: string,
): Promise<CommunityPackRow | null> {
  const row = await db
    .prepare("SELECT published, meta FROM admin_resources WHERE id = ? AND kind = 'pack'")
    .bind(packId)
    .first()
  if (!row) return null
  let meta: CommunityPackRow['meta'] = {}
  try { meta = JSON.parse((row as any).meta) } catch { /* keep {} */ }
  return { published: !!(row as any).published, meta }
}

/**
 * Light manifest check run inside a Function — deliberately a shape check,
 * not the full zod contract: the app's download path re-validates strictly
 * before anything is committed, so a pack that lies here fails loudly for the
 * first downloader rather than silently for everyone. What this catches is
 * malformed uploads, wrong ids and missing attribution — the review signals.
 */
export function checkManifest(raw: unknown, expectedId: string): string[] {
  const issues: string[] = []
  const m = raw as any
  if (!m || typeof m !== 'object') return ['pack.json is not an object']
  if (m.id !== expectedId) issues.push(`id "${m.id}" does not match declared "${expectedId}"`)
  if (!m.name?.en || typeof m.name.en !== 'string') issues.push('name.en missing')
  if (!m.taxonGroup) issues.push('taxonGroup missing')
  if (!m.region) issues.push('region missing')
  if (!Number.isInteger(m.version) || m.version < 1) issues.push('version must be a positive integer')
  if (!m.traitSchema?.traits?.length) issues.push('traitSchema.traits missing')
  if (!m.license) issues.push('license missing')
  if (!Number.isInteger(m.speciesCount)) issues.push('speciesCount must be an integer')
  return issues
}

/** Per-record check on species.ndjson: JSON shape plus attribution presence. */
export function checkSpeciesNdjson(text: string): { issues: string[]; count: number } {
  const issues: string[] = []
  let count = 0
  text.split('\n').forEach((line, i) => {
    const t = line.trim()
    if (!t) return
    count++
    try {
      const sp = JSON.parse(t)
      if (!sp.id || !sp.sciName) issues.push(`line ${i + 1}: id/sciName missing`)
      if (!Array.isArray(sp.images) || !sp.images.length) {
        issues.push(`line ${i + 1}: no images`)
      } else if (sp.images.some((im: any) => !im.credit || !im.license)) {
        issues.push(`line ${i + 1}: image without credit/license`)
      } else if (sp.images.some((im: any) => isNdLicense(String(im.license)))) {
        // Plates are redrawn from their sources, which a NoDerivatives licence forbids.
        issues.push(`line ${i + 1}: NoDerivatives image licence is not allowed`)
      }
      // Links are rendered as <a href>: only http(s), never javascript:/data:.
      const links = (Array.isArray(sp.sounds) ? sp.sounds : []).flatMap((s: any) => [s?.sourceUrl, s?.licenseUrl])
      if (links.some((u: unknown) => u != null && !(typeof u === 'string' && /^https?:\/\//i.test(u)))) {
        issues.push(`line ${i + 1}: sound link must be an http(s) URL`)
      }
    } catch {
      issues.push(`line ${i + 1}: not valid JSON`)
    }
  })
  return { issues: issues.slice(0, 50), count }
}
