/**
 * Tiered pack download.
 *
 * Thumbnail tier first — small and immediately useful offline. The full tier
 * is a separate opt-in, and it is gated on real storage headroom because it is
 * large enough to trigger the per-origin eviction that would take the user's
 * photos with it.
 */
import { db, getActivePackId, setActivePackId, speciesUid, type StoredPack, type StoredSpecies } from './db'
import { parseManifest, parseSpeciesNdjson, type PackManifest, type ValidationIssue } from './pack-manifest'
import { buildSearchBlob } from './search-index'
import { applyIdRemap } from './pack-update'
import { estimate, requestPersist, type PersistState } from '../lib/storage'
import { PACK_IMAGE_CACHE } from './cache-names'

export interface Progress {
  phase: 'manifest' | 'species' | 'images' | 'index' | 'done'
  done: number
  total: number
}

export interface DownloadResult {
  ok: boolean
  packId?: string
  issues?: ValidationIssue[]
  error?: string
}

export { PACK_IMAGE_CACHE } from './cache-names'

/** Refuse the full tier unless this much of the quota would remain free. */
const FULL_TIER_HEADROOM = 0.25

export async function fetchManifest(baseUrl: string): Promise<{ ok: true; manifest: PackManifest } | { ok: false; issues?: ValidationIssue[]; error?: string }> {
  try {
    const res = await fetch(`${baseUrl}/pack.json`, { cache: 'no-store' })
    if (!res.ok) return { ok: false, error: `pack.json ${res.status}` }
    if (isHtml(res)) return { ok: false, error: 'pack.json not found' }
    const parsed = parseManifest(await res.json())
    return parsed.ok ? { ok: true, manifest: parsed.value } : { ok: false, issues: parsed.issues }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

/**
 * The SPA fallback answers unknown paths with 200 text/html, so `res.ok` alone
 * would cache index.html as an image or parse it as a manifest.
 */
export function isHtml(res: Response): boolean {
  return (res.headers.get('content-type') ?? '').toLowerCase().startsWith('text/html')
}

/** Only image/* (including svg+xml) and audio/* may enter the pack media cache. */
export function isMediaResponse(res: Response): boolean {
  const type = (res.headers.get('content-type') ?? '').toLowerCase()
  return type.startsWith('image/') || type.startsWith('audio/')
}

/** True when a cached URL lives under /packs/<packId>/ (not merely contains it). */
export function isPackKey(url: string, packId: string): boolean {
  try {
    return new URL(url).pathname.startsWith(`/packs/${packId}/`)
  } catch {
    return false
  }
}

export interface DownloadOptions {
  baseUrl: string
  tier?: 'thumb' | 'full'
  onProgress?: (p: Progress) => void
  signal?: AbortSignal
  /** Set when the user has acknowledged that storage may be reclaimed. */
  acknowledgedNoPersist?: boolean
}

/**
 * Downloads a pack. Nothing is committed to `packs` until species and images
 * are written, so an interruption leaves no half-usable pack — Explore either
 * has a complete pack or none.
 */
export async function downloadPack(opts: DownloadOptions): Promise<DownloadResult> {
  const { baseUrl, tier = 'thumb', onProgress, signal } = opts
  const report = (p: Progress) => onProgress?.(p)

  report({ phase: 'manifest', done: 0, total: 1 })
  const m = await fetchManifest(baseUrl)
  if (!m.ok) return { ok: false, issues: m.issues, error: m.error }
  const manifest = m.manifest

  // Ask for persistence here — the user has just chosen to download, which is
  // the engagement the browser's heuristic is looking for.
  const persist: PersistState = await requestPersist()
  if (persist !== 'granted' && !opts.acknowledgedNoPersist) {
    return { ok: false, error: 'persist-refused' }
  }

  if (tier === 'full') {
    const est = await estimate()
    if (est && est.quota > 0) {
      const after = est.usage + manifest.sizeBytes.full
      if (after > est.quota * (1 - FULL_TIER_HEADROOM)) {
        return { ok: false, error: 'insufficient-headroom' }
      }
    }
  }

  // --- species -----------------------------------------------------------
  report({ phase: 'species', done: 0, total: manifest.speciesCount })
  let ndjson: string
  try {
    const res = await fetch(`${baseUrl}/species.ndjson`, { signal })
    if (!res.ok) return { ok: false, error: `species.ndjson ${res.status}` }
    if (isHtml(res)) return { ok: false, error: 'species.ndjson not found' }
    ndjson = await res.text()
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }

  const parsed = parseSpeciesNdjson(ndjson, manifest.traitSchema)
  if (!parsed.ok) return { ok: false, issues: parsed.issues }

  const rows: StoredSpecies[] = parsed.value.map((sp) => ({
    ...sp,
    uid: speciesUid(manifest.id, sp.id),
    packId: manifest.id,
    packVersion: manifest.version,
    searchBlob: buildSearchBlob(sp),
  }))

  // --- images ------------------------------------------------------------
  report({ phase: 'images', done: 0, total: rows.length })
  const cache = await caches.open(PACK_IMAGE_CACHE)
  let bytes = 0
  let done = 0

  // The service worker serves pack media CacheFirst under the same URL, so on a
  // version bump a plain fetch would just read the stale entry back. Evict the
  // old entry before fetching (restoring it if the refetch fails) and bypass
  // the HTTP cache, so changed media under an unchanged filename is refetched.
  const previous = await db.packs.get(manifest.id)
  const refresh = !!previous && previous.version !== manifest.version

  const cacheOne = async (url: string): Promise<void> => {
    const stale = refresh ? await cache.match(url) : undefined
    try {
      if (stale) await cache.delete(url)
      const res = await fetch(url, refresh ? { signal, cache: 'reload' } : { signal })
      if (!res.ok || !isMediaResponse(res)) throw new Error('not media')
      const buf = await res.clone().arrayBuffer()
      await cache.put(url, res)
      // Count what was actually stored, not what was fetched: a swallowed
      // quota failure here would otherwise over-report the pack's size.
      bytes += buf.byteLength
    } catch {
      // A missing image is a content defect, not a download failure: the
      // species still resolves and the gallery shows a not-downloaded state.
      // Keep the previous version's copy rather than leaving a hole.
      if (stale) await cache.put(url, stale).catch(() => undefined)
    }
  }

  // Trait referent images (bird size referents) belong to the schema, not to
  // any species — without these the referent-image control is blank offline.
  for (const trait of manifest.traitSchema.traits) {
    for (const opt of trait.options) {
      if (opt.img) await cacheOne(`${baseUrl}/${opt.img}`)
    }
  }

  // Bounded concurrency: a real pack is thousands of images and fully serial
  // fetches would take minutes on hotel wifi.
  const urls: string[] = []
  for (const sp of rows) {
    for (const im of sp.images) {
      urls.push(tier === 'full' && im.fullUrl ? `${baseUrl}/${im.fullUrl}` : `${baseUrl}/${im.thumbUrl}`)
    }
  }
  const POOL = 6
  let cursor = 0
  await Promise.all(Array.from({ length: POOL }, async () => {
    while (cursor < urls.length) {
      if (signal?.aborted) return
      const url = urls[cursor++]!
      await cacheOne(url)
      report({ phase: 'images', done: ++done, total: urls.length })
    }
  }))
  if (signal?.aborted) return { ok: false, error: 'aborted' }

  // --- commit ------------------------------------------------------------
  report({ phase: 'index', done: 0, total: 1 })
  const pack: StoredPack = {
    id: manifest.id,
    manifest,
    version: manifest.version,
    tier,
    installedAt: Date.now(),
    bytes,
  }
  // Species, pack and the sighting remap commit TOGETHER. A crash between a
  // pack bump and its remap would leave permanently orphaned sightings, so the
  // sightings table is part of this transaction rather than a follow-up.
  await db.transaction('rw', db.packs, db.species, db.sightings, async () => {
    const previous = await db.packs.get(manifest.id)
    await db.species.where('packId').equals(manifest.id).delete()
    await db.species.bulkPut(rows)
    await db.packs.put(pack)
    if (previous && previous.version !== manifest.version) {
      await applyIdRemap(manifest.id, manifest)
    }
  })

  // Scope only auto-advances when nothing is scoped — never steal focus from
  // a pack the user deliberately selected.
  if ((await getActivePackId()) === null) await setActivePackId(manifest.id)

  report({ phase: 'done', done: 1, total: 1 })
  return { ok: true, packId: manifest.id }
}

/** Removing a pack must state how many sightings reference it first. */
export async function packReferenceCount(packId: string): Promise<number> {
  return db.sightings.where('packId').equals(packId).count()
}

export async function deletePack(packId: string): Promise<void> {
  const cache = await caches.open(PACK_IMAGE_CACHE)
  const keys = await cache.keys()
  await Promise.all(keys.filter((k) => isPackKey(k.url, packId)).map((k) => cache.delete(k)))
  await db.transaction('rw', db.packs, db.species, db.favourites, async () => {
    await db.species.where('packId').equals(packId).delete()
    await db.favourites.where('packId').equals(packId).delete()
    await db.packs.delete(packId)
  })
  // Sightings are deliberately NOT deleted: they carry a speciesSnapshot and
  // stay readable without their pack.
  const active = await db.packs.toCollection().first()
  await setActivePackId(active?.id ?? null)
}
