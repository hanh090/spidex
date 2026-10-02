import { describe, expect, it } from 'vitest'
import {
  SESSION_TTL_SECONDS, isAdmin, parseCookies, signSession, verifySession,
} from '../session'

const SECRET = 'test-secret'

describe('session', () => {
  it('round-trips a non-Latin-1 name', async () => {
    const token = await signSession({ userId: 'u1', email: 'a@b.co', firstName: 'Hạnh', emailVerified: true }, SECRET)
    const payload = await verifySession(token, SECRET)
    expect(payload?.firstName).toBe('Hạnh')
    expect(payload?.emailVerified).toBe(true)
  })

  it('rejects tampered and wrongly signed tokens', async () => {
    const token = await signSession({ userId: 'u1', email: 'a@b.co' }, SECRET)
    expect(await verifySession(token, 'other')).toBeNull()
    const [body, sig] = token.split('.')
    const forged = btoa(JSON.stringify({ userId: 'admin', email: 'x@y.z', exp: 9e9 })).replace(/=+$/, '')
    expect(await verifySession(`${forged}.${sig}`, SECRET)).toBeNull()
    expect(body).toBeTruthy()
  })

  it('expires after the TTL', async () => {
    const t0 = Date.UTC(2026, 0, 1)
    const token = await signSession({ userId: 'u1', email: 'a@b.co' }, SECRET, t0)
    expect(await verifySession(token, SECRET, t0 + (SESSION_TTL_SECONDS - 60) * 1000)).not.toBeNull()
    expect(await verifySession(token, SECRET, t0 + (SESSION_TTL_SECONDS + 1) * 1000)).toBeNull()
  })

  it('still decodes legacy standard-base64 ASCII tokens, but only with an exp', async () => {
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
    const make = async (payload: object) => {
      const body = btoa(JSON.stringify(payload))
      const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body)))
      return `${body}.${btoa(String.fromCharCode(...sig))}`
    }
    const now = Date.now()
    expect((await verifySession(await make({ userId: 'u', email: 'e@x.co', exp: now / 1000 + 100 }), SECRET, now))?.userId).toBe('u')
    expect(await verifySession(await make({ userId: 'u', email: 'e@x.co' }), SECRET, now)).toBeNull()
  })

  it('survives a malformed percent-encoded cookie', () => {
    expect(() => parseCookies('a=%E0%A4%A; spidex_session=tok')).not.toThrow()
    expect(parseCookies('a=%E0%A4%A; spidex_session=tok').spidex_session).toBe('tok')
  })

  it('isAdmin requires a verified email on the allowlist', () => {
    const env = { ADMIN_EMAILS: 'Boss@x.co, other@x.co' }
    expect(isAdmin({ userId: 'u', email: 'boss@x.co', emailVerified: true }, env)).toBe(true)
    expect(isAdmin({ userId: 'u', email: 'boss@x.co' }, env)).toBe(false)
    expect(isAdmin({ userId: 'u', email: 'boss@x.co', emailVerified: false }, env)).toBe(false)
    expect(isAdmin({ userId: 'u', email: 'nobody@x.co', emailVerified: true }, env)).toBe(false)
    expect(isAdmin({ userId: 'u', email: 'boss@x.co', emailVerified: true }, {})).toBe(false)
  })
})
