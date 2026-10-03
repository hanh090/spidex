import { describe, expect, it } from 'vitest'
import { onRequest } from '../[[catchall]]'
import { signSession } from '../../../lib/session'
import { fakeD1, fakeR2 } from '../../../lib/__tests__/fakes'

const SECRET = 's3cret'

async function call(method: string, path: string, opts: { body?: unknown; origin?: string | null; db?: ReturnType<typeof fakeD1> } = {}) {
  const token = await signSession({ userId: 'u1', email: 'u1@x.co', emailVerified: true }, SECRET)
  const headers: Record<string, string> = { Cookie: `spidex_session=${token}`, 'Content-Type': 'application/json' }
  if (opts.origin !== null) headers.Origin = opts.origin ?? 'https://x.test'
  const body = opts.body === undefined ? undefined : typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body)
  return onRequest({
    request: new Request(`https://x.test${path}`, { method, headers, body }),
    env: { SESSION_SECRET: SECRET, DB: opts.db ?? fakeD1(() => ({ meta: { changes: 1 } })), PACKS: fakeR2() },
  })
}

describe('submissions csrf', () => {
  const routes: [string, string, unknown][] = [
    ['POST', '/api/submissions', { packId: 'new-pack', fileCount: 3, totalBytes: 100 }],
    ['PUT', '/api/submissions/sub_1/files?path=pack.json', undefined],
    ['POST', '/api/submissions/sub_1/complete', undefined],
    ['DELETE', '/api/submissions/sub_1', undefined],
  ]

  it.each(routes)('refuses cross-origin %s %s without touching D1', async (method, path, body) => {
    const db = fakeD1(() => ({ meta: { changes: 1 } }))
    const res = await call(method, path, { body, origin: 'https://evil.test', db })
    expect(res.status).toBe(403)
    expect(db.log).toHaveLength(0)
  })

  it('refuses a state-changing request with no Origin', async () => {
    expect((await call('DELETE', '/api/submissions/sub_1', { origin: null })).status).toBe(403)
  })

  it('does not gate GET /mine', async () => {
    const db = fakeD1(() => [])
    expect((await call('GET', '/api/submissions/mine', { origin: 'https://evil.test', db })).status).toBe(200)
  })
})

describe('submissions body validation', () => {
  it.each([
    ['missing packId', { fileCount: 3, totalBytes: 100 }],
    ['string fileCount', { packId: 'ok-pack', fileCount: '3', totalBytes: 100 }],
    ['file count too low', { packId: 'ok-pack', fileCount: 1, totalBytes: 100 }],
    ['fractional fileCount', { packId: 'ok-pack', fileCount: 2.5, totalBytes: 100 }],
    ['zero bytes', { packId: 'ok-pack', fileCount: 3, totalBytes: 0 }],
    ['reserved id', { packId: 'icons', fileCount: 3, totalBytes: 100 }],
    ['bad slug', { packId: 'Bad Pack', fileCount: 3, totalBytes: 100 }],
  ])('rejects %s with 400 JSON', async (_n, body) => {
    const res = await call('POST', '/api/submissions', { body })
    expect(res.status).toBe(400)
    expect(await res.json()).toHaveProperty('error')
  })

  it('rejects malformed JSON', async () => {
    expect((await call('POST', '/api/submissions', { body: '{' })).status).toBe(400)
  })
})
