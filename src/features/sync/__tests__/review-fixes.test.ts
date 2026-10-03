/**
 * Client sync regressions against the real Pages Functions handlers: push
 * chunking vs the server query budget, queued deletes scoped to their account,
 * delete-vs-edit conflicts (and the photos they must not lose), and the
 * eviction baseline staying in step with sync-driven removals.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db, type Photo, type Sighting } from '../../../data/db'
import { onRequest as syncRoute } from '../../../../functions/api/sync/[[catchall]]'
import { signSession } from '../../../../functions/lib/session'
import { createMemoryStore } from '../../../../functions/lib/memory-store'
import { MAX_BATCH } from '../../../../functions/lib/sync-sightings'
import { checkIntegrity, recordUserDataCounts } from '../../../data/integrity'
import { PUSH_BATCH, syncNow } from '../engine'
import { getConflict, keepMine, keepServer } from '../conflict'
import { deleteSighting } from '../../log/sighting-repo'

const SECRET = 's3cret'
const ORIGIN = 'https://x.test'
const A = 'user_a'
const B = 'user_b'
/** Free plan allows 50 D1 queries per invocation; stay clear of it. */
const QUERY_BUDGET = 45

type Store = ReturnType<typeof createMemoryStore>

async function cookieFor(userId: string) {
  return `spidex_session=${await signSession({ userId, email: `${userId}@x.co`, emailVerified: true }, SECRET)}`
}

function routedFetch(store: Store, userId: string, env: Record<string, unknown> = {}) {
  const calls: { method: string; path: string; queries: number }[] = []
  const fn = vi.fn(async (input: string, init: RequestInit = {}) => {
    const method = init.method ?? 'GET'
    const headers = new Headers(init.headers)
    headers.set('Origin', ORIGIN)
    headers.set('Cookie', await cookieFor(userId))
    const request = new Request(`${ORIGIN}${input}`, { method, headers, body: init.body as BodyInit | undefined })
    const before = store.log.length
    const res = await syncRoute({ request, env: { SESSION_SECRET: SECRET, DB: store.db, PACKS: store.r2, ...env } } as never)
    calls.push({ method, path: input, queries: store.log.length - before })
    return res
  })
  return Object.assign(fn, { calls })
}

let n = 0
const uuid = () => `00000000-0000-4000-8000-${String(++n + 5000).padStart(12, '0')}`

function sighting(over: Partial<Sighting> = {}): Sighting {
  return {
    id: uuid(), installId: 'inst-1', userId: A, count: 1, at: Date.now() - 3600_000,
    tzOffsetMinutes: 420, clockConfidence: 'trusted', notes: 'first', syncState: 'local',
    clientVersion: 1, updatedAt: Date.now(), ...over,
  }
}

const photoFor = (sightingId: string, over: Partial<Photo> = {}): Photo => ({
  id: uuid(), sightingId,
  original: new Blob([new Uint8Array([0xff, 0xd8, 0xff, 1])], { type: 'image/jpeg' }),
  derived: new Blob([new Uint8Array([0xff, 0xd8, 0xff, 2])], { type: 'image/jpeg' }),
  width: 10, height: 10, takenAt: Date.now(), syncState: 'local', ...over,
})

let store: Store
beforeEach(async () => {
  store = createMemoryStore()
  await Promise.all([db.sightings.clear(), db.photos.clear(), db.syncQueue.clear(), db.meta.clear()])
})

describe('push chunking', () => {
  it('the client never sends more records than the server accepts', () => {
    expect(PUSH_BATCH).toBeLessThanOrEqual(MAX_BATCH)
  })

  it('a large backlog finishes: every request stays within the query budget and every record syncs', async () => {
    const rows = Array.from({ length: 40 }, () => sighting())
    await db.sightings.bulkPut(rows)
    const fetchFn = routedFetch(store, A)
    const report = await syncNow(A, { fetchFn })
    expect(report).toMatchObject({ ok: true, pushed: 40, rejected: 0 })
    expect(fetchFn.calls.filter((c) => c.method === 'POST')).toHaveLength(Math.ceil(40 / PUSH_BATCH))
    for (const c of fetchFn.calls) expect(c.queries).toBeLessThanOrEqual(QUERY_BUDGET)
    expect((await db.sightings.filter((s) => s.syncState === 'synced').count())).toBe(40)
  })
})

describe('queued deletes belong to the account that made them', () => {
  it('A deletes offline, B signs in: B never sends it, A sends it on the next sign-in', async () => {
    const s = sighting()
    await db.sightings.put(s)
    await syncNow(A, { fetchFn: routedFetch(store, A) })
    await deleteSighting(s.id)
    expect(await db.syncQueue.toArray()).toEqual([expect.objectContaining({ refId: s.id, userId: A })])

    const asB = routedFetch(store, B)
    await syncNow(B, { fetchFn: asB })
    expect(asB.calls.some((c) => c.method === 'DELETE')).toBe(false)
    expect(await db.syncQueue.count()).toBe(1)
    expect(store.state.sightings[s.id]!.deleted_at).toBeNull()

    const asA = routedFetch(store, A)
    await syncNow(A, { fetchFn: asA })
    expect(asA.calls.filter((c) => c.method === 'DELETE')).toHaveLength(1)
    expect(await db.syncQueue.count()).toBe(0)
    expect(store.state.sightings[s.id]!.deleted_at).not.toBeNull()
  })
})

describe('a server-side delete versus an offline edit', () => {
  /** Device 1 has a synced sighting with a synced photo; device 2 deletes it; device 1 then edits offline. */
  async function deletedElsewhereThenEdited(editPhotoUnsynced = false) {
    const s = sighting()
    const p = photoFor(s.id)
    await db.sightings.put(s)
    await db.photos.put(p)
    await syncNow(A, { fetchFn: routedFetch(store, A) })
    // Another device deletes it.
    await routedFetch(store, A)(`/api/sync/sightings/${s.id}`, { method: 'DELETE' })
    await db.sightings.update(s.id, { notes: 'edited offline', clientVersion: 2, syncState: 'local' })
    if (editPhotoUnsynced) {
      await db.photos.put(photoFor(s.id, { id: uuid() }))
    }
    return { s, p }
  }

  it('the stale edit does not resurrect it silently: it surfaces as a conflict and the tombstone stands', async () => {
    const { s } = await deletedElsewhereThenEdited()
    const report = await syncNow(A, { fetchFn: routedFetch(store, A) })
    expect(report.stale).toBe(1)
    expect(store.state.sightings[s.id]!.deleted_at).not.toBeNull()
    expect((await db.sightings.get(s.id))!.syncState).toBe('conflict')
    expect((await getConflict(s.id))!.deletedAt).toEqual(expect.any(Number))
  })

  it('keeps the local photos of a conflicted sighting even though the server tombstoned them', async () => {
    const { s, p } = await deletedElsewhereThenEdited()
    await syncNow(A, { fetchFn: routedFetch(store, A) })
    expect((await db.sightings.get(s.id))!.syncState).toBe('conflict')
    const photo = (await db.photos.get(p.id))!
    expect(photo.deletedAt).toBeUndefined()
    expect(photo.derived.size).toBeGreaterThan(0)
  })

  it('keep mine restores the sighting and re-uploads the photos it still has', async () => {
    const { s, p } = await deletedElsewhereThenEdited()
    await syncNow(A, { fetchFn: routedFetch(store, A) })
    expect(await keepMine(s.id)).toBe(true)

    const fetchFn = routedFetch(store, A)
    const report = await syncNow(A, { fetchFn })
    expect(report).toMatchObject({ pushed: 1, stale: 0, photosUploaded: 1 })
    expect(store.state.sightings[s.id]!.deleted_at).toBeNull()
    expect(JSON.parse(store.state.sightings[s.id]!.payload).notes).toBe('edited offline')

    const live = Object.values(store.state.photos).filter((x) => x.sighting_id === s.id && x.deleted_at === null)
    expect(live).toHaveLength(1)
    expect(live[0]!.id).not.toBe(p.id) // the tombstoned id can never be reused
    expect(store.r2.keys()).toContain(live[0]!.r2_key)
    const local = await db.photos.where('sightingId').equals(s.id).toArray()
    expect(local).toHaveLength(1)
    expect(local[0]).toMatchObject({ id: live[0]!.id, syncState: 'synced' })
    expect((await db.sightings.get(s.id))!.syncState).toBe('synced')
    // The restore marker is spent: a later plain edit is not treated as a restore.
    expect(await db.meta.get(`sync.restore.${s.id}`)).toBeUndefined()
  })

  it('keep server on a delete conflict drops the sighting', async () => {
    const { s } = await deletedElsewhereThenEdited()
    await syncNow(A, { fetchFn: routedFetch(store, A) })
    expect(await keepServer(A, s.id)).toBe(true)
    expect(await db.sightings.get(s.id)).toBeUndefined()
  })

  it('a synced sighting deleted elsewhere is parked as a conflict while it has photos that never uploaded', async () => {
    const s = sighting()
    await db.sightings.put(s)
    await syncNow(A, { fetchFn: routedFetch(store, A) })
    const unsynced = photoFor(s.id)
    await db.photos.put(unsynced)
    await routedFetch(store, A)(`/api/sync/sightings/${s.id}`, { method: 'DELETE' })

    await syncNow(A, { fetchFn: routedFetch(store, A) })
    expect((await db.sightings.get(s.id))!.syncState).toBe('conflict')
    const photo = (await db.photos.get(unsynced.id))!
    expect(photo.deletedAt).toBeUndefined()
    expect(photo.syncState).not.toBe('synced')
    // The upload for a deleted sighting is not attempted, so nothing is lost or failed.
    expect(await keepMine(s.id)).toBe(true)
    const report = await syncNow(A, { fetchFn: routedFetch(store, A) })
    expect(report.photosUploaded).toBe(1)
    expect(store.state.sightings[s.id]!.deleted_at).toBeNull()
  })
})

describe('eviction baseline and sync removals', () => {
  it('a delete made on another device does not trigger the data-loss alarm', async () => {
    const rows = [sighting(), sighting()]
    await db.sightings.bulkPut(rows)
    await db.photos.bulkPut([photoFor(rows[0]!.id), photoFor(rows[1]!.id)])
    await syncNow(A, { fetchFn: routedFetch(store, A) })
    await recordUserDataCounts()
    expect((await checkIntegrity()).userDataLost).toBe(false)

    // Another device deletes both; this device syncs.
    for (const r of rows) await routedFetch(store, A)(`/api/sync/sightings/${r.id}`, { method: 'DELETE' })
    await syncNow(A, { fetchFn: routedFetch(store, A) })
    expect(await db.sightings.count()).toBe(0)

    const report = await checkIntegrity()
    expect(report.userDataLost).toBe(false)
    expect(report.userData).toMatchObject({ expectedSightings: 0, actualSightings: 0 })
  })

  it('a single photo deleted on another device does not trigger it either', async () => {
    const s = sighting()
    const p = photoFor(s.id)
    await db.sightings.put(s)
    await db.photos.put(p)
    await syncNow(A, { fetchFn: routedFetch(store, A) })
    await recordUserDataCounts()
    await routedFetch(store, A)(`/api/sync/photos/${p.id}`, { method: 'DELETE' })
    await syncNow(A, { fetchFn: routedFetch(store, A) })
    expect(await db.photos.get(p.id)).toBeUndefined()
    expect((await checkIntegrity()).userDataLost).toBe(false)
  })

  it('keep server on a delete conflict keeps the baseline in step', async () => {
    const s = sighting()
    await db.sightings.put(s)
    await syncNow(A, { fetchFn: routedFetch(store, A) })
    await routedFetch(store, A)(`/api/sync/sightings/${s.id}`, { method: 'DELETE' })
    await db.sightings.update(s.id, { notes: 'edited offline', clientVersion: 2, syncState: 'local' })
    await syncNow(A, { fetchFn: routedFetch(store, A) })
    await recordUserDataCounts()
    expect(await keepServer(A, s.id)).toBe(true)
    expect((await checkIntegrity()).userDataLost).toBe(false)
  })

  it('still reports an unexplained drop', async () => {
    const s = sighting()
    await db.sightings.put(s)
    await syncNow(A, { fetchFn: routedFetch(store, A) })
    await recordUserDataCounts()
    await db.sightings.clear()
    expect((await checkIntegrity()).userDataLost).toBe(true)
  })
})
