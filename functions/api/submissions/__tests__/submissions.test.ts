import { describe, expect, it } from 'vitest'
import { onRequest } from '../[[catchall]]'
import { signSession } from '../../../lib/session'
import { fakeD1, fakeR2, htmlFallback } from '../../../lib/__tests__/fakes'

const SECRET = 's3cret'
const baseEnv = { SESSION_SECRET: SECRET }

async function call(method: string, path: string, env: object, opts: { body?: object | string; user?: string } = {}) {
  const token = await signSession({ userId: opts.user ?? 'u1', email: `${opts.user ?? 'u1'}@x.co`, emailVerified: true }, SECRET)
  const body = typeof opts.body === 'string' ? opts.body : opts.body ? JSON.stringify(opts.body) : undefined
  return onRequest({
    request: new Request(`https://x.test${path}`, { method, body, headers: { Origin: 'https://x.test', Cookie: `spidex_session=${token}`, ...(body ? { 'Content-Length': String(body.length) } : {}) } }),
    env: { ...baseEnv, ...env },
  })
}

const subRow = (meta: object) => ({
  id: 'sub_1', kind: 'submission', title: 'x', published: 0, sort: 0, updated_at: 1,
  meta: JSON.stringify({ packId: 'x', submitter: { userId: 'u1', email: 'u1@x.co' }, status: 'uploading', fileCount: 3, totalBytes: 100, receivedFiles: 0, receivedBytes: 0, ...meta }),
})

describe('DELETE /api/submissions/:id', () => {
  const live = { 'packs/x/pack.json': 'live', 'submissions/pub_9/pack.json': 'live-staged-prefix' }
  const staging = { 'submissions/sub_1/pack.json': 'a', 'submissions/sub_1/img/1.webp': 'b', 'submissions/sub_1/img/2.webp': 'c', 'submissions/sub_10/pack.json': 'other' }

  it('deletes only the submission staging prefix, across pages', async () => {
    const r2 = fakeR2({ ...live, ...staging })
    const db = fakeD1((sql) => (sql.startsWith('SELECT') ? subRow({}) : { meta: { changes: 1 } }))
    const res = await call('DELETE', '/api/submissions/sub_1', { DB: db, PACKS: r2 })
    expect(res.status).toBe(200)
    expect([...r2.store.keys()].sort()).toEqual(['packs/x/pack.json', 'submissions/pub_9/pack.json', 'submissions/sub_10/pack.json'])
  })

  it('refuses (and deletes nothing) when the submission is no longer withdrawable', async () => {
    const r2 = fakeR2({ ...live, ...staging })
    const db = fakeD1((sql) => (sql.startsWith('SELECT') ? subRow({ status: 'published' }) : { meta: { changes: 0 } }))
    const res = await call('DELETE', '/api/submissions/sub_1', { DB: db, PACKS: r2 })
    expect(res.status).toBe(409)
    expect(r2.store.size).toBe(Object.keys({ ...live, ...staging }).length)
  })

  it('returns 503 JSON without a database', async () => {
    const res = await call('DELETE', '/api/submissions/sub_1', {})
    expect(res.status).toBe(503)
    expect(await res.json()).toHaveProperty('error')
  })

  it('rejects another user', async () => {
    const db = fakeD1(() => subRow({}))
    expect((await call('DELETE', '/api/submissions/sub_1', { DB: db, PACKS: fakeR2() }, { user: 'u2' })).status).toBe(403)
  })
})

describe('PUT /api/submissions/:id/files', () => {
  const put = (db: ReturnType<typeof fakeD1>, r2 = fakeR2()) =>
    call('PUT', '/api/submissions/sub_1/files?path=img/a.webp', { DB: db, PACKS: r2 }, { body: 'x'.repeat(10) }).then((res) => ({ res, r2 }))

  it('stages under submissions/<id>/ after atomically reserving a slot', async () => {
    const db = fakeD1((sql) => (sql.startsWith('SELECT') ? subRow({}) : { meta: { changes: 1 } }))
    const { res, r2 } = await put(db)
    expect(res.status).toBe(200)
    expect([...r2.store.keys()]).toEqual(['submissions/sub_1/img/a.webp'])
    expect(db.log.some((l) => /json_set/.test(l.sql) && /receivedFiles/.test(l.sql) && /WHERE/.test(l.sql))).toBe(true)
  })

  it('rejects the upload when the guarded counter update matches no row (over budget / racing)', async () => {
    const db = fakeD1((sql) => (sql.startsWith('SELECT') ? subRow({}) : { meta: { changes: 0 } }))
    const { res, r2 } = await put(db)
    expect(res.status).toBe(413)
    expect(r2.store.size).toBe(0)
  })
})

describe('POST /api/submissions', () => {
  const body = { packId: 'new-pack', fileCount: 3, totalBytes: 1000 }
  const ok = (sql: string) => (/COUNT/.test(sql) ? { n: 0 } : /FROM admin_resources WHERE kind = 'pack'/.test(sql) ? null : { meta: { changes: 1 } })
  const assets = (res: Response) => ({ fetch: async () => res })

  it.each(['img', 'audio', 'fonts', 'packs', 'icons', 'assets', 'submissions', 'index'])('rejects reserved id %s', async (packId) => {
    const res = await call('POST', '/api/submissions', { DB: fakeD1(ok), PACKS: fakeR2() }, { body: { ...body, packId } })
    expect(res.status).toBe(400)
  })

  it('does not treat the SPA html fallback as an existing pack', async () => {
    const res = await call('POST', '/api/submissions', { DB: fakeD1(ok), PACKS: fakeR2(), ASSETS: assets(htmlFallback()) }, { body })
    expect(res.status).toBe(201)
  })

  it('409s when a real static pack has that id', async () => {
    const res = await call('POST', '/api/submissions', { DB: fakeD1(ok), PACKS: fakeR2(), ASSETS: assets(new Response('{}', { headers: { 'Content-Type': 'application/json' } })) }, { body })
    expect(res.status).toBe(409)
  })

  it('409s when any pack row (even unpublished) belongs to someone else', async () => {
    const db = fakeD1((sql) => (/kind = 'pack'/.test(sql) ? { meta: JSON.stringify({ community: true, submittedBy: { userId: 'someone-else' } }) } : ok(sql)))
    expect((await call('POST', '/api/submissions', { DB: db, PACKS: fakeR2() }, { body })).status).toBe(409)
  })

  it('lets the pack author resubmit', async () => {
    const db = fakeD1((sql) => (/kind = 'pack'/.test(sql) ? { meta: JSON.stringify({ community: true, submittedBy: { userId: 'u1' } }) } : ok(sql)))
    expect((await call('POST', '/api/submissions', { DB: db, PACKS: fakeR2() }, { body })).status).toBe(201)
  })

  it("discards the caller's own stale uploading attempt for the same pack id and stages a fresh one", async () => {
    const r2 = fakeR2({ 'submissions/sub_old/pack.json': 'a', 'submissions/sub_old/img/1.webp': 'b', 'submissions/sub_other/pack.json': 'keep' })
    const db = fakeD1((sql) => (/^SELECT id/.test(sql) ? [{ id: 'sub_old' }] : ok(sql)))
    const res = await call('POST', '/api/submissions', { DB: db, PACKS: r2 }, { body })
    expect(res.status).toBe(201)
    expect([...r2.store.keys()]).toEqual(['submissions/sub_other/pack.json'])
    const stale = db.log.find((l) => /^SELECT id/.test(l.sql))!
    expect(stale.args).toEqual(['new-pack', 'u1'])
    expect(db.log.some((l) => /'withdrawn'/.test(l.sql) && l.args[1] === 'sub_old')).toBe(true)
  })

  it('keeps the stale attempt when its withdraw loses a race to completion', async () => {
    const r2 = fakeR2({ 'submissions/sub_old/pack.json': 'a' })
    const db = fakeD1((sql) => (/^SELECT id/.test(sql) ? [{ id: 'sub_old' }] : /'withdrawn'/.test(sql) ? { meta: { changes: 0 } } : ok(sql)))
    await call('POST', '/api/submissions', { DB: db, PACKS: r2 }, { body })
    expect(r2.store.has('submissions/sub_old/pack.json')).toBe(true)
  })

  it('409s when the atomic claim insert loses a race', async () => {
    const db = fakeD1((sql) => (/^INSERT/.test(sql.trim()) ? { meta: { changes: 0 } } : ok(sql)))
    expect((await call('POST', '/api/submissions', { DB: db, PACKS: fakeR2() }, { body })).status).toBe(409)
  })
})

describe('error responses', () => {
  it('hide internal error text', async () => {
    const db = fakeD1(() => { throw new Error('D1_ERROR: secret table detail') })
    const res = await call('DELETE', '/api/submissions/sub_1', { DB: db })
    expect(res.status).toBe(500)
    expect(JSON.stringify(await res.json())).not.toContain('secret table')
  })
})
