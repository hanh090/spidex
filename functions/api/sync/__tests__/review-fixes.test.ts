/**
 * Regression tests for the sync endpoints: D1 query budget per request (Free
 * plan: 50 per invocation, every batched statement counts), delete-wins
 * ordering, photo/sighting races, credit overdraft and malformed input.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { onRequest as syncRoute } from '../[[catchall]]'
import { onRequest as creditsRoute } from '../../credits/[[catchall]]'
import { signSession } from '../../../lib/session'
import { fakeSyncStore } from '../../../lib/__tests__/fakes'
import { PHOTO_SYNC_COST, SIGNUP_GRANT } from '../../../lib/ledger'
import { MAX_BATCH } from '../../../lib/sync-sightings'

const SECRET = 's3cret'
const ORIGIN = 'https://x.test'
/** Hard Free-plan limit is 50; keep headroom. */
const QUERY_BUDGET = 45
type Store = ReturnType<typeof fakeSyncStore>

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4])
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const photoId = (n: number) => `11111111-0000-4000-8000-${String(n).padStart(12, '0')}`

interface CallOpts {
  user?: string
  body?: unknown
  raw?: Uint8Array<ArrayBuffer>
  env?: Record<string, unknown>
  db?: unknown
}

async function call(store: Store, method: string, path: string, opts: CallOpts = {}) {
  const user = opts.user ?? 'user_a'
  const headers: Record<string, string> = {
    Origin: ORIGIN,
    Cookie: `spidex_session=${await signSession({ userId: user, email: `${user}@x.co`, emailVerified: true }, SECRET)}`,
  }
  let body: BodyInit | undefined
  if (opts.raw) { body = new Blob([opts.raw]); headers['Content-Type'] = 'image/jpeg' }
  else if (opts.body !== undefined) { body = JSON.stringify(opts.body); headers['Content-Type'] = 'application/json' }
  const handler = path.startsWith('/api/credits') ? creditsRoute : syncRoute
  return handler({
    request: new Request(`${ORIGIN}${path}`, { method, body, headers }),
    env: { SESSION_SECRET: SECRET, DB: opts.db ?? store.db, PACKS: store.r2, ...opts.env },
  } as never)
}

const rec = (id: string, clientVersion = 1, extra: Record<string, unknown> = {}) => ({
  id, clientVersion,
  payload: {
    count: 1, at: Date.now() - 60_000, tzOffsetMinutes: 420, clockConfidence: 'trusted',
    notes: `v${clientVersion}`, updatedAt: Date.now(),
  },
  ...extra,
})
const push = (store: Store, records: unknown[], user?: string) =>
  call(store, 'POST', '/api/sync/sightings', { body: { records }, user })
const upload = (store: Store, pid: string, sid: string, o: CallOpts = {}) =>
  call(store, 'POST', `/api/sync/photos?photoId=${pid}&sightingId=${sid}&width=8&height=8`, { raw: JPEG, ...o })

/** Statements run by `fn`, counted the way D1 Free counts them. */
async function queriesOf(store: Store, fn: () => Promise<Response>): Promise<{ res: Response; queries: number }> {
  const before = store.log.length
  const res = await fn()
  return { res, queries: store.log.length - before }
}

let store: Store
beforeEach(() => { store = fakeSyncStore() })

describe('D1 query budget per request', () => {
  it('a full push batch from a brand-new account stays under the budget, replays included', async () => {
    const batch = Array.from({ length: MAX_BATCH }, (_, i) => rec(uuid(i + 1)))
    const first = await queriesOf(store, () => push(store, batch))
    expect(first.res.status).toBe(200)
    expect(first.queries).toBeLessThanOrEqual(QUERY_BUDGET)
    const replay = await queriesOf(store, () => push(store, batch))
    expect(replay.queries).toBeLessThanOrEqual(QUERY_BUDGET)
    // A batch of stale edits (read-back path) costs the same per record.
    const stale = await queriesOf(store, () =>
      push(store, batch.map((r) => ({ ...r, clientVersion: 1, payload: { ...r.payload, notes: 'other' } }))))
    expect(stale.queries).toBeLessThanOrEqual(QUERY_BUDGET)
    expect(((await stale.res.json()) as { results: { result: string }[] }).results.every((r) => r.result === 'stale')).toBe(true)
  })

  it('one record more than the cap is refused before any query runs', async () => {
    const before = store.log.length
    const res = await push(store, Array.from({ length: MAX_BATCH + 1 }, (_, i) => rec(uuid(i + 1))))
    expect(res.status).toBe(413)
    expect(store.log.length).toBe(before)
  })

  it('tombstone, photo upload (credits enforced), pulls and credits stay under the budget', async () => {
    await push(store, [rec(uuid(1))])
    const up = await queriesOf(store, () => upload(store, photoId(1), uuid(1), { env: { CREDITS_ENFORCED: 'true' } }))
    expect(up.res.status).toBe(201)
    expect(up.queries).toBeLessThanOrEqual(QUERY_BUDGET)

    for (const path of ['/api/sync/sightings?since=0', '/api/sync/photos?since=0', '/api/credits']) {
      const r = await queriesOf(store, () => call(store, 'GET', path))
      expect(r.res.status).toBe(200)
      expect(r.queries).toBeLessThanOrEqual(QUERY_BUDGET)
    }

    const del = await queriesOf(store, () => call(store, 'DELETE', `/api/sync/sightings/${uuid(1)}`))
    expect(del.res.status).toBe(200)
    expect(del.queries).toBeLessThanOrEqual(QUERY_BUDGET)
  })
})

describe('a delete wins over a stale edit', () => {
  const id = uuid(7)
  beforeEach(async () => {
    await push(store, [rec(id, 1)])
    await call(store, 'DELETE', `/api/sync/sightings/${id}`)
  })

  it('reports a higher-version edit of a tombstoned sighting as stale with the tombstone', async () => {
    const res = await push(store, [rec(id, 2)])
    const [r] = ((await res.json()) as { results: { result: string; server?: { deletedAt: number | null } }[] }).results
    expect(r!.result).toBe('stale')
    expect(r!.server!.deletedAt).toEqual(expect.any(Number))
    expect(store.state.sightings[id]!.deleted_at).not.toBeNull()
    expect(store.state.sightings[id]!.client_version).toBe(1)
  })

  it('restores only on an explicit restore with a newer version', async () => {
    const lower = await push(store, [rec(id, 1, { restore: true })])
    expect(((await lower.json()) as any).results[0].result).toBe('stale')
    const ok = await push(store, [rec(id, 2, { restore: true })])
    expect(((await ok.json()) as any).results[0].result).toBe('applied')
    expect(store.state.sightings[id]!.deleted_at).toBeNull()
  })

  it('another account cannot restore it', async () => {
    const res = await push(store, [rec(id, 5, { restore: true })], 'user_b')
    expect(((await res.json()) as any).results[0]).toMatchObject({ result: 'rejected', reason: 'not_owner' })
    expect(store.state.sightings[id]!.deleted_at).not.toBeNull()
  })
})

describe('photo upload races', () => {
  const sid = uuid(1)
  beforeEach(async () => { await push(store, [rec(sid)]) })

  /** A db whose next batch is preceded by a concurrent change. */
  const racingDb = (hook: () => void) => ({
    prepare: store.db.prepare,
    async batch(stmts: Parameters<typeof store.db.batch>[0]) {
      hook()
      return store.db.batch(stmts)
    },
  })

  it('a sighting deleted mid-upload leaves no photo row, no object and no charge', async () => {
    const db = racingDb(() => { store.state.sightings[sid]!.deleted_at = Date.now() })
    const res = await upload(store, photoId(1), sid, { db })
    expect(res.status).toBe(404)
    expect(Object.keys(store.state.photos)).toHaveLength(0)
    expect(store.r2.keys()).toHaveLength(0)
    expect(store.state.ledger.filter((l) => l.reason === 'photo_sync')).toHaveLength(0)
  })

  it('tombstoning reads the photo keys after the batch, so a concurrent photo is not orphaned', async () => {
    await upload(store, photoId(1), sid)
    store.log.length = 0
    await call(store, 'DELETE', `/api/sync/sightings/${sid}`)
    const sqls = store.log.map((l) => l.sql)
    const tomb = sqls.findIndex((q) => q.startsWith('UPDATE photos'))
    const keys = sqls.findIndex((q) => q.startsWith('SELECT r2_key'))
    expect(tomb).toBeGreaterThanOrEqual(0)
    expect(keys).toBeGreaterThan(tomb)
    expect(store.r2.keys()).toHaveLength(0)
  })
})

describe('credits enforcement', () => {
  const sid = uuid(1)
  const env = { CREDITS_ENFORCED: 'true' }
  beforeEach(async () => {
    await push(store, [rec(sid)])
    // Leave exactly one photo's worth of credit.
    await call(store, 'GET', '/api/credits')
    store.state.ledger.push({
      id: 'adj', user_id: 'user_a', delta: -(SIGNUP_GRANT - PHOTO_SYNC_COST), reason: 'adjustment',
      ref_type: null, ref_id: null, idempotency_key: 'adj', created_at: 1,
    })
  })

  it('concurrent uploads cannot overdraw: one lands, the other gets 402, balance never goes negative', async () => {
    const [a, b] = await Promise.all([
      upload(store, photoId(1), sid, { env }),
      upload(store, photoId(2), sid, { env }),
    ])
    expect([a.status, b.status].sort()).toEqual([201, 402])
    expect(store.state.ledger.reduce((n, r) => n + r.delta, 0)).toBe(0)
    expect(Object.keys(store.state.photos)).toHaveLength(1)
    // The refused upload's object is removed.
    expect(store.r2.keys()).toHaveLength(1)
  })
})

describe('malformed input is a 400, not a 500', () => {
  it('malformed percent escapes in ids', async () => {
    expect((await call(store, 'DELETE', '/api/sync/sightings/%E0%A4%A')).status).toBe(400)
    expect((await call(store, 'GET', '/api/sync/photos/%E0%A4%A')).status).toBe(400)
  })
  it('a bad credits cursor', async () => {
    expect((await call(store, 'GET', '/api/credits?beforeAt=1e400&beforeId=x')).status).toBe(400)
    expect((await call(store, 'GET', '/api/credits?beforeAt=1.5&beforeId=x')).status).toBe(400)
  })
})

describe('ledger append-only guard', () => {
  it('no source statement can REPLACE into the ledger (that would bypass the DELETE trigger)', () => {
    const offenders: string[] = []
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name)
        if (statSync(p).isDirectory()) {
          if (name !== '__tests__' && name !== 'node_modules') walk(p)
          continue
        }
        if (!/\.(ts|sql)$/.test(name)) continue
        if (/INSERT\s+OR\s+REPLACE|REPLACE\s+INTO/i.test(readFileSync(p, 'utf8'))) offenders.push(p)
      }
    }
    for (const root of ['functions', 'server', 'migrations']) walk(join(process.cwd(), root))
    expect(offenders).toEqual([])
  })
})
