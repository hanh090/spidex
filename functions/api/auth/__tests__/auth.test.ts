import { beforeEach, describe, expect, it, vi } from 'vitest'

const um = {
  createUser: vi.fn(),
  authenticateWithPassword: vi.fn(),
  authenticateWithCode: vi.fn(),
  getUser: vi.fn(),
}
vi.mock('@workos-inc/node', () => ({
  WorkOS: class {
    constructor(key?: string) {
      if (!key) throw new Error('WorkOS requires either an API key or a client id')
    }
    userManagement = um
  },
}))

import { onRequest } from '../[[catchall]]'
import { readSession } from '../../../lib/session'

const env = { WORKOS_API_KEY: 'sk_test', WORKOS_CLIENT_ID: 'client_1', SESSION_SECRET: 's3cret' }
const post = (path: string, body: object, e: object = env) =>
  onRequest({ request: new Request(`https://x.test${path}`, { method: 'POST', body: JSON.stringify(body) }), env: e })

beforeEach(() => {
  Object.values(um).forEach((f) => f.mockReset())
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('/api/auth/register', () => {
  const created = { id: 'u1', email: 'a@x.co', firstName: 'Hạnh', lastName: 'Lê' }

  it('issues no session when sign-in is refused (pending verification)', async () => {
    um.createUser.mockResolvedValue(created)
    um.authenticateWithPassword.mockRejectedValue(new Error('email_verification_required'))
    const res = await post('/api/auth/register', { email: 'a@x.co', password: 'pw' })
    expect(res.status).toBe(201)
    expect(res.headers.get('Set-Cookie')).toBeNull()
    expect(await res.json()).toMatchObject({ pendingVerification: true, user: { id: 'u1' } })
  })

  it('issues a signed session, with emailVerified, when sign-in succeeds', async () => {
    um.createUser.mockResolvedValue(created)
    um.authenticateWithPassword.mockResolvedValue({ user: { ...created, emailVerified: true } })
    const res = await post('/api/auth/register', { email: 'a@x.co', password: 'pw' })
    expect(res.status).toBe(201)
    const cookie = res.headers.get('Set-Cookie')!
    expect(cookie).toContain('spidex_session=')
    const req = new Request('https://x.test', { headers: { Cookie: cookie.split(';')[0]! } })
    expect(await readSession(req, env)).toMatchObject({ userId: 'u1', firstName: 'Hạnh', emailVerified: true })
  })

  it('does not leak provider error text', async () => {
    um.createUser.mockRejectedValue(new Error('internal workos detail'))
    const res = await post('/api/auth/register', { email: 'a@x.co', password: 'pw' })
    expect(res.status).toBe(400)
    expect(JSON.stringify(await res.json())).not.toContain('workos detail')
  })
})

describe('/api/auth/password', () => {
  it('signs in a user with a non-Latin-1 name (no 500)', async () => {
    um.authenticateWithPassword.mockResolvedValue({ user: { id: 'u1', email: 'a@x.co', firstName: 'Hạnh', emailVerified: false } })
    const res = await post('/api/auth/password', { email: 'a@x.co', password: 'pw' })
    expect(res.status).toBe(200)
    expect(res.headers.get('Set-Cookie')).toContain('spidex_session=')
  })
})

describe('/api/auth/me', () => {
  it('answers {user:null} when WorkOS is not configured', async () => {
    const res = await onRequest({ request: new Request('https://x.test/api/auth/me'), env: {} })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ user: null })
  })
})
