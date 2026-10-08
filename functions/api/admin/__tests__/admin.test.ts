import { describe, expect, it } from 'vitest'
import { onRequest } from '../[[catchall]]'
import { signSession } from '../../../lib/session'
import { fakeD1, fakeR2 } from '../../../lib/__tests__/fakes'

const SECRET = 's3cret'
const baseEnv = { SESSION_SECRET: SECRET, ADMIN_EMAILS: 'boss@x.co' }

async function call(method: string, path: string, env: object, emailVerified = true) {
  const token = await signSession({ userId: 'admin', email: 'boss@x.co', emailVerified }, SECRET)
  return onRequest({
    request: new Request(`https://x.test${path}`, { method, headers: { Origin: 'https://x.test', Cookie: `spidex_session=${token}` } }),
    env: { ...baseEnv, ...env },
  })
}

const sub = (status: string) => ({
  id: 'sub_1', kind: 'submission', title: 'x', published: 0, sort: 0, updated_at: 1,
  meta: JSON.stringify({ packId: 'x', submitter: { userId: 'u1', email: 'u1@x.co' }, status, summary: { region: 'VN' } }),
})

describe('admin gate', () => {
  it('refuses an unverified email even when allowlisted', async () => {
    expect((await call('GET', '/api/admin/overview', { DB: fakeD1(() => null) }, false)).status).toBe(403)
  })
})

describe('host gate', () => {
  it('404s every admin route on a non-matching host', async () => {
    const res = await call('GET', '/api/admin/me', { ADMIN_HOST: 'admin.test' })
    expect(res.status).toBe(404)
  })

  it('answers normally on the matching host', async () => {
    const res = await call('GET', '/api/admin/me', { ADMIN_HOST: 'x.test' })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ isAdmin: true })
  })

  it('is open when ADMIN_HOST is unset', async () => {
    const res = await call('GET', '/api/admin/me', {})
    expect(res.status).toBe(200)
  })
})

describe('approve / reject', () => {
  const approve = (db: ReturnType<typeof fakeD1>, extra: object = { PACKS: fakeR2() }) =>
    call('POST', '/api/admin/submissions/sub_1/approve', { DB: db, ...extra })

  it('refuses when the PACKS bucket is not bound', async () => {
    const db = fakeD1(() => sub('pending'))
    expect((await approve(db, {})).status).toBe(503)
    expect(db.log.some((l) => /UPDATE|INSERT/.test(l.sql))).toBe(false)
  })

  it('approves only pending submissions', async () => {
    expect((await approve(fakeD1(() => sub('uploading')))).status).toBe(409)
    expect((await approve(fakeD1(() => sub('published')))).status).toBe(409)
  })

  it('loses cleanly to a concurrent approval', async () => {
    const db = fakeD1((sql) => (/^SELECT/.test(sql) ? (/kind = 'pack'/.test(sql) ? null : sub('pending')) : { meta: { changes: 0 } }))
    const res = await approve(db)
    expect(res.status).toBe(409)
    expect(db.log.some((l) => /^INSERT/.test(l.sql.trim()))).toBe(false)
  })

  it('records the staging prefix in the pack row', async () => {
    const db = fakeD1((sql) => (/^SELECT/.test(sql) ? (/kind = 'pack'/.test(sql) ? null : sub('pending')) : { meta: { changes: 1 } }))
    const res = await approve(db)
    expect(res.status).toBe(200)
    const insert = db.log.find((l) => /^INSERT INTO admin_resources/.test(l.sql.trim()) && l.args[0] === 'x')!
    expect(JSON.parse(insert.args[2] as string)).toMatchObject({ community: true, prefix: 'submissions/sub_1' })
  })

  describe('re-approving a community pack', () => {
    const DAY = 24 * 60 * 60 * 1000
    const run = async (prevMeta: object) => {
      const r2 = fakeR2({
        'submissions/sub_prev/pack.json': 'v1', 'submissions/sub_ancient/pack.json': 'v0', 'submissions/sub_1/pack.json': 'v2',
      })
      const db = fakeD1((sql) => (/^SELECT/.test(sql)
        ? (/kind = 'pack'/.test(sql) ? { meta: JSON.stringify({ community: true, submittedBy: { userId: 'u1' }, ...prevMeta }) } : sub('pending'))
        : { meta: { changes: 1 } }))
      const res = await approve(db, { PACKS: r2 })
      const insert = db.log.find((l) => /^INSERT INTO admin_resources/.test(l.sql.trim()) && l.args[0] === 'x')!
      return { res, r2, meta: JSON.parse(insert.args[2] as string) }
    }

    it('keeps the previous version and records it for later cleanup', async () => {
      const { res, r2, meta } = await run({ prefix: 'submissions/sub_prev' })
      expect(res.status).toBe(200)
      expect(r2.store.has('submissions/sub_prev/pack.json')).toBe(true)
      expect(meta.supersededPrefixes).toEqual([{ prefix: 'submissions/sub_prev', at: expect.any(Number) }])
    })

    it('sweeps superseded prefixes past the grace period and keeps recent ones', async () => {
      const { r2, meta } = await run({
        prefix: 'submissions/sub_prev',
        supersededPrefixes: [{ prefix: 'submissions/sub_ancient', at: Date.now() - 2 * DAY }],
      })
      expect(r2.store.has('submissions/sub_ancient/pack.json')).toBe(false)
      expect(r2.store.has('submissions/sub_prev/pack.json')).toBe(true)
      expect(meta.supersededPrefixes.map((e: { prefix: string }) => e.prefix)).toEqual(['submissions/sub_prev'])
    })
  })

  describe('a pack row whose meta points at private user photos', () => {
    it('never sweeps or records a non-pack prefix on re-approval', async () => {
      const r2 = fakeR2({ 'user-photos/u1/p.jpg': 'private', 'submissions/sub_1/pack.json': 'v2' })
      const db = fakeD1((sql) => (/^SELECT/.test(sql)
        ? (/kind = 'pack'/.test(sql)
          ? { meta: JSON.stringify({
            community: true, submittedBy: { userId: 'u1' }, prefix: 'user-photos/u1',
            supersededPrefixes: [{ prefix: 'user-photos/u1', at: 1 }],
          }) }
          : sub('pending'))
        : { meta: { changes: 1 } }))
      const res = await call('POST', '/api/admin/submissions/sub_1/approve', { DB: db, PACKS: r2 })
      expect(res.status).toBe(200)
      expect(r2.store.has('user-photos/u1/p.jpg')).toBe(true)
      const insert = db.log.find((l) => /^INSERT INTO admin_resources/.test(l.sql.trim()) && l.args[0] === 'x')!
      const meta = JSON.parse(insert.args[2] as string)
      expect(JSON.stringify(meta.supersededPrefixes)).not.toMatch(/user-photos/)
    })
  })

  it('reject deletes only the staging prefix', async () => {
    const r2 = fakeR2({ 'submissions/sub_1/a': '1', 'packs/x/pack.json': 'live' })
    const db = fakeD1((sql) => (/^SELECT/.test(sql) ? sub('pending') : { meta: { changes: 1 } }))
    const res = await call('POST', '/api/admin/submissions/sub_1/reject', { DB: db, PACKS: r2 })
    expect(res.status).toBe(200)
    expect([...r2.store.keys()]).toEqual(['packs/x/pack.json'])
  })
})

describe('overview', () => {
  it('reads the SPA html fallback as a missing manifest, not a pack', async () => {
    const assets = {
      fetch: async (req: Request) => {
        const u = new URL(req.url)
        return u.pathname.endsWith('index.json')
          ? new Response('{"packs":["a"]}', { headers: { 'Content-Type': 'application/json' } })
          : new Response('<html>', { headers: { 'Content-Type': 'text/html' } })
      },
    }
    const res = await call('GET', '/api/admin/overview', { ASSETS: assets, DB: fakeD1(() => []) })
    expect((await res.json() as { packs: unknown[] }).packs).toEqual([{ id: 'a', missing: true }])
  })
})
