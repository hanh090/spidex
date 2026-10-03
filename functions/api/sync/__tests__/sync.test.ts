import { beforeEach, describe, expect, it } from 'vitest'
import { onRequest as syncRoute } from '../[[catchall]]'
import { onRequest as creditsRoute } from '../../credits/[[catchall]]'
import { signSession } from '../../../lib/session'
import { fakeSyncStore } from '../../../lib/__tests__/fakes'
import { PHOTO_SYNC_COST, SIGNUP_GRANT } from '../../../lib/ledger'

const SECRET = 's3cret'
const ORIGIN = 'https://x.test'
type Store = ReturnType<typeof fakeSyncStore>

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4])
const WEBP = new Uint8Array([...new TextEncoder().encode('RIFF'), 0, 0, 0, 0, ...new TextEncoder().encode('WEBP'), 1])

interface Opts {
  user?: string
  body?: unknown
  raw?: Uint8Array<ArrayBuffer>
  type?: string
  headers?: Record<string, string>
  anon?: boolean
  env?: Record<string, unknown>
}

async function call(store: Store, method: string, path: string, opts: Opts = {}) {
  const user = opts.user ?? 'user_a'
  const headers: Record<string, string> = { Origin: ORIGIN, ...opts.headers }
  if (!opts.anon) headers.Cookie = `spidex_session=${await signSession({ userId: user, email: `${user}@x.co`, emailVerified: true }, SECRET)}`
  let body: BodyInit | undefined
  if (opts.raw) { body = new Blob([opts.raw]); headers['Content-Type'] = opts.type ?? 'image/jpeg' }
  else if (opts.body !== undefined) { body = JSON.stringify(opts.body); headers['Content-Type'] = 'application/json' }
  const handler = path.startsWith('/api/credits') ? creditsRoute : syncRoute
  return handler({
    request: new Request(`${ORIGIN}${path}`, { method, body, headers }),
    env: { SESSION_SECRET: SECRET, DB: store.db, PACKS: store.r2, ...opts.env },
  } as never)
}

const id1 = '11111111-1111-4111-8111-111111111111'
const id2 = '22222222-2222-4222-8222-222222222222'
const photo1 = '33333333-3333-4333-8333-333333333333'

const rec = (id: string, clientVersion = 1, over: Record<string, unknown> = {}) => ({
  id, clientVersion,
  payload: {
    count: 1, at: Date.now() - 60_000, tzOffsetMinutes: 420, clockConfidence: 'trusted',
    notes: 'v' + clientVersion, updatedAt: Date.now(), ...over,
  },
})

const push = (store: Store, records: unknown[], opts: Opts = {}) =>
  call(store, 'POST', '/api/sync/sightings', { ...opts, body: { records } })

let store: Store
beforeEach(() => { store = fakeSyncStore() })

describe('POST /api/sync/sightings', () => {
  it('requires a session and a same-origin request', async () => {
    expect((await push(store, [rec(id1)], { anon: true })).status).toBe(401)
    const cross = await push(store, [rec(id1)], { headers: { Origin: 'https://evil.test' } })
    expect(cross.status).toBe(403)
    expect(Object.keys(store.state.sightings)).toHaveLength(0)
  })

  it('applies a new record and reports its seq', async () => {
    const res = await push(store, [rec(id1)])
    const { results } = await res.json() as any
    expect(results[0]).toMatchObject({ id: id1, result: 'applied', clientVersion: 1 })
    expect(results[0].serverSeq).toBeGreaterThan(0)
    expect(store.state.sightings[id1]!.user_id).toBe('user_a')
  })

  it('is idempotent: replaying an identical batch leaves the row count and seq of the row unchanged', async () => {
    const batch = [rec(id1), rec(id2)]
    const first = (await (await push(store, batch)).json() as any).results
    const rows = Object.keys(store.state.sightings).length
    const seqs = first.map((r: any) => r.serverSeq)
    const again = (await (await push(store, batch)).json() as any).results
    expect(again.map((r: any) => r.result)).toEqual(['applied', 'applied'])
    expect(Object.keys(store.state.sightings)).toHaveLength(rows)
    expect(again.map((r: any) => r.serverSeq)).toEqual(seqs)
  })

  it('never takes user_id from the payload', async () => {
    await push(store, [rec(id1, 1, { userId: 'user_b', user_id: 'user_b' })])
    expect(store.state.sightings[id1]!.user_id).toBe('user_a')
    expect(store.state.sightings[id1]!.payload).not.toContain('user_b')
  })

  it('rejects a cross-tenant write and leaves the other user row unchanged', async () => {
    await push(store, [rec(id1, 1)], { user: 'user_a' })
    const before = JSON.stringify(store.state.sightings[id1])
    const res = await push(store, [rec(id1, 99, { notes: 'hijack' })], { user: 'user_b' })
    const { results } = await res.json() as any
    expect(results[0]).toMatchObject({ id: id1, result: 'rejected', reason: 'not_owner' })
    expect(results[0].server).toBeUndefined()
    expect(JSON.stringify(store.state.sightings[id1])).toBe(before)
  })

  it('reports an older edit as stale and keeps the newer server copy', async () => {
    await push(store, [rec(id1, 5, { notes: 'newer' })])
    const res = await push(store, [rec(id1, 3, { notes: 'old queued edit' })])
    const r = (await res.json() as any).results[0]
    expect(r).toMatchObject({ result: 'stale', clientVersion: 5 })
    expect(r.server.payload.notes).toBe('newer')
    expect(JSON.parse(store.state.sightings[id1]!.payload).notes).toBe('newer')
  })

  it('treats the same version with different content as stale, not a silent overwrite', async () => {
    await push(store, [rec(id1, 2, { notes: 'device A' })])
    const r = (await (await push(store, [rec(id1, 2, { notes: 'device B' })])).json() as any).results[0]
    expect(r.result).toBe('stale')
    expect(JSON.parse(store.state.sightings[id1]!.payload).notes).toBe('device A')
  })

  it('accepts a strictly newer version', async () => {
    await push(store, [rec(id1, 1)])
    const r = (await (await push(store, [rec(id1, 2, { notes: 'edit' })])).json() as any).results[0]
    expect(r.result).toBe('applied')
    expect(JSON.parse(store.state.sightings[id1]!.payload).notes).toBe('edit')
  })

  it('rejects malformed records and implausible timestamps per record, applying the rest', async () => {
    const res = await push(store, [
      { id: 'not-a-uuid', clientVersion: 1, payload: {} },
      rec(id1, 1, { at: Date.now() + 10 * 24 * 3600 * 1000 }),
      rec(id2),
    ])
    const { results } = await res.json() as any
    expect(results.map((r: any) => r.result)).toEqual(['rejected', 'rejected', 'applied'])
    expect(results[1].reason).toBe('timestamp_out_of_range')
  })

  it('caps the batch size', async () => {
    const many = Array.from({ length: 51 }, (_, i) => rec(`00000000-0000-4000-8000-${String(i).padStart(12, '0')}`))
    expect((await push(store, many)).status).toBe(413)
  })
})

describe('GET /api/sync/sightings (pull)', () => {
  it('returns only the caller records after the cursor, in seq order', async () => {
    await push(store, [rec(id1)])
    await push(store, [rec(id2)])
    await push(store, [rec('44444444-4444-4444-8444-444444444444')], { user: 'user_b' })

    const all = await (await call(store, 'GET', '/api/sync/sightings?since=0')).json() as any
    expect(all.sightings.map((s: any) => s.id)).toEqual([id1, id2])
    expect(all.hasMore).toBe(false)

    const after = await (await call(store, 'GET', `/api/sync/sightings?since=${all.sightings[0].serverSeq}`)).json() as any
    expect(after.sightings.map((s: any) => s.id)).toEqual([id2])
    expect(after.cursor).toBe(all.cursor)
  })

  it('paginates with hasMore and a resumable cursor', async () => {
    await push(store, [rec(id1), rec(id2)])
    const p1 = await (await call(store, 'GET', '/api/sync/sightings?since=0&limit=1')).json() as any
    expect(p1.sightings).toHaveLength(1)
    expect(p1.hasMore).toBe(true)
    const p2 = await (await call(store, 'GET', `/api/sync/sightings?since=${p1.cursor}&limit=1`)).json() as any
    expect(p2.sightings.map((s: any) => s.id)).toEqual([id2])
    expect(p2.hasMore).toBe(false)
  })

  it('surfaces an edit as a new seq so other devices pick it up', async () => {
    await push(store, [rec(id1, 1)])
    const first = await (await call(store, 'GET', '/api/sync/sightings?since=0')).json() as any
    await push(store, [rec(id1, 2, { notes: 'edited elsewhere' })])
    const next = await (await call(store, 'GET', `/api/sync/sightings?since=${first.cursor}`)).json() as any
    expect(next.sightings[0]).toMatchObject({ id: id1, clientVersion: 2 })
    expect(next.sightings[0].payload.notes).toBe('edited elsewhere')
  })

  it('rejects a bad cursor', async () => {
    expect((await call(store, 'GET', '/api/sync/sightings?since=-1')).status).toBe(400)
  })
})

describe('DELETE /api/sync/sightings/:id', () => {
  it('tombstones the sighting and its photos for the owner only', async () => {
    await push(store, [rec(id1)])
    await call(store, 'POST', `/api/sync/photos?photoId=${photo1}&sightingId=${id1}`, { raw: JPEG })
    expect((await call(store, 'DELETE', `/api/sync/sightings/${id1}`, { user: 'user_b' })).status).toBe(404)
    expect(store.state.sightings[id1]!.deleted_at).toBeNull()

    expect((await call(store, 'DELETE', `/api/sync/sightings/${id1}`)).status).toBe(200)
    expect(store.state.sightings[id1]!.deleted_at).not.toBeNull()
    expect(store.state.photos[photo1]!.deleted_at).not.toBeNull()
    expect(store.r2.keys()).toHaveLength(0)

    const pulled = await (await call(store, 'GET', '/api/sync/sightings?since=0')).json() as any
    expect(pulled.sightings[0].deletedAt).not.toBeNull()
  })
})

describe('photos', () => {
  const upload = (opts: Opts = {}, pid = photo1, sid = id1) =>
    call(store, 'POST', `/api/sync/photos?photoId=${pid}&sightingId=${sid}&width=800&height=600`, { raw: JPEG, ...opts })

  beforeEach(async () => { await push(store, [rec(id1)]) })

  it('stores the image under a server-derived per-user key and is idempotent', async () => {
    expect((await upload()).status).toBe(201)
    expect(store.r2.keys()).toEqual([`user-photos/user_a/${photo1}.jpg`])
    const again = await upload()
    expect(again.status).toBe(200)
    expect(await again.json()).toMatchObject({ alreadyStored: true })
    expect(Object.keys(store.state.photos)).toHaveLength(1)
    expect(store.state.ledger.filter((l) => l.reason === 'photo_sync')).toHaveLength(1)
  })

  it('accepts webp', async () => {
    expect((await upload({ raw: WEBP, type: 'image/webp' })).status).toBe(201)
    expect(store.r2.keys()[0]).toMatch(/\.webp$/)
  })

  it('rejects non-image content types, mismatched bytes and oversize bodies', async () => {
    expect((await upload({ type: 'text/html' })).status).toBe(415)
    expect((await upload({ raw: new Uint8Array([1, 2, 3, 4, 5]) })).status).toBe(415)
    expect((await upload({ raw: new Uint8Array(8 * 1024 * 1024 + 1).fill(0xff) })).status).toBe(413)
    expect(store.r2.keys()).toHaveLength(0)
  })

  it('requires the sighting to exist and belong to the caller', async () => {
    expect((await upload({}, photo1, id2)).status).toBe(404)
    expect((await upload({ user: 'user_b' })).status).toBe(404)
    expect(store.r2.keys()).toHaveLength(0)
  })

  it('refuses a photo id already owned by someone else', async () => {
    await upload()
    await push(store, [rec(id2)], { user: 'user_b' })
    const res = await upload({ user: 'user_b' }, photo1, id2)
    expect(res.status).toBe(403)
    expect(store.state.photos[photo1]!.user_id).toBe('user_a')
  })

  it('streams a photo to its owner only', async () => {
    await upload()
    const mine = await call(store, 'GET', `/api/sync/photos/${photo1}`)
    expect(mine.status).toBe(200)
    expect(mine.headers.get('Content-Type')).toBe('image/jpeg')
    expect(mine.headers.get('Cache-Control')).toContain('no-store')
    expect(new Uint8Array(await mine.arrayBuffer())).toEqual(JPEG)

    expect((await call(store, 'GET', `/api/sync/photos/${photo1}`, { user: 'user_b' })).status).toBe(404)
    expect((await call(store, 'GET', `/api/sync/photos/${photo1}`, { anon: true })).status).toBe(401)
  })

  it('tombstones for the owner, removes the object and stops serving it', async () => {
    await upload()
    expect((await call(store, 'DELETE', `/api/sync/photos/${photo1}`, { user: 'user_b' })).status).toBe(404)
    expect(store.r2.keys()).toHaveLength(1)
    expect((await call(store, 'DELETE', `/api/sync/photos/${photo1}`)).status).toBe(200)
    expect((await call(store, 'DELETE', `/api/sync/photos/${photo1}`)).status).toBe(200)
    expect(store.r2.keys()).toHaveLength(0)
    expect((await call(store, 'GET', `/api/sync/photos/${photo1}`)).status).toBe(404)
    expect((await upload()).status).toBe(410)
  })

  it('rejects a state-changing photo request from another origin', async () => {
    expect((await upload({ headers: { Origin: 'https://evil.test' } })).status).toBe(403)
    expect(store.r2.keys()).toHaveLength(0)
  })
})

describe('credit ledger', () => {
  const credits = (opts: Opts = {}) => call(store, 'GET', '/api/credits', opts)

  it('grants the signup credits exactly once per account', async () => {
    const first = await (await credits()).json() as any
    expect(first.balance).toBe(SIGNUP_GRANT)
    await credits()
    await push(store, [rec(id1)])
    await push(store, [rec(id1)])
    const grants = store.state.ledger.filter((l) => l.reason === 'signup_grant')
    expect(grants).toHaveLength(1)
    expect(grants[0]!.idempotency_key).toBe('signup:user_a')
    expect((await (await credits()).json() as any).balance).toBe(SIGNUP_GRANT)
    // A second account gets its own grant.
    expect((await (await credits({ user: 'user_b' })).json() as any).balance).toBe(SIGNUP_GRANT)
  })

  it('meters photo sync once per photo id and keeps the cache equal to the ledger sum', async () => {
    await push(store, [rec(id1)])
    const up = () => call(store, 'POST', `/api/sync/photos?photoId=${photo1}&sightingId=${id1}`, { raw: JPEG })
    await up()
    await up()
    const body = await (await credits()).json() as any
    expect(body.balance).toBe(SIGNUP_GRANT - PHOTO_SYNC_COST)
    const sum = store.state.ledger.filter((l) => l.user_id === 'user_a').reduce((s, l) => s + l.delta, 0)
    expect(store.state.balances.user_a!.balance).toBe(sum)
    const entry = body.history.find((h: any) => h.reason === 'photo_sync')
    expect(entry).toMatchObject({ delta: -PHOTO_SYNC_COST, refType: 'photo', refId: photo1 })
  })

  it('never updates or deletes ledger rows', async () => {
    await push(store, [rec(id1)])
    await call(store, 'POST', `/api/sync/photos?photoId=${photo1}&sightingId=${id1}`, { raw: JPEG })
    await call(store, 'DELETE', `/api/sync/photos/${photo1}`)
    await credits()
    const touching = store.log.filter((l) => /credit_ledger/.test(l.sql) && /^\s*(UPDATE|DELETE)/i.test(l.sql))
    expect(touching).toEqual([])
    expect(store.state.ledger.filter((l) => l.reason === 'photo_sync')).toHaveLength(1)
  })

  it('records metering but never blocks when enforcement is off, even at a negative balance', async () => {
    await push(store, [rec(id1)])
    store.state.ledger.push({
      id: 'x', user_id: 'user_a', delta: -SIGNUP_GRANT - 100, reason: 'adjustment', ref_type: null,
      ref_id: null, idempotency_key: 'adj:1', created_at: 1,
    })
    expect((await call(store, 'POST', `/api/sync/photos?photoId=${photo1}&sightingId=${id1}`, { raw: JPEG })).status).toBe(201)
  })

  it('returns 402 for photos only when enforcement is on and the balance is short', async () => {
    await push(store, [rec(id1)])
    store.state.ledger.push({
      id: 'x', user_id: 'user_a', delta: -SIGNUP_GRANT, reason: 'adjustment', ref_type: null,
      ref_id: null, idempotency_key: 'adj:1', created_at: 1,
    })
    store.state.balances.user_a = { balance: 0, updated_at: 1 }
    const res = await call(store, 'POST', `/api/sync/photos?photoId=${photo1}&sightingId=${id1}`, {
      raw: JPEG, env: { CREDITS_ENFORCED: 'true' },
    })
    expect(res.status).toBe(402)
    expect(store.r2.keys()).toHaveLength(0)
    // Sightings (not metered) still sync.
    expect((await push(store, [rec(id2)], { env: { CREDITS_ENFORCED: 'true' } })).status).toBe(200)
  })

  it('pages history newest first with a cursor, and requires a session', async () => {
    await credits()
    const base = Date.now() + 10_000
    for (let i = 0; i < 3; i++) {
      store.state.ledger.push({
        id: `e${i}`, user_id: 'user_a', delta: 1, reason: 'adjustment', ref_type: null,
        ref_id: null, idempotency_key: `k${i}`, created_at: base + i,
      })
    }
    const p1 = await (await call(store, 'GET', '/api/credits?limit=2')).json() as any
    expect(p1.history.map((h: any) => h.id)).toEqual(['e2', 'e1'])
    expect(p1.next).toEqual({ createdAt: base + 1, id: 'e1' })
    const p2 = await (await call(store, 'GET', `/api/credits?limit=2&beforeAt=${p1.next.createdAt}&beforeId=${p1.next.id}`)).json() as any
    expect(p2.history.map((h: any) => h.id)).toEqual(['e0', expect.any(String)])
    expect(p1.enforced).toBe(false)
    expect((await credits({ anon: true })).status).toBe(401)
  })
})

describe('GET /api/sync/photos (pull)', () => {
  const upload = (pid: string, sid = id1, opts: Opts = {}) =>
    call(store, 'POST', `/api/sync/photos?photoId=${pid}&sightingId=${sid}&width=800&height=600`, { raw: JPEG, ...opts })
  const pull = async (qs = '', opts: Opts = {}) =>
    (await call(store, 'GET', `/api/sync/photos${qs}`, opts)).json() as Promise<any>
  const p = (n: number) => `55555555-5555-4555-8555-55555555555${n}`

  beforeEach(async () => { await push(store, [rec(id1)]) })

  it('requires a session and a valid cursor', async () => {
    expect((await call(store, 'GET', '/api/sync/photos', { anon: true })).status).toBe(401)
    expect((await call(store, 'GET', '/api/sync/photos?since=-1')).status).toBe(400)
    expect((await call(store, 'GET', '/api/sync/photos?since=abc')).status).toBe(400)
  })

  it('returns metadata after the cursor, including tombstones, and no bytes', async () => {
    await upload(p(1)); await upload(p(2))
    const all = await pull()
    expect(all.photos.map((x: any) => x.id)).toEqual([p(1), p(2)])
    expect(all.photos[0]).toMatchObject({ sightingId: id1, width: 800, height: 600, bytes: JPEG.length, deletedAt: null })
    expect(JSON.stringify(all)).not.toContain('user-photos')

    await call(store, 'DELETE', `/api/sync/photos/${p(1)}`)
    const next = await pull(`?since=${all.cursor}`)
    expect(next.photos.map((x: any) => x.id)).toEqual([p(1)])
    expect(next.photos[0].deletedAt).not.toBeNull()
    expect((await pull(`?since=${next.cursor}`)).photos).toEqual([])
  })

  it('pages with a stable cursor and never splits photos tombstoned together', async () => {
    await upload(p(1)); await upload(p(2)); await upload(p(3))
    // One sighting delete tombstones all three under a single seq.
    await call(store, 'DELETE', `/api/sync/sightings/${id1}`)
    const seen: string[] = []
    let since = 0
    for (let i = 0; i < 10; i++) {
      const page = await pull(`?since=${since}&limit=2`)
      seen.push(...page.photos.map((x: any) => x.id))
      since = page.cursor
      if (!page.hasMore) break
    }
    expect(new Set(seen)).toEqual(new Set([p(1), p(2), p(3)]))
  })

  it("never returns another tenant's photos", async () => {
    await upload(p(1))
    expect((await pull('', { user: 'user_b' })).photos).toEqual([])
    await push(store, [rec(id2)], { user: 'user_b' })
    await upload(p(2), id2, { user: 'user_b' })
    expect((await pull()).photos.map((x: any) => x.id)).toEqual([p(1)])
    expect((await pull('', { user: 'user_b' })).photos.map((x: any) => x.id)).toEqual([p(2)])
  })
})
