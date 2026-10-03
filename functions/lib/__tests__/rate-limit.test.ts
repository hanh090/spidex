import { describe, expect, it } from 'vitest'
import { checkRateLimit, credentialLimits, WINDOW_SECONDS } from '../rate-limit'
import { fakeD1 } from './fakes'

/** Counter-backed D1: the upsert returns the running count per (key, window). */
function counterDb() {
  const counts = new Map<string, number>()
  const db = fakeD1((sql, args) => {
    if (sql.startsWith('INSERT INTO rate_limits')) {
      const k = `${args[0]}|${args[1]}`
      counts.set(k, (counts.get(k) ?? 0) + 1)
      return { count: counts.get(k) }
    }
    return { meta: { changes: 0 } }
  })
  return { db, counts }
}

describe('checkRateLimit', () => {
  const now = Date.UTC(2026, 9, 3, 1, 0, 0)

  it('allows up to max, then refuses with Retry-After inside the window', async () => {
    const { db } = counterDb()
    const limits = [{ key: 'k', max: 3 }]
    for (let i = 0; i < 3; i++) expect(await checkRateLimit(db as never, limits, now)).toEqual({ allowed: true })
    const res = await checkRateLimit(db as never, limits, now + 1000)
    expect(res.allowed).toBe(false)
    if (!res.allowed) {
      expect(res.retryAfter).toBeGreaterThan(0)
      expect(res.retryAfter).toBeLessThanOrEqual(WINDOW_SECONDS)
    }
  })

  it('starts a fresh counter in the next window', async () => {
    const { db } = counterDb()
    const limits = [{ key: 'k', max: 1 }]
    await checkRateLimit(db as never, limits, now)
    expect((await checkRateLimit(db as never, limits, now)).allowed).toBe(false)
    expect((await checkRateLimit(db as never, limits, now + WINDOW_SECONDS * 1000)).allowed).toBe(true)
  })

  it('sweeps old windows when a new window opens', async () => {
    const { db } = counterDb()
    await checkRateLimit(db as never, [{ key: 'k', max: 5 }], now)
    expect(db.log.some((l) => l.sql.startsWith('DELETE FROM rate_limits'))).toBe(true)
  })

  it('fails open without a database or when D1 throws', async () => {
    expect(await checkRateLimit(undefined, [{ key: 'k', max: 1 }])).toEqual({ allowed: true })
    const broken = fakeD1(() => { throw new Error('no such table: rate_limits') })
    const spy = console.error
    console.error = () => {}
    try {
      expect(await checkRateLimit(broken as never, [{ key: 'k', max: 1 }])).toEqual({ allowed: true })
    } finally {
      console.error = spy
    }
  })
})

describe('credentialLimits', () => {
  it('keys by hashed, case-insensitive email and CF-Connecting-IP', async () => {
    const req = new Request('https://x.test', { headers: { 'CF-Connecting-IP': '1.2.3.4' } })
    const a = await credentialLimits('password', req, 'A@X.co')
    const b = await credentialLimits('password', req, ' a@x.co ')
    expect(a[0]!.key).toBe(b[0]!.key)
    expect(a[0]!.key).not.toContain('a@x.co')
    expect(a[0]!.max).toBe(10)
    expect(a[1]).toEqual({ key: 'password:ip:1.2.3.4', max: 30 })
  })
})
