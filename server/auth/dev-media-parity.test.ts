/**
 * The dev server must apply the same pack rules as production: an admin
 * override of a bundled manifest is served only while its version is above the
 * checkout's, and state-changing admin requests must be same-origin.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Writable } from 'node:stream'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

type Middleware = (req: any, res: any, next: () => void) => unknown
let middleware: Middleware
let root: string

beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'spidex-dev-'))
  const write = (rel: string, body: string) => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true })
    fs.writeFileSync(path.join(root, rel), body)
  }
  write('public/packs/index.json', JSON.stringify({ packs: ['bird-x'] }))
  write('public/packs/bird-x/pack.json', JSON.stringify({ version: 5, tag: 'STATIC' }))
  write('public/packs/bird-x/species.ndjson', 'STATIC')
  write('data/overrides/bird-x/pack.json', JSON.stringify({ version: 6, tag: 'OVERRIDE' }))
  write('data/overrides/bird-x/species.ndjson', 'OVERRIDE')

  vi.spyOn(process, 'cwd').mockReturnValue(root)
  vi.resetModules()
  const { devAuthPlugin } = await import('./dev-auth-plugin')
  const plugin = devAuthPlugin() as any
  plugin.configureServer({ middlewares: { use: (fn: Middleware) => { middleware = fn } } })
})

afterAll(() => {
  vi.restoreAllMocks()
  fs.rmSync(root, { recursive: true, force: true })
})

/** Drives the dev middleware with a fake request; resolves with what it wrote. */
function run(method: string, url: string, headers: Record<string, string> = {}) {
  return new Promise<{ status: number; body: string; passedThrough: boolean }>((resolve) => {
    const chunks: Buffer[] = []
    const res: any = new Writable({
      write(chunk, _enc, cb) { chunks.push(Buffer.from(chunk)); cb() },
      final(cb) { cb(); done() },
    })
    res.statusCode = 200
    res.setHeader = () => res
    const origEnd = res.end.bind(res)
    res.end = (b?: any) => origEnd(b)
    let finished = false
    const done = () => {
      if (finished) return
      finished = true
      resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString(), passedThrough: false })
    }
    const req: any = { method, url, headers: { host: 'localhost:5173', ...headers }, on: () => req }
    void middleware(req, res, () => {
      finished = true
      resolve({ status: 0, body: '', passedThrough: true })
    })
  })
}

describe('dev /packs override rule', () => {
  it('serves the override while it is above the checkout version', async () => {
    expect((await run('GET', '/packs/bird-x/species.ndjson')).body).toBe('OVERRIDE')
    expect(JSON.parse((await run('GET', '/packs/bird-x/pack.json')).body).tag).toBe('OVERRIDE')
  })

  it('falls through to the checkout once its version reaches the override', async () => {
    fs.writeFileSync(path.join(root, 'public/packs/bird-x/pack.json'), JSON.stringify({ version: 6, tag: 'STATIC' }))
    const res = await run('GET', '/packs/bird-x/species.ndjson')
    expect(res.passedThrough).toBe(true)
    fs.writeFileSync(path.join(root, 'public/packs/bird-x/pack.json'), JSON.stringify({ version: 5, tag: 'STATIC' }))
  })
})

describe('dev admin cross-origin check', () => {
  it('refuses a state-changing request from another origin before anything else', async () => {
    const res = await run('PUT', '/api/admin/media/packs/bird-x/species/a/images', { origin: 'https://evil.test' })
    expect(res.body).toMatch(/Cross-origin request refused/)
  })

  it('lets a same-origin request through to the session check', async () => {
    const res = await run('PUT', '/api/admin/media/packs/bird-x/species/a/images', { origin: 'http://localhost:5173' })
    expect(res.body).toMatch(/Sign in required/)
  })

  it('does not apply to reads', async () => {
    const res = await run('GET', '/api/admin/media/packs', { origin: 'https://evil.test' })
    expect(res.body).toMatch(/Sign in required/)
  })
})
