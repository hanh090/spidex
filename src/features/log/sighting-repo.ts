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
import { getActiveUserId, visibleSightings } from '../auth/scope'
import { requestPersist } from '../../lib/storage'
import { assessClock, fromZonedInput, toZonedInput, tzOffsetMinutes } from './clock'
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

export function buildSighting(
  draft: DraftSighting,
  installId: string,
  clockConfidence: Sighting['clockConfidence'],
  id: string,
  userId?: string,
): Sighting {
  const at = draft.at ?? Date.now()
  return {
    id,
    installId,
    userId,
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
  // A signed-in user's new record is theirs from the start: sync and the
  // per-account views both key on userId.
  const sighting = buildSighting(draft, installId, clockConfidence, id, (await getActiveUserId()) ?? undefined)
  const rows: Photo[] = draft.photos.map((p) => toRow(p, id))

  try {
    await db.transaction('rw', db.sightings, db.photos, async () => {
      await db.sightings.put(sighting)
      if (rows.length) await db.photos.bulkPut(rows)
    })
    await recordUserDataCounts()
    // First record is the moment the user has data worth protecting; ask for
    // durable storage then (no-op once granted). Never blocks or fails the save.
    void requestPersist()
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

  void requestPersist()
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

/** The sync API rejects longer notes, so the forms stop there. */
export const NOTES_MAX = 5000

/**
 * The edit form's fields, held as the raw strings the inputs show.
 *
 * Comparing strings, not parsed values, is what keeps an untouched save a
 * no-op: the time input only holds minutes while `at` holds milliseconds, so
 * a parsed round-trip would differ from the stored value and spend a version.
 */
export interface EditDraft {
  notes: string
  count: number
  /** `YYYY-MM-DDTHH:mm`, in the sighting's own recorded offset. */
  time?: string
  /** Decimal degrees; both empty means "no position". */
  lat?: string
  lng?: string
  /** '' means no trip. */
  tripId?: string
}

/** The sync API rejects an `at` outside these bounds; the form stops there too. */
export const EARLIEST_AT = Date.UTC(2000, 0, 1)
const MAX_FUTURE_MS = 24 * 3600 * 1000

/** Raised when an edited field could not be saved as typed. */
export class SightingEditError extends Error {
  constructor(public readonly field: 'time' | 'position') {
    super(`invalid-${field}`)
    this.name = 'SightingEditError'
  }
}

/** The edit form, prefilled from a stored record. */
export function editDraftFrom(s: Pick<Sighting, 'notes' | 'count' | 'at' | 'tzOffsetMinutes' | 'lat' | 'lng' | 'tripId'>): Required<EditDraft> {
  return {
    notes: s.notes,
    count: s.count,
    time: toZonedInput(s.at, s.tzOffsetMinutes),
    lat: s.lat == null ? '' : String(s.lat),
    lng: s.lng == null ? '' : String(s.lng),
    tripId: s.tripId ?? '',
  }
}

/**
 * A typed position, or null for "no position". Throws when only one half is
 * given or either is out of range: the sync API would reject the record, and
 * a stored latitude without a longitude breaks every screen that shows it.
 */
export function parsePosition(lat: string, lng: string): { lat: number; lng: number } | null {
  const a = lat.trim()
  const b = lng.trim()
  if (!a && !b) return null
  // A decimal comma is how de and vi write numbers.
  const la = Number(a.replace(',', '.'))
  const lo = Number(b.replace(',', '.'))
  if (!a || !b || !Number.isFinite(la) || !Number.isFinite(lo) || Math.abs(la) > 90 || Math.abs(lo) > 180) {
    throw new SightingEditError('position')
  }
  return { lat: la, lng: lo }
}

type Editable = Pick<Sighting, 'notes' | 'count' | 'at' | 'tzOffsetMinutes' | 'clockConfidence' | 'lat' | 'lng' | 'accuracy' | 'tripId'>

/**
 * What an edit actually changes, or null when nothing did. Saving an untouched
 * form must not bump the version: that would queue a pointless upload and
 * could raise a sync conflict against another device.
 *
 * Fields the draft leaves out are not edited. A cleared position or trip is
 * returned as an explicit `undefined`, which removes the stored value.
 */
export function editPatch(
  current: Pick<Sighting, 'notes' | 'count'> & Partial<Editable>,
  draft: EditDraft,
  now = Date.now(),
): Partial<Editable> | null {
  const notes = draft.notes.trim().slice(0, NOTES_MAX)
  const count = Number.isFinite(draft.count) ? Math.max(1, Math.floor(draft.count)) : current.count
  const patch: Partial<Editable> = {}
  if (notes !== current.notes) patch.notes = notes
  if (count !== current.count) patch.count = count

  if (draft.time !== undefined && current.at !== undefined) {
    const offset = current.tzOffsetMinutes ?? 0
    if (draft.time !== toZonedInput(current.at, offset)) {
      const at = fromZonedInput(draft.time, offset)
      if (at === null || at < EARLIEST_AT || at > now + MAX_FUTURE_MS) throw new SightingEditError('time')
      patch.at = at
      // The time is now the observer's own statement, not the device clock's,
      // so a "check time" warning about that clock no longer applies.
      if (current.clockConfidence === 'suspect') patch.clockConfidence = 'trusted'
    }
  }

  if (draft.lat !== undefined || draft.lng !== undefined) {
    const was = { lat: current.lat == null ? '' : String(current.lat), lng: current.lng == null ? '' : String(current.lng) }
    const lat = draft.lat ?? was.lat
    const lng = draft.lng ?? was.lng
    if (lat.trim() !== was.lat || lng.trim() !== was.lng) {
      const pos = parsePosition(lat, lng)
      // "10.50" for a stored 10.5 is the same place, not an edit.
      if (pos?.lat !== current.lat || pos?.lng !== current.lng) {
        patch.lat = pos?.lat
        patch.lng = pos?.lng
        // Typed by hand: there is no GPS accuracy to report.
        patch.accuracy = undefined
      }
    }
  }

  if (draft.tripId !== undefined && (draft.tripId || undefined) !== current.tripId) {
    patch.tripId = draft.tripId || undefined
  }

  return Object.keys(patch).length ? patch : null
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
      await db.syncQueue.put({ id: `delete:${id}`, kind: 'sighting', refId: id, op: 'delete', userId: existing.userId, attempts: 0, queuedAt: Date.now() })
    }
    await db.sightings.delete(id)
  })
  await recordUserDataCounts()
}

export async function listSightings(): Promise<Sighting[]> {
  return (await visibleSightings()).sort((a, b) => b.at - a.at)
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
