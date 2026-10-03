/**
 * Sighting persistence.
 *
 * Local-first and offline-complete: no account, no network, no server id.
 * The client UUID generated here is the record's identity for its whole life —
 * it becomes the sync idempotency key in Phase 6 and the ledger reference in
 * Phase 7, and it is never regenerated.
 *
 * Every sighting carries `packId`, `packVersion` and a `speciesSnapshot`, so a
 * later taxonomic split cannot orphan the log — and the snapshot carries
 * `sensitivity` so export never has to resolve the species to decide whether
 * to generalize its coordinates.
 */
import { db, getInstallId, type Photo, type Sighting, type StoredSpecies } from '../../data/db'
import { assessClock, tzOffsetMinutes } from './clock'
import { softDelete, toRow, type CapturedPhoto } from './photo-store'
import { recordUserDataCounts } from '../../data/integrity'
import { resolve } from '../../data/localized'

export interface DraftSighting {
  species?: StoredSpecies
  count: number
  notes: string
  at?: number
  lat?: number
  lng?: number
  accuracy?: number
  tripId?: string
  photos: CapturedPhoto[]
}

/**
 * Thrown when the sighting committed but one or more photos did not fit.
 * `sightingId` is carried so the screen can offer a photo-only retry instead
 * of re-running the whole save, which would mint a second record.
 */
export class QuotaError extends Error {
  constructor(
    public readonly sightingId: string,
    public readonly failedPhotoIds: string[],
    public readonly storedPhotoIds: string[],
  ) {
    super('quota-exceeded')
    this.name = 'QuotaError'
  }
}

/**
 * Dexie reports a failed `bulkPut` as a BulkError whose per-row causes live in
 * `failures`, so the real QuotaExceededError is never the top-level error.
 * Checking only the outer name would miss every quota failure that occurs on
 * the path this handling exists for.
 */
function isQuotaFailure(e: unknown): boolean {
  const err = e as { name?: string; message?: string; inner?: unknown; failures?: unknown[] } | null
  if (!err || typeof err !== 'object') return false
  if (err.name === 'QuotaExceededError') return true
  if (typeof err.message === 'string' && /quota/i.test(err.message)) return true
  if (err.inner && isQuotaFailure(err.inner)) return true
  return Array.isArray(err.failures) && err.failures.some(isQuotaFailure)
}

function snapshot(species: StoredSpecies) {
  return {
    sciName: species.sciName,
    commonName: resolve(species.commonNames),
    sensitivity: species.sensitivity,
  }
}

export function buildSighting(draft: DraftSighting, installId: string, clockConfidence: Sighting['clockConfidence'], id: string): Sighting {
  const at = draft.at ?? Date.now()
  return {
    id,
    installId,
    speciesId: draft.species?.id,
    packId: draft.species?.packId,
    packVersion: draft.species?.packVersion,
    speciesSnapshot: draft.species ? snapshot(draft.species) : undefined,
    count: draft.count,
    at,
    tzOffsetMinutes: tzOffsetMinutes(new Date(at)),
    clockConfidence,
    lat: draft.lat,
    lng: draft.lng,
    accuracy: draft.accuracy,
    notes: draft.notes,
    tripId: draft.tripId,
    syncState: 'local',
    clientVersion: 1,
    updatedAt: Date.now(),
  }
}

/**
 * Writes the sighting and all its photos in ONE transaction.
 *
 * On quota exhaustion the sighting is committed on its own and the photos are
 * retried individually, so the user is told exactly which did not persist. The
 * app must never report a save that did not commit, and must never silently
 * drop a photo — the animal is gone and cannot be re-photographed.
 */
export async function saveSighting(draft: DraftSighting): Promise<{ id: string; storedPhotos: number }> {
  const installId = await getInstallId()
  const clockConfidence = await assessClock()
  const id = crypto.randomUUID()
  const sighting = buildSighting(draft, installId, clockConfidence, id)
  const rows: Photo[] = draft.photos.map((p) => toRow(p, id))

  try {
    await db.transaction('rw', db.sightings, db.photos, async () => {
      await db.sightings.put(sighting)
      if (rows.length) await db.photos.bulkPut(rows)
    })
    await recordUserDataCounts()
    return { id, storedPhotos: rows.length }
  } catch (e) {
    if (!isQuotaFailure(e)) throw e
  }

  // Quota path: keep the observation, salvage what photos fit.
  try {
    await db.sightings.put(sighting)
  } catch (inner) {
    // Even the row itself will not fit. Say so plainly rather than reporting
    // a partial success the user cannot act on.
    throw new Error(`storage-full: ${(inner as Error).message}`)
  }

  const stored = new Set<string>()
  for (const row of rows) {
    try {
      await db.photos.put(row)
      stored.add(row.id)
    } catch {
      // Out of room for this one; reported below.
    }
  }
  await recordUserDataCounts()

  const failed = rows.filter((r) => !stored.has(r.id)).map((r) => r.id)
  if (failed.length) throw new QuotaError(id, failed, [...stored])
  return { id, storedPhotos: stored.size }
}

/** Retry only the photos that did not fit, against an already-saved sighting. */
export async function retryPhotos(sightingId: string, photos: CapturedPhoto[]): Promise<string[]> {
  const failed: string[] = []
  for (const p of photos) {
    try {
      await db.photos.put(toRow(p, sightingId))
    } catch {
      failed.push(p.id)
    }
  }
  await recordUserDataCounts()
  return failed
}

/** Resolve a Needs-ID record to a species, keeping its photos and notes. */
export async function resolveSpecies(sightingId: string, species: StoredSpecies): Promise<void> {
  const current = await db.sightings.get(sightingId)
  if (!current) return
  await db.sightings.update(sightingId, {
    speciesId: species.id,
    packId: species.packId,
    packVersion: species.packVersion,
    speciesSnapshot: snapshot(species),
    clientVersion: current.clientVersion + 1,
    updatedAt: Date.now(),
    syncState: 'local',
  })
}

export async function updateSighting(id: string, patch: Partial<Sighting>): Promise<void> {
  const current = await db.sightings.get(id)
  if (!current) return
  await db.sightings.update(id, {
    ...patch,
    clientVersion: current.clientVersion + 1,
    updatedAt: Date.now(),
    syncState: 'local',
  })
}

/**
 * Tombstone rather than hard-delete: the photo rows hold untouched originals,
 * and Phase 6 union-merges tombstones across devices.
 */
export async function deleteSighting(id: string): Promise<void> {
  await db.transaction('rw', db.sightings, db.photos, db.syncQueue, async () => {
    const photos = await db.photos.where('sightingId').equals(id).toArray()
    for (const p of photos) {
      if (!p.deletedAt) await softDelete(p.id)
    }
    // A signed-in record may exist on the server: queue the tombstone so the
    // sync engine can send it (the engine treats "never existed" as done).
    const existing = await db.sightings.get(id)
    if (existing?.userId) {
      await db.syncQueue.put({ id: `delete:${id}`, kind: 'sighting', refId: id, op: 'delete', attempts: 0, queuedAt: Date.now() })
    }
    await db.sightings.delete(id)
  })
  await recordUserDataCounts()
}

export async function listSightings(): Promise<Sighting[]> {
  return db.sightings.orderBy('at').reverse().toArray()
}

/** Records with no species yet — resolved at camp, not in the field. */
export async function listNeedsId(): Promise<Sighting[]> {
  return (await listSightings()).filter((s) => !s.speciesId)
}

export interface DayGroup {
  key: string
  /** Representative instant for the group, already offset-corrected. */
  at: number
  items: Sighting[]
}

export function groupByDay(sightings: Sighting[]): DayGroup[] {
  const groups = new Map<string, Sighting[]>()
  for (const s of sightings) {
    // Group by the sighting's OWN local day, using its stored offset — not the
    // reader's current timezone, which may differ after travelling home.
    const local = new Date(s.at + s.tzOffsetMinutes * 60_000)
    const key = local.toISOString().slice(0, 10)
    const list = groups.get(key) ?? []
    list.push(s)
    groups.set(key, list)
  }
  return [...groups.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([key, items]) => ({
      key,
      // Render the heading from a real instant in the group so formatting in
      // the reader's locale cannot shift the date across a UTC boundary.
      at: items[0]!.at + items[0]!.tzOffsetMinutes * 60_000,
      items,
    }))
}
