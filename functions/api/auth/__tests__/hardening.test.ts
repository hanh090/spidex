import { beforeEach, describe, expect, it, vi } from 'vitest'

const um = {
  createUser: vi.fn(),
  authenticateWithPassword: vi.fn(),
  authenticateWithCode: vi.fn(),
  getUser: vi.fn(),
}
vi.mock('@workos-inc/node', () => ({
  WorkOS: class {
    userManagement = um
  },
}))

import { onRequest } from '../[[catchall]]'

const env = { WORKOS_API_KEY: 'sk_test', WORKOS_CLIENT_ID: 'client_1', SESSION_SECRET: 's3cret' }
const GOOD_PW = 'pw-long-enough'

const post = (path: string, body: unknown, e: object = env, headers: Record<string, string> = {}) =>
  onRequest({
    request: new Request(`https://x.test${path}`, {
      method: 'POST',
      body: typeof body === 'string' ? body : JSON.stringify(body),
      headers: { Origin: 'https://x.test', ...headers },
    }),
    env: e,
  })

beforeEach(() => {
  Object.values(um).forEach((f) => f.mockReset())
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('csrf', () => {
  const cross = { Origin: 'https://evil.test' }

  it.each(['/api/auth/password', '/api/auth/register', '/api/auth/callback', '/api/auth/logout'])(
    'refuses cross-origin POST %s',
    async (path) => {
      const res = await post(path, { email: 'a@x.co', password: GOOD_PW, code: 'c' }, env, cross)
      expect(res.status).toBe(403)
      expect(um.authenticateWithPassword).not.toHaveBeenCalled()
      expect(um.createUser).not.toHaveBeenCalled()
      expect(res.headers.get('Set-Cookie')).toBeNull()
    },
  )

  it('refuses a POST carrying neither Origin nor Sec-Fetch-Site', async () => {
    const res = await onRequest({ request: new Request('https://x.test/api/auth/logout', { method: 'POST' }), env })
    expect(res.status).toBe(403)
  })

  it('does not gate GET routes (OAuth redirect flow)', async () => {
    const res = await onRequest({
      request: new Request('https://x.test/api/auth/me', { headers: { Origin: 'https://evil.test' } }),
      env: {},
    })
    expect(res.status).toBe(200)
  })
})

describe('validation', () => {
  it.each([
    ['not an email', { email: 'nope', password: GOOD_PW }],
    ['missing password', { email: 'a@x.co' }],
    ['oversized password', { email: 'a@x.co', password: 'x'.repeat(300) }],
    ['oversized email', { email: `${'a'.repeat(260)}@x.co`, password: GOOD_PW }],
  ])('login rejects %s with a 400 JSON error', async (_n, body) => {
    const res = await post('/api/auth/password', body)
    expect(res.status).toBe(400)
    expect(res.headers.get('Content-Type')).toContain('application/json')
    expect(await res.json()).toHaveProperty('error')
    expect(um.authenticateWithPassword).not.toHaveBeenCalled()
  })

  it.each([
    ['short password', { email: 'a@x.co', password: 'short' }],
    ['long first name', { email: 'a@x.co', password: GOOD_PW, firstName: 'x'.repeat(101) }],
    ['non-string last name', { email: 'a@x.co', password: GOOD_PW, lastName: 5 }],
  ])('register rejects %s', async (_n, body) => {
    const res = await post('/api/auth/register', body)
    expect(res.status).toBe(400)
    expect(um.createUser).not.toHaveBeenCalled()
  })

  it('rejects non-JSON bodies and an empty callback code', async () => {
    expect((await post('/api/auth/password', 'not json')).status).toBe(400)
    expect((await post('/api/auth/callback', { code: '' })).status).toBe(400)
  })

  it('accepts a valid body with optional names', async () => {
    um.createUser.mockResolvedValue({ id: 'u1', email: 'a@x.co' })
    um.authenticateWithPassword.mockResolvedValue({ user: { id: 'u1', email: 'a@x.co' } })
    const res = await post('/api/auth/register', { email: 'a@x.co', password: GOOD_PW, firstName: 'Hạnh' })
    expect(res.status).toBe(201)
  })
})

describe('throttling', () => {
  function counterDb() {
    const counts = new Map<string, number>()
    return {
      prepare: () => {
        const make = (args: unknown[]): any => ({
          bind: (...a: unknown[]) => make(a),
          first: async () => {
            const k = `${args[0]}|${args[1]}`
            counts.set(k, (counts.get(k) ?? 0) + 1)
            return { count: counts.get(k) }
          },
          run: async () => ({ meta: { changes: 0 } }),
          all: async () => ({ results: [] }),
        })
        return make([])
      },
      batch: async () => [],
    }
  }
  const login = (db: unknown, ip = '9.9.9.9', email = 'a@x.co') =>
    post('/api/auth/password', { email, password: GOOD_PW }, { ...env, DB: db }, { 'CF-Connecting-IP': ip })

  it('429s with Retry-After after 10 attempts for one email', async () => {
    um.authenticateWithPassword.mockRejectedValue(new Error('bad'))
    const db = counterDb()
    for (let i = 0; i < 10; i++) expect((await login(db, `10.0.0.${i}`)).status).toBe(401)
    const res = await login(db, '10.0.0.99')
    expect(res.status).toBe(429)
    expect(Number(res.headers.get('Retry-After'))).toBeGreaterThan(0)
    expect(um.authenticateWithPassword).toHaveBeenCalledTimes(10)
  })

  it('429s after 30 attempts from one IP across emails', async () => {
    um.authenticateWithPassword.mockRejectedValue(new Error('bad'))
    const db = counterDb()
    for (let i = 0; i < 30; i++) expect((await login(db, '8.8.8.8', `u${i}@x.co`)).status).toBe(401)
    expect((await login(db, '8.8.8.8', 'fresh@x.co')).status).toBe(429)
  })

  it('throttles register separately from login', async () => {
    um.createUser.mockRejectedValue(new Error('exists'))
    const db = counterDb()
    const reg = () => post('/api/auth/register', { email: 'a@x.co', password: GOOD_PW }, { ...env, DB: db })
    for (let i = 0; i < 10; i++) expect((await reg()).status).toBe(400)
    expect((await reg()).status).toBe(429)
    um.authenticateWithPassword.mockRejectedValue(new Error('bad'))
    expect((await login(db)).status).toBe(401)
  })

  it('allows when D1 is not bound', async () => {
    um.authenticateWithPassword.mockResolvedValue({ user: { id: 'u1', email: 'a@x.co' } })
    expect((await login(undefined)).status).toBe(200)
  })

  it('allows when the table is missing', async () => {
    um.authenticateWithPassword.mockResolvedValue({ user: { id: 'u1', email: 'a@x.co' } })
    const broken = { prepare: () => { throw new Error('no such table: rate_limits') }, batch: async () => [] }
    expect((await login(broken)).status).toBe(200)
  })
})
