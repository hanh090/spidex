/**
 * On-launch integrity check — for pack data AND user data.
 *
 * Eviction is per-origin: it clears IndexedDB and Cache Storage together, so
 * checking only the pack would report "re-download available" while the user's
 * irreplaceable sightings and photos were silently gone.
 *
 * A pack loss is recoverable with a network. User-data loss is not, so it is
 * named explicitly rather than absorbed.
 */
import { db, getMeta, setMeta } from './db'
import { PACK_IMAGE_CACHE } from './pack-download'

export interface IntegrityReport {
  packs: { id: string; expectedSpecies: number; actualSpecies: number; sampledImages: number; missingImages: number }[]
  /** Counts the app last saw, versus what is present now. */
  userData: { expectedSightings: number; actualSightings: number; expectedPhotos: number; actualPhotos: number }
  packDataLost: boolean
  /** True when records the app previously counted are no longer present. */
  userDataLost: boolean
  online: boolean
}

const COUNTS_KEY = 'userDataHighWater'
interface Counts { sightings: number; photos: number }

/**
 * A HIGH-WATER mark, not a snapshot of current counts.
 *
 * Comparing against live counts would fire on every ordinary deletion, and a
 * loss alarm that cries wolf on routine use is exactly how a real eviction
 * gets ignored. The mark only rises; a deletion lowers the live count AND the
 * mark together, so only an unexplained drop is reported.
 */
export async function recordUserDataCounts(): Promise<void> {
  const counts: Counts = { sightings: await db.sightings.count(), photos: await db.photos.count() }
  await setMeta(COUNTS_KEY, counts)
}

export async function checkIntegrity(sampleSize = 8): Promise<IntegrityReport> {
  const packs = await db.packs.toArray()
  const cache = await caches.open(PACK_IMAGE_CACHE).catch(() => null)

  const packReports: IntegrityReport['packs'] = []
  let packDataLost = false

  for (const p of packs) {
    const actualSpecies = await db.species.where('packId').equals(p.id).count()
    const sample = await db.species.where('packId').equals(p.id).limit(sampleSize).toArray()
    let missing = 0
    let sampled = 0
    if (cache) {
      // The cache key is the absolute URL the download used, so build the same
      // key rather than resolving a relative path against the document base.
      const base = new URL(`/packs/${p.id}`, location.origin).toString()
      for (const sp of sample) {
        const im = sp.images[0]
        if (!im) continue
        sampled++
        const hit = await cache.match(`${base}/${im.thumbUrl}`).catch(() => undefined)
        if (!hit) missing++
      }
    }
    if (actualSpecies < p.manifest.speciesCount || (sampled > 0 && missing === sampled)) packDataLost = true
    packReports.push({
      id: p.id,
      expectedSpecies: p.manifest.speciesCount,
      actualSpecies,
      sampledImages: sampled,
      missingImages: missing,
    })
  }

  const expected = await getMeta<Counts>(COUNTS_KEY, { sightings: 0, photos: 0 })
  const actual: Counts = { sightings: await db.sightings.count(), photos: await db.photos.count() }
  const userDataLost = actual.sightings < expected.sightings || actual.photos < expected.photos

  return {
    packs: packReports,
    userData: {
      expectedSightings: expected.sightings,
      actualSightings: actual.sightings,
      expectedPhotos: expected.photos,
      actualPhotos: actual.photos,
    },
    packDataLost,
    userDataLost,
    online: navigator.onLine,
  }
}
