/**
 * Foreground sync engine.
 *
 * Runs only while the app is open (sign-in, `online`, focus, manual "Sync now")
 * — there is no background sync and no copy may imply otherwise. Order is
 * fixed: push queued deletes, push sightings, push photos (newest first), then
 * pull. Local stays the source of truth:
 *
 *  - only an `applied` result flips a record to `synced`;
 *  - a `stale` result becomes `conflict` and keeps the local edit;
 *  - a pull never overwrites a record that is not `synced`; if the server has
 *    something different it is parked as a conflict instead.
 *
 * Guests never reach this module: callers pass the signed-in user id, and only
 * records stamped with that id are touched.
 */
import { db, getMeta, setMeta, type Photo, type Sighting, type SyncState } from '../../data/db'
import {
  SyncHttpError, createSyncApi, type FetchLike, type PullPage, type PushRecord, type PushResult, type SyncApi,
} from './sync-api'
import { getConflict, saveConflict, sightingFromServer } from './conflict'

export type BadgeState = 'queued' | 'synced' | 'conflict' | 'failed'

/** The four states a user is shown, folded from the finer-grained stored one. */
export function badgeFor(state: SyncState): BadgeState {
  switch (state) {
    case 'synced': return 'synced'
    case 'conflict': return 'conflict'
    case 'failed':
    case 'needs_credits': return 'failed'
    default: return 'queued'
  }
}

const PENDING: ReadonlySet<SyncState> = new Set(['local', 'queued', 'uploading', 'failed', 'needs_credits'])
const PUSH_BATCH = 50

export interface SyncReport {
  ok: boolean
  /** The device had no connection; nothing was attempted or changed. */
  offline?: boolean
  /** The session is gone; the user must sign in again. */
  authExpired?: boolean
  error?: string
  pushed: number
  stale: number
  rejected: number
  photosUploaded: number
  photosDeleted: number
  needsCredits: number
  pulled: number
  conflicts: number
}

const emptyReport = (): SyncReport => ({
  ok: true, pushed: 0, stale: 0, rejected: 0, photosUploaded: 0, photosDeleted: 0, needsCredits: 0, pulled: 0, conflicts: 0,
})

/* ---- change notification ------------------------------------------------ */

const listeners = new Set<() => void>()
let running = false

/** Subscribe to "something about sync state changed". Returns the unsubscribe. */
export function onSyncChange(cb: () => void): () => void {
  listeners.add(cb)
  return () => { listeners.delete(cb) }
}
export const notifySyncChange = (): void => listeners.forEach((cb) => cb())
export const isSyncing = (): boolean => running

/* ---- status ------------------------------------------------------------- */

const lastSyncKey = 'sync.lastSyncAt'
const lastErrorKey = 'sync.lastError'
const cursorKey = (userId: string) => `sync.cursor.${userId}`

export const getLastSyncAt = () => getMeta<number | null>(lastSyncKey, null)
export const getLastError = () => getMeta<string | null>(lastErrorKey, null)

export type StateCounts = Record<BadgeState, number>
export interface SyncCounts { sightings: StateCounts; photos: StateCounts }

const zero = (): StateCounts => ({ queued: 0, synced: 0, conflict: 0, failed: 0 })

export async function getSyncCounts(userId: string): Promise<SyncCounts> {
  const out: SyncCounts = { sightings: zero(), photos: zero() }
  const owned = new Set<string>()
  await db.sightings.filter((s) => s.userId === userId).each((s) => {
    owned.add(s.id)
    out.sightings[badgeFor(s.syncState)]++
  })
  await db.photos.filter((p) => !p.deletedAt && owned.has(p.sightingId)).each((p) => {
    out.photos[badgeFor(p.syncState)]++
  })
  return out
}

/* ---- helpers ------------------------------------------------------------ */

class AuthExpired extends Error {}

/** Only moves the state if the record has not been edited since it was read. */
const setSightingState = (id: string, version: number, state: SyncState) =>
  db.sightings.where('id').equals(id).modify((s) => {
    if (s.clientVersion === version) s.syncState = state
  })

const setPhotoState = (id: string, from: SyncState, to: SyncState) =>
  db.photos.where('id').equals(id).modify((p) => {
    if (p.syncState === from) p.syncState = to
  })

function toRecord(s: Sighting): PushRecord {
  // Identity, ownership and sync bookkeeping are not payload: the server
  // derives the owner from the session and the version travels beside it.
  const { id, userId: _userId, syncState: _syncState, clientVersion, ...payload } = s
  return { id, clientVersion, payload: payload as Record<string, unknown> }
}

/** HTTP 401 means the session ended; any other thrown value is treated as a network failure. */
function classify(e: unknown): 'auth' | 'http' | 'network' {
  if (e instanceof SyncHttpError) return e.status === 401 ? 'auth' : 'http'
  return 'network'
}

/* ---- push --------------------------------------------------------------- */

async function pushDeletes(api: SyncApi): Promise<void> {
  const items = await db.syncQueue.filter((q) => q.op === 'delete' && q.kind === 'sighting').toArray()
  for (const item of items) {
    try {
      await api.deleteSighting(item.refId)
      await db.syncQueue.delete(item.id)
    } catch (e) {
      if (classify(e) === 'auth') throw new AuthExpired()
      await db.syncQueue.update(item.id, { attempts: item.attempts + 1, lastError: (e as Error).message })
      if (classify(e) === 'network') throw e
    }
  }
}

async function applyPushResult(sent: Sighting, r: PushResult | undefined, report: SyncReport): Promise<void> {
  if (!r || r.result === 'rejected') {
    report.rejected++
    await setSightingState(sent.id, sent.clientVersion, 'failed')
    return
  }
  if (r.result === 'applied') {
    report.pushed++
    // An edit made while the request was in flight keeps the record queued.
    await db.sightings.where('id').equals(sent.id).modify((s) => {
      s.syncState = s.clientVersion === sent.clientVersion ? 'synced' : 'local'
    })
    return
  }
  // stale: the server holds a newer or different copy. Keep local, park the server copy.
  report.stale++
  await db.transaction('rw', db.sightings, db.meta, async () => {
    await saveConflict(sent.id, {
      clientVersion: r.clientVersion ?? 0,
      payload: r.server?.payload ?? null,
      deletedAt: r.server?.deletedAt ?? null,
    })
    await setSightingState(sent.id, sent.clientVersion, 'conflict')
  })
}

async function pushSightings(api: SyncApi, userId: string, report: SyncReport): Promise<void> {
  const pending = await db.sightings.filter((s) => s.userId === userId && PENDING.has(s.syncState)).toArray()
  for (let i = 0; i < pending.length; i += PUSH_BATCH) {
    const chunk = pending.slice(i, i + PUSH_BATCH)
    for (const s of chunk) await setSightingState(s.id, s.clientVersion, 'uploading')
    notifySyncChange()

    let results: PushResult[]
    try {
      results = await api.pushSightings(chunk.map(toRecord))
    } catch (e) {
      for (const s of chunk) await setSightingState(s.id, s.clientVersion, 'failed')
      if (classify(e) === 'auth') throw new AuthExpired()
      if (classify(e) === 'http') {
        // The server refused this batch (size, shape). Surface it and keep going.
        report.rejected += chunk.length
        report.error = (e as Error).message
        continue
      }
      throw e
    }
    const byId = new Map(results.map((r) => [r.id, r]))
    for (const s of chunk) await applyPushResult(s, byId.get(s.id), report)
    notifySyncChange()
  }
}

async function pushPhotos(api: SyncApi, userId: string, report: SyncReport): Promise<void> {
  const sightings = new Map<string, Sighting>()
  await db.sightings.filter((s) => s.userId === userId).each((s) => { sightings.set(s.id, s) })

  const pending: Photo[] = await db.photos.filter((p) => PENDING.has(p.syncState)).toArray()
  // Newest first: on a short wifi window the most recent work lands first.
  pending.sort((a, b) => b.takenAt - a.takenAt)

  for (const p of pending) {
    const parent = sightings.get(p.sightingId)
    // Only photos of this user's sightings that the server already has.
    if (!parent || parent.syncState !== 'synced') continue

    try {
      if (p.deletedAt) {
        await api.deletePhoto(p.id)
        await setPhotoState(p.id, p.syncState, 'synced')
        report.photosDeleted++
        continue
      }
      await setPhotoState(p.id, p.syncState, 'uploading')
      notifySyncChange()
      const outcome = await api.uploadPhoto({
        id: p.id, sightingId: p.sightingId, blob: p.derived, width: p.width, height: p.height,
      })
      if (outcome === 'needs_credits') {
        await setPhotoState(p.id, 'uploading', 'needs_credits')
        report.needsCredits++
        break // every further upload would be refused the same way
      }
      await setPhotoState(p.id, 'uploading', 'synced')
      report.photosUploaded++
    } catch (e) {
      await setPhotoState(p.id, 'uploading', 'failed')
      const kind = classify(e)
      if (kind === 'auth') throw new AuthExpired()
      if (kind === 'network') throw e
      report.error = (e as Error).message
    }
    notifySyncChange()
  }
}

/* ---- pull --------------------------------------------------------------- */

async function applyPulled(userId: string, rec: PullPage['sightings'][number], pendingDeletes: Set<string>, report: SyncReport): Promise<void> {
  const local = await db.sightings.get(rec.id)
  const copy = { clientVersion: rec.clientVersion, payload: rec.payload, deletedAt: rec.deletedAt }

  if (!local) {
    // A tombstone for something we never had, or one we are deleting ourselves: nothing to show.
    if (rec.deletedAt !== null || pendingDeletes.has(rec.id) || !rec.payload) return
    await db.sightings.put(sightingFromServer(rec.id, userId, copy))
    report.pulled++
    return
  }
  if (local.userId && local.userId !== userId) return

  if (local.syncState === 'synced') {
    if (rec.deletedAt !== null) {
      await db.transaction('rw', db.sightings, db.photos, async () => {
        await db.photos.where('sightingId').equals(rec.id).modify({ deletedAt: rec.deletedAt ?? Date.now(), syncState: 'synced' })
        await db.sightings.delete(rec.id)
      })
      report.pulled++
    } else if (rec.clientVersion > local.clientVersion && rec.payload) {
      await db.sightings.put(sightingFromServer(rec.id, userId, copy, local))
      report.pulled++
    }
    return
  }

  // Unsynced local work is never overwritten. If the server differs, flag it.
  if (local.syncState === 'conflict') return
  const serverIsDifferent = rec.deletedAt !== null || rec.clientVersion > local.clientVersion
  if (serverIsDifferent && !(await getConflict(rec.id))) {
    await db.transaction('rw', db.sightings, db.meta, async () => {
      await saveConflict(rec.id, copy)
      await setSightingState(rec.id, local.clientVersion, 'conflict')
    })
  }
}

async function pull(api: SyncApi, userId: string, report: SyncReport): Promise<void> {
  let since = await getMeta<number>(cursorKey(userId), 0)
  const pendingDeletes = new Set(
    (await db.syncQueue.filter((q) => q.op === 'delete').toArray()).map((q) => q.refId),
  )
  for (;;) {
    const page = await api.pullSightings(since)
    for (const rec of page.sightings) await applyPulled(userId, rec, pendingDeletes, report)
    if (page.cursor > since) {
      since = page.cursor
      await setMeta(cursorKey(userId), since)
    }
    notifySyncChange()
    if (!page.hasMore) break
  }
}

/* ---- orchestration ------------------------------------------------------ */

export interface SyncOptions {
  fetchFn?: FetchLike
}

async function run(userId: string, opts: SyncOptions): Promise<SyncReport> {
  const report = emptyReport()
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return { ...report, ok: false, offline: true }
  }
  const api = createSyncApi(opts.fetchFn)
  try {
    await pushDeletes(api)
    await pushSightings(api, userId, report)
    await pushPhotos(api, userId, report)
    await pull(api, userId, report)
  } catch (e) {
    if (e instanceof AuthExpired) return { ...report, ok: false, authExpired: true, error: 'auth' }
    report.ok = false
    report.error = (e as Error)?.message || 'network'
    await setMeta(lastErrorKey, report.error)
    return report
  }
  report.conflicts = (await getSyncCounts(userId)).sightings.conflict
  await setMeta(lastSyncKey, Date.now())
  await setMeta(lastErrorKey, report.error ?? null)
  return report
}

let inFlight: Promise<SyncReport> | null = null

/**
 * Run one full sync for `userId`. Concurrent callers (focus + online firing
 * together, a double tap) share the run in progress instead of racing it.
 */
export function syncNow(userId: string, opts: SyncOptions = {}): Promise<SyncReport> {
  if (inFlight) return inFlight
  running = true
  notifySyncChange()
  inFlight = run(userId, opts).finally(() => {
    inFlight = null
    running = false
    notifySyncChange()
  })
  return inFlight
}
