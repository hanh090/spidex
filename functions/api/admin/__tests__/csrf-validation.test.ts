import { describe, expect, it } from 'vitest'
import { onRequest } from '../[[catchall]]'
import { signSession } from '../../../lib/session'
import { fakeD1 } from '../../../lib/__tests__/fakes'

const SECRET = 's3cret'
const env = { SESSION_SECRET: SECRET, ADMIN_EMAILS: 'boss@x.co' }

async function call(method: string, path: string, opts: { body?: unknown; origin?: string | null; db?: ReturnType<typeof fakeD1> } = {}) {
  const token = await signSession({ userId: 'admin', email: 'boss@x.co', emailVerified: true }, SECRET)
  const headers: Record<string, string> = { Cookie: `spidex_session=${token}`, 'Content-Type': 'application/json' }
  if (opts.origin !== null) headers.Origin = opts.origin ?? 'https://x.test'
  return onRequest({
    request: new Request(`https://x.test${path}`, {
      method,
      headers,
      body: opts.body === undefined ? undefined : typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body),
    }),
    env: { ...env, DB: opts.db ?? fakeD1(() => ({ meta: { changes: 1 } })) },
  })
}

describe('admin csrf', () => {
  const routes: [string, string, unknown][] = [
    ['POST', '/api/admin/resources', { kind: 'k', title: 't' }],
    ['PATCH', '/api/admin/resources/r1', { title: 't' }],
    ['DELETE', '/api/admin/resources/r1', undefined],
    ['POST', '/api/admin/packs/p1/publish', { published: false }],
    ['POST', '/api/admin/submissions/sub_1/approve', undefined],
    ['POST', '/api/admin/submissions/sub_1/reject', undefined],
    ['PUT', '/api/admin/media/packs/p1/upload?path=img/a.webp', undefined],
  ]

  it.each(routes)('refuses cross-origin %s %s without touching D1', async (method, path, body) => {
    const db = fakeD1(() => ({ meta: { changes: 1 } }))
    const res = await call(method, path, { body, origin: 'https://evil.test', db })
    expect(res.status).toBe(403)
    expect(db.log).toHaveLength(0)
  })

  it('refuses a state-changing request with no Origin at all', async () => {
    expect((await call('POST', '/api/admin/resources', { body: { kind: 'k', title: 't' }, origin: null })).status).toBe(403)
  })

  it('still serves same-origin GET and mutations', async () => {
    expect((await call('GET', '/api/admin/me')).status).toBe(200)
    expect((await call('POST', '/api/admin/resources', { body: { kind: 'k', title: 't' } })).status).toBe(201)
  })
})

describe('admin body validation', () => {
  it.each([
    ['missing kind', { title: 't' }],
    ['blank title', { kind: 'k', title: '   ' }],
    ['oversized title', { kind: 'k', title: 'x'.repeat(301) }],
    ['non-object meta', { kind: 'k', title: 't', meta: 'str' }],
    ['non-boolean published', { kind: 'k', title: 't', published: 'yes' }],
    ['non-numeric sort', { kind: 'k', title: 't', sort: 'high' }],
  ])('create rejects %s with 400 JSON', async (_n, body) => {
    const db = fakeD1(() => ({ meta: { changes: 1 } }))
    const res = await call('POST', '/api/admin/resources', { body, db })
    expect(res.status).toBe(400)
    expect(await res.json()).toHaveProperty('error')
    expect(db.log.some((l) => /INSERT/.test(l.sql))).toBe(false)
  })

  it('create rejects malformed JSON', async () => {
    expect((await call('POST', '/api/admin/resources', { body: '{nope' })).status).toBe(400)
  })

  it.each([
    ['numeric title', { title: 5 }],
    ['array meta', { meta: [] }],
    ['string published', { published: 'x' }],
  ])('patch rejects %s', async (_n, body) => {
    expect((await call('PATCH', '/api/admin/resources/r1', { body })).status).toBe(400)
  })

  it('patch applies valid fields', async () => {
    const db = fakeD1(() => ({ meta: { changes: 1 } }))
    const res = await call('PATCH', '/api/admin/resources/r1', { body: { title: 'new', published: false, sort: 3 }, db })
    expect(res.status).toBe(200)
    const upd = db.log.find((l) => /^UPDATE admin_resources/.test(l.sql))!
    expect(upd.args).toContain('new')
    expect(upd.args).toContain(0)
    expect(upd.args).toContain(3)
  })

  it('publish rejects a non-boolean flag but accepts an empty body', async () => {
    expect((await call('POST', '/api/admin/packs/p1/publish', { body: { published: 'no' } })).status).toBe(400)
    expect((await call('POST', '/api/admin/packs/p1/publish')).status).toBe(200)
  })
})
