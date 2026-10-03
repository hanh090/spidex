/**
 * The client engine against the real Pages Functions handlers.
 *
 * `fetch` is mocked by routing each request straight into the sync route with
 * an in-memory D1/R2 behind it, so these tests exercise the actual wire
 * contract (per-record results, seq cursor, 402, 401) rather than a stub of it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db, type Photo, type Sighting } from '../../../data/db'
import { onRequest as syncRoute } from '../../../../functions/api/sync/[[catchall]]'
import { signSession } from '../../../../functions/lib/session'
import { createMemoryStore } from '../../../../functions/lib/memory-store'
import { syncNow, getSyncCounts, badgeFor } from '../engine'
import { getConflict, keepMine, keepServer, listConflicts } from '../conflict'
import { deleteSighting } from '../../log/sighting-repo'

const SECRET = 's3cret'
const ORIGIN = 'https://x.test'
const A = 'user_a'

type Store = ReturnType<typeof createMemoryStore>

async function cookieFor(userId: string) {
  return `spidex_session=${await signSession({ userId, email: `${userId}@x.co`, emailVerified: true }, SECRET)}`
}

/** A fetch that talks to the route in-process, as `userId` (or anonymously). */
function routedFetch(store: Store, userId: string | null, env: Record<string, unknown> = {}) {
  const calls: { method: string; path: string }[] = []
  const fn = vi.fn(async (input: string, init: RequestInit = {}) => {
    const method = init.method ?? 'GET'
    calls.push({ method, path: input })
    const headers = new Headers(init.headers)
    headers.set('Origin', ORIGIN)
    if (userId) headers.set('Cookie', await cookieFor(userId))
    const request = new Request(`${ORIGIN}${input}`, { method, headers, body: init.body as BodyInit | undefined })
    return syncRoute({ request, env: { SESSION_SECRET: SECRET, DB: store.db, PACKS: store.r2, ...env } } as never)
  })
  return Object.assign(fn, { calls })
}

let n = 0
const uuid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`

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
  await Promise.all([
    db.sightings.clear(), db.photos.clear(), db.syncQueue.clear(), db.meta.clear(), db.ledgerCache.clear(),
  ])
})

describe('push then pull', () => {
  it('pushes a queued sighting, marks it synced only on applied, and records the sync time', async () => {
    const s = sighting()
    await db.sightings.put(s)
    const fetchFn = routedFetch(store, A)
    const report = await syncNow(A, { fetchFn })
    expect(report).toMatchObject({ ok: true, pushed: 1, stale: 0 })
    expect((await db.sightings.get(s.id))!.syncState).toBe('synced')
    expect(store.state.sightings[s.id]!.user_id).toBe(A)
    expect((await db.meta.get('sync.lastSyncAt'))?.value).toEqual(expect.any(Number))
    // Push happens before pull.
    const order = fetchFn.calls.map((c) => `${c.method} ${c.path.split('?')[0]}`)
    expect(order.indexOf('POST /api/sync/sightings')).toBeLessThan(order.indexOf('GET /api/sync/sightings'))
  })

  it('does not touch guest sightings or another account sightings', async () => {
    const guest = sighting({ userId: undefined })
    const other = sighting({ userId: 'user_b' })
    await db.sightings.bulkPut([guest, other])
    const fetchFn = routedFetch(store, A)
    await syncNow(A, { fetchFn })
    expect(Object.keys(store.state.sightings)).toHaveLength(0)
    expect((await db.sightings.get(guest.id))!.syncState).toBe('local')
    expect((await db.sightings.get(other.id))!.syncState).toBe('local')
  })

  it('pulls records from another device and does not duplicate on a second run', async () => {
    const s = sighting({ notes: 'from phone' })
    await db.sightings.put(s)
    await syncNow(A, { fetchFn: routedFetch(store, A) })

    // A second install with an empty local database.
    await db.sightings.clear()
    await db.meta.clear()
    const r1 = await syncNow(A, { fetchFn: routedFetch(store, A) })
    expect(r1.pulled).toBe(1)
    const pulled = (await db.sightings.get(s.id))!
    expect(pulled).toMatchObject({ notes: 'from phone', syncState: 'synced', userId: A, clientVersion: 1 })

    const r2 = await syncNow(A, { fetchFn: routedFetch(store, A) })
    expect(r2.pulled).toBe(0)
    expect(await db.sightings.count()).toBe(1)
  })

  it('adopts a newer server edit for a synced record', async () => {
    const s = sighting()
    await db.sightings.put(s)
    await syncNow(A, { fetchFn: routedFetch(store, A) })
    // Another device edits to v2.
    store.state.sightings[s.id]!.client_version = 2
    store.state.sightings[s.id]!.payload = JSON.stringify({ ...JSON.parse(store.state.sightings[s.id]!.payload), notes: 'edited elsewhere' })
    store.state.sightings[s.id]!.server_seq = 99
    await syncNow(A, { fetchFn: routedFetch(store, A) })
    expect(await db.sightings.get(s.id)).toMatchObject({ notes: 'edited elsewhere', clientVersion: 2, syncState: 'synced' })
  })

  it('applies a remote tombstone to a synced record', async () => {
    const s = sighting()
    await db.sightings.put(s)
    await db.photos.put(photoFor(s.id))
    const fetchFn = routedFetch(store, A)
    await syncNow(A, { fetchFn })
    await fetchFn(`/api/sync/sightings/${s.id}`, { method: 'DELETE' })
    await syncNow(A, { fetchFn: routedFetch(store, A) })
    expect(await db.sightings.get(s.id)).toBeUndefined()
  })

  it('sends a tombstone for a record deleted locally', async () => {
    const s = sighting()
    await db.sightings.put(s)
    await syncNow(A, { fetchFn: routedFetch(store, A) })
    await deleteSighting(s.id)
    expect(await db.syncQueue.count()).toBe(1)
    const report = await syncNow(A, { fetchFn: routedFetch(store, A) })
    expect(report.ok).toBe(true)
    expect(store.state.sightings[s.id]!.deleted_at).not.toBeNull()
    expect(await db.syncQueue.count()).toBe(0)
    expect(await db.sightings.get(s.id)).toBeUndefined() // not resurrected by the pull
  })
})

describe('conflicts', () => {
  async function conflicted() {
    const s = sighting({ notes: 'mine', clientVersion: 2 })
    // The server already holds a newer edit from another device.
    store.state.seq[A] = 7
    store.state.sightings[s.id] = {
      id: s.id, user_id: A, client_version: 5, server_seq: 7, updated_at: Date.now(), deleted_at: null,
      payload: JSON.stringify({ count: 3, at: s.at, tzOffsetMinutes: 420, clockConfidence: 'trusted', notes: 'server newer', updatedAt: Date.now() }),
    }
    await db.sightings.put(s)
    const report = await syncNow(A, { fetchFn: routedFetch(store, A) })
    return { s, report }
  }

  it('an older queued edit becomes a conflict and never overwrites the server', async () => {
    const { s, report } = await conflicted()
    expect(report).toMatchObject({ stale: 1, conflicts: 1 })
    const local = (await db.sightings.get(s.id))!
    expect(local.syncState).toBe('conflict')
    expect(local.notes).toBe('mine')
    expect(JSON.parse(store.state.sightings[s.id]!.payload).notes).toBe('server newer')
    expect(badgeFor(local.syncState)).toBe('conflict')
    const list = await listConflicts(A)
    expect(list).toHaveLength(1)
    expect(list[0]!.server.payload).toMatchObject({ notes: 'server newer' })
  })

  it('keep server adopts the server copy', async () => {
    const { s } = await conflicted()
    expect(await keepServer(A, s.id)).toBe(true)
    expect(await db.sightings.get(s.id)).toMatchObject({ notes: 'server newer', clientVersion: 5, syncState: 'synced' })
    expect(await getConflict(s.id)).toBeNull()
  })

  it('keep mine re-stamps above the server version and wins on the next sync', async () => {
    const { s } = await conflicted()
    expect(await keepMine(s.id)).toBe(true)
    expect(await db.sightings.get(s.id)).toMatchObject({ clientVersion: 6, syncState: 'local' })
    const report = await syncNow(A, { fetchFn: routedFetch(store, A) })
    expect(report).toMatchObject({ pushed: 1, stale: 0 })
    expect(JSON.parse(store.state.sightings[s.id]!.payload).notes).toBe('mine')
    expect((await db.sightings.get(s.id))!.syncState).toBe('synced')
  })

  it('a pull never overwrites unsynced local work; it flags a conflict instead', async () => {
    const s = sighting({ notes: 'unsynced local', clientVersion: 2, syncState: 'failed' })
    await db.sightings.put(s)
    store.state.seq[A] = 3
    store.state.sightings[s.id] = {
      id: s.id, user_id: A, client_version: 4, server_seq: 3, updated_at: Date.now(), deleted_at: null,
      payload: JSON.stringify({ count: 1, at: s.at, tzOffsetMinutes: 420, clockConfidence: 'trusted', notes: 'remote', updatedAt: Date.now() }),
    }
    // Pushes are refused by the server (HTTP 500), but the pull still runs.
    const base = routedFetch(store, A)
    const fetchFn = vi.fn(async (input: string, init?: RequestInit) =>
      init?.method === 'POST' ? new Response('{"error":"boom"}', { status: 500 }) : base(input, init))
    await syncNow(A, { fetchFn })
    const local = (await db.sightings.get(s.id))!
    expect(local.notes).toBe('unsynced local')
    expect(local.syncState).toBe('conflict')
    expect((await getConflict(s.id))?.payload).toMatchObject({ notes: 'remote' })
  })
})

describe('photos', () => {
  it('uploads photos of a synced sighting newest first and never re-uploads', async () => {
    const s = sighting()
    await db.sightings.put(s)
    const old = photoFor(s.id, { takenAt: 1_000 })
    const recent = photoFor(s.id, { takenAt: 9_000 })
    await db.photos.bulkPut([old, recent])

    const fetchFn = routedFetch(store, A)
    const report = await syncNow(A, { fetchFn })
    expect(report.photosUploaded).toBe(2)
    const uploads = fetchFn.calls.filter((c) => c.method === 'POST' && c.path.startsWith('/api/sync/photos'))
    expect(uploads[0]!.path).toContain(recent.id)
    expect(uploads[1]!.path).toContain(old.id)
    expect((await db.photos.get(old.id))!.syncState).toBe('synced')
    expect(Object.keys(store.state.photos)).toHaveLength(2)

    const again = routedFetch(store, A)
    await syncNow(A, { fetchFn: again })
    expect(again.calls.filter((c) => c.method === 'POST' && c.path.startsWith('/api/sync/photos'))).toHaveLength(0)
  })

  it('holds photos back while their sighting is not synced', async () => {
    const s = sighting({ userId: undefined }) // guest-owned
    await db.sightings.put(s)
    await db.photos.put(photoFor(s.id))
    const fetchFn = routedFetch(store, A)
    await syncNow(A, { fetchFn })
    expect(fetchFn.calls.some((c) => c.method !== 'GET' && c.path.startsWith('/api/sync/photos'))).toBe(false)
  })

  it('sends a tombstone for a photo deleted locally', async () => {
    const s = sighting()
    const p = photoFor(s.id)
    await db.sightings.put(s)
    await db.photos.put(p)
    await syncNow(A, { fetchFn: routedFetch(store, A) })
    await db.photos.update(p.id, { deletedAt: Date.now(), syncState: 'local' })
    const report = await syncNow(A, { fetchFn: routedFetch(store, A) })
    expect(report.photosDeleted).toBe(1)
    expect(store.state.photos[p.id]!.deleted_at).not.toBeNull()
    expect(store.r2.keys()).toHaveLength(0)
  })

  it('marks photos needs_credits (and keeps the data) when enforcement refuses them', async () => {
    const s = sighting()
    const p = photoFor(s.id)
    await db.sightings.put(s)
    await db.photos.put(p)
    await syncNow(A, { fetchFn: routedFetch(store, A) }) // grants credits and uploads
    const p2 = photoFor(s.id)
    await db.photos.put(p2)
    store.state.ledger.push({
      id: 'adj', user_id: A, delta: -10_000, reason: 'adjustment', ref_type: null, ref_id: null, idempotency_key: 'adj', created_at: 1,
    })
    store.state.balances[A] = { balance: 0, updated_at: 1 }
    const report = await syncNow(A, { fetchFn: routedFetch(store, A, { CREDITS_ENFORCED: 'true' }) })
    expect(report.needsCredits).toBe(1)
    expect((await db.photos.get(p2.id))!.syncState).toBe('needs_credits')
    expect((await db.photos.get(p2.id))!.derived.size).toBeGreaterThan(0)
    expect(badgeFor('needs_credits')).toBe('failed')
  })
})

describe('failure handling', () => {
  it('reports offline without attempting anything', async () => {
    const s = sighting()
    await db.sightings.put(s)
    const fetchFn = routedFetch(store, A)
    const original = Object.getOwnPropertyDescriptor(globalThis.navigator, 'onLine')
    Object.defineProperty(globalThis.navigator, 'onLine', { configurable: true, value: false })
    try {
      expect(await syncNow(A, { fetchFn })).toMatchObject({ ok: false, offline: true })
    } finally {
      Object.defineProperty(globalThis.navigator, 'onLine', original ?? { configurable: true, value: true })
    }
    expect(fetchFn).not.toHaveBeenCalled()
    expect((await db.sightings.get(s.id))!.syncState).toBe('local')
  })

  it('a network failure leaves records retryable (failed), not lost', async () => {
    const s = sighting()
    await db.sightings.put(s)
    const fetchFn = vi.fn(async () => { throw new TypeError('Failed to fetch') })
    const report = await syncNow(A, { fetchFn })
    expect(report.ok).toBe(false)
    expect((await db.sightings.get(s.id))!.syncState).toBe('failed')
    const retry = await syncNow(A, { fetchFn: routedFetch(store, A) })
    expect(retry.ok).toBe(true)
    expect((await db.sightings.get(s.id))!.syncState).toBe('synced')
  })

  it('an expired session is reported and changes nothing server-side', async () => {
    const s = sighting()
    await db.sightings.put(s)
    const report = await syncNow(A, { fetchFn: routedFetch(store, null) })
    expect(report).toMatchObject({ ok: false, authExpired: true })
    expect(Object.keys(store.state.sightings)).toHaveLength(0)
    expect((await db.sightings.get(s.id))!.syncState).toBe('failed')
  })

  it('concurrent triggers share one run', async () => {
    await db.sightings.put(sighting())
    const fetchFn = routedFetch(store, A)
    const [a, b] = await Promise.all([syncNow(A, { fetchFn }), syncNow(A, { fetchFn })])
    expect(a).toBe(b)
    expect(fetchFn.calls.filter((c) => c.method === 'POST')).toHaveLength(1)
  })

  it('an edit made while a push is in flight stays queued', async () => {
    const s = sighting()
    await db.sightings.put(s)
    const base = routedFetch(store, A)
    const fetchFn = vi.fn(async (input: string, init?: RequestInit) => {
      const res = await base(input, init)
      if (init?.method === 'POST' && input === '/api/sync/sightings') {
        await db.sightings.update(s.id, { clientVersion: 2, notes: 'edited mid-flight', syncState: 'local' })
      }
      return res
    })
    await syncNow(A, { fetchFn })
    expect(await db.sightings.get(s.id)).toMatchObject({ clientVersion: 2, syncState: 'local' })
    const counts = await getSyncCounts(A)
    expect(counts.sightings.queued).toBe(1)
  })
})

describe('photo pull on a second device', () => {
  const photoGets = (f: { calls: { method: string; path: string }[] }) =>
    f.calls.filter((c) => c.method === 'GET' && c.path.startsWith('/api/sync/photos/'))
  const photoPosts = (f: { calls: { method: string; path: string }[] }) =>
    f.calls.filter((c) => c.method === 'POST' && c.path.startsWith('/api/sync/photos'))

  /** Device 1 pushes a sighting + photo; local data is then wiped to act as a fresh device 2. */
  async function seedAndWipe() {
    const s = sighting()
    const p = photoFor(s.id)
    await db.sightings.put(s)
    await db.photos.put(p)
    await syncNow(A, { fetchFn: routedFetch(store, A) })
    await Promise.all([db.sightings.clear(), db.photos.clear(), db.syncQueue.clear(), db.meta.clear()])
    return { s, p }
  }

  it('pulls metadata, downloads the blob once as a derivative-only synced row, never re-pushes', async () => {
    const { s, p } = await seedAndWipe()
    const fetchFn = routedFetch(store, A)
    const report = await syncNow(A, { fetchFn })
    expect(report.photosPulled).toBe(1)
    const row = (await db.photos.get(p.id))!
    expect(row).toMatchObject({ sightingId: s.id, syncState: 'synced', pulled: true, width: 10, height: 10 })
    expect(row.original).toBeUndefined()
    expect(new Uint8Array(await new Response(row.derived).arrayBuffer())).toEqual(new Uint8Array([0xff, 0xd8, 0xff, 2]))

    const again = routedFetch(store, A)
    const second = await syncNow(A, { fetchFn: again })
    expect(second.photosPulled).toBe(0)
    expect(photoGets(fetchFn)).toHaveLength(1)
    expect(photoGets(again)).toHaveLength(0)
    expect(photoPosts(fetchFn)).toHaveLength(0)
    expect(photoPosts(again)).toHaveLength(0)
  })

  it('applies a remote tombstone by deleting the local synced photo', async () => {
    const { p } = await seedAndWipe()
    await syncNow(A, { fetchFn: routedFetch(store, A) })
    expect(await db.photos.get(p.id)).toBeDefined()
    // Another device deletes it server-side.
    await routedFetch(store, A)(`/api/sync/photos/${p.id}`, { method: 'DELETE' })
    await syncNow(A, { fetchFn: routedFetch(store, A) })
    expect(await db.photos.get(p.id)).toBeUndefined()
  })

  it('never overwrites or discards an unsynced local photo', async () => {
    const { p } = await seedAndWipe()
    await syncNow(A, { fetchFn: routedFetch(store, A) })
    const mine = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 9])], { type: 'image/jpeg' })
    await db.photos.update(p.id, { syncState: 'failed', derived: mine })
    const dropCursor = () => db.meta.toCollection().filter((m) => m.key.startsWith('sync.photoCursor')).delete()
    // Pushes are refused, so the photo stays unsynced while the pull runs.
    const refusePush = (f: ReturnType<typeof routedFetch>) => vi.fn(async (input: string, init?: RequestInit) =>
      init?.method && init.method !== 'GET' ? new Response('{"error":"boom"}', { status: 500 }) : f(input, init))

    await dropCursor()
    const fetchFn = routedFetch(store, A)
    await syncNow(A, { fetchFn: refusePush(fetchFn) })
    expect(photoGets(fetchFn)).toHaveLength(0)
    const kept = new Uint8Array(await new Response((await db.photos.get(p.id))!.derived).arrayBuffer())
    expect(kept[3]).toBe(9)

    await routedFetch(store, A)(`/api/sync/photos/${p.id}`, { method: 'DELETE' })
    await dropCursor()
    await syncNow(A, { fetchFn: refusePush(routedFetch(store, A)) })
    expect(await db.photos.get(p.id)).toBeDefined()
  })

  it('retries a failed download without losing the photo', async () => {
    const { p } = await seedAndWipe()
    const base = routedFetch(store, A)
    const flaky = vi.fn(async (input: string, init?: RequestInit) => {
      if (input.startsWith(`/api/sync/photos/${p.id}`)) throw new TypeError('offline')
      return base(input, init)
    })
    const failed = await syncNow(A, { fetchFn: flaky })
    expect(failed.ok).toBe(false)
    expect(await db.photos.get(p.id)).toBeUndefined()

    const ok = await syncNow(A, { fetchFn: routedFetch(store, A) })
    expect(ok.photosPulled).toBe(1)
  })
})
