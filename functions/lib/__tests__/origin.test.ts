import { describe, expect, it } from 'vitest'
import { isSameOrigin, rejectCrossOrigin } from '../origin'

const req = (method: string, headers: Record<string, string> = {}) =>
  new Request('https://app.test/api/sync/sightings', { method, headers })

describe('rejectCrossOrigin', () => {
  it('lets safe methods through regardless of origin', () => {
    expect(rejectCrossOrigin(req('GET', { Origin: 'https://evil.test' }))).toBeNull()
  })

  it('accepts a matching Origin on state-changing requests', () => {
    expect(rejectCrossOrigin(req('POST', { Origin: 'https://app.test' }))).toBeNull()
    expect(rejectCrossOrigin(req('DELETE', { Origin: 'https://app.test' }))).toBeNull()
  })

  it('refuses a different origin, scheme or port with 403', async () => {
    for (const origin of ['https://evil.test', 'http://app.test', 'https://app.test:8443', 'null', 'not a url']) {
      const res = rejectCrossOrigin(req('POST', { Origin: origin }))
      expect(res?.status, origin).toBe(403)
    }
  })

  it('falls back to Sec-Fetch-Site when Origin is absent, and refuses when neither is present', () => {
    expect(isSameOrigin(req('POST', { 'Sec-Fetch-Site': 'same-origin' }))).toBe(true)
    expect(isSameOrigin(req('POST', { 'Sec-Fetch-Site': 'cross-site' }))).toBe(false)
    expect(rejectCrossOrigin(req('POST'))?.status).toBe(403)
  })
})
