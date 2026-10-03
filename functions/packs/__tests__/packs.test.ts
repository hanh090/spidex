import { describe, expect, it, vi } from 'vitest'
import { onRequestGet as servePack, onRequestHead as headPack } from '../[[path]]'
import { onRequestGet as serveIndex } from '../index.json'
import { fakeD1, fakeR2, htmlFallback } from '../../lib/__tests__/fakes'
import { resetBundledPackIds } from '../../lib/bundled-packs'

const ctx = (path: string, next: () => Response, env: object) => ({
  request: new Request(`https://x.test${path}`),
  next: async () => next(),
  env,
})
const row = (meta: object, published = 1) => ({ published, meta: JSON.stringify(meta) })

describe('/packs/<id>/<file>', () => {
  it('serves a real static file untouched', async () => {
    const res = await servePack(ctx('/packs/bird/pack.json', () => new Response('{}', { headers: { 'Content-Type': 'application/json' } }), {}))
    expect(await res.text()).toBe('{}')
  })

  it('treats the SPA html fallback as a miss and serves a published community pack from its prefix', async () => {
    const r2 = fakeR2({ 'submissions/sub_1/pack.json': '{"id":"c"}' })
    const db = fakeD1(() => row({ community: true, prefix: 'submissions/sub_1' }))
    const res = await servePack(ctx('/packs/c/pack.json', htmlFallback, { DB: db, PACKS: r2 }))
    expect(res.headers.get('Content-Type')).toBe('application/json')
    expect(res.headers.get('Content-Security-Policy')).toBe("script-src 'none'")
    expect(await res.text()).toBe('{"id":"c"}')
  })

  it('serves legacy community packs (no prefix) from packs/<id>/', async () => {
    const r2 = fakeR2({ 'packs/old/pack.json': '{"id":"old"}' })
    const db = fakeD1(() => row({ community: true }))
    const res = await servePack(ctx('/packs/old/pack.json', htmlFallback, { DB: db, PACKS: r2 }))
    expect(await res.text()).toBe('{"id":"old"}')
  })

  it('answers 404, not index.html, for an unpublished or unknown pack', async () => {
    const r2 = fakeR2({ 'submissions/sub_1/pack.json': '{}' })
    const db = fakeD1(() => row({ community: true, prefix: 'submissions/sub_1' }, 0))
    expect((await servePack(ctx('/packs/c/pack.json', htmlFallback, { DB: db, PACKS: r2 }))).status).toBe(404)
    expect((await servePack(ctx('/packs/c/pack.json', htmlFallback, {}))).status).toBe(404)
  })

  it('does not 500 when the community row lookup throws', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const db = fakeD1(() => { throw new Error('no such table') })
    const res = await servePack(ctx('/packs/c/pack.json', htmlFallback, { DB: db, PACKS: fakeR2() }))
    expect(res.status).toBe(404)
    err.mockRestore()
  })
})

describe('bundled pack media from the bucket', () => {
  const assets = { fetch: async () => new Response(JSON.stringify({ packs: ['bird-vn'] })) }

  it('serves a bundled pack file missing from the deploy from bundled/<id>/, without D1', async () => {
    resetBundledPackIds()
    const r2 = fakeR2({ 'bundled/bird-vn/img/a.webp': 'IMG' })
    const res = await servePack(ctx('/packs/bird-vn/img/a.webp', htmlFallback, { ASSETS: assets, PACKS: r2 }))
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('image/webp')
    expect(await res.text()).toBe('IMG')
  })

  it('answers 404 for a bundled file the bucket does not have', async () => {
    resetBundledPackIds()
    const res = await servePack(ctx('/packs/bird-vn/img/none.webp', htmlFallback, { ASSETS: assets, PACKS: fakeR2() }))
    expect(res.status).toBe(404)
  })

  it('answers HEAD like GET without a body, never the html fallback', async () => {
    resetBundledPackIds()
    const r2 = fakeR2({ 'bundled/bird-vn/img/a.webp': 'IMG' })
    const res = await headPack(ctx('/packs/bird-vn/img/a.webp', htmlFallback, { ASSETS: assets, PACKS: r2 }))
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('image/webp')
    expect(res.body).toBeNull()
  })

  it('never reads bundled/ for a pack outside the shipped index', async () => {
    resetBundledPackIds()
    const r2 = fakeR2({ 'bundled/other/img/a.webp': 'IMG' })
    const res = await servePack(ctx('/packs/other/img/a.webp', htmlFallback, { ASSETS: assets, PACKS: r2 }))
    expect(res.status).toBe(404)
  })
})

describe('admin overrides of bundled manifests', () => {
  const assets = { fetch: async () => new Response(JSON.stringify({ packs: ['bird-vn'] })) }
  const staticFile = () => new Response('STATIC', { headers: { 'Content-Type': 'application/json' } })

  it.each(['pack.json', 'species.ndjson'])('serves overrides/<id>/%s in preference to the static file, uncached', async (file) => {
    resetBundledPackIds()
    const r2 = fakeR2({ [`overrides/bird-vn/${file}`]: 'OVERRIDE' })
    const res = await servePack(ctx(`/packs/bird-vn/${file}`, staticFile, { ASSETS: assets, PACKS: r2 }))
    expect(await res.text()).toBe('OVERRIDE')
    expect(res.headers.get('Cache-Control')).toBe('no-store')
  })

  it('falls back to the static file when no override exists', async () => {
    resetBundledPackIds()
    const res = await servePack(ctx('/packs/bird-vn/pack.json', staticFile, { ASSETS: assets, PACKS: fakeR2() }))
    expect(await res.text()).toBe('STATIC')
  })

  it('ignores overrides for packs outside the shipped index and for media files', async () => {
    resetBundledPackIds()
    const r2 = fakeR2({ 'overrides/other/pack.json': 'OVERRIDE', 'overrides/bird-vn/img/a.webp': 'OVERRIDE' })
    expect(await (await servePack(ctx('/packs/other/pack.json', staticFile, { ASSETS: assets, PACKS: r2 }))).text()).toBe('STATIC')
    expect(await (await servePack(ctx('/packs/bird-vn/img/a.webp', staticFile, { ASSETS: assets, PACKS: r2 }))).text()).toBe('STATIC')
  })

  it('does not fail the request when the bucket read throws', async () => {
    resetBundledPackIds()
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const r2 = { get: async () => { throw new Error('boom') } }
    const res = await servePack(ctx('/packs/bird-vn/pack.json', staticFile, { ASSETS: assets, PACKS: r2 }))
    expect(await res.text()).toBe('STATIC')
    err.mockRestore()
  })
})

describe('/packs/index.json', () => {
  const staticIndex = () => new Response(JSON.stringify({ packs: ['a', 'b'], featured: ['a'] }), { headers: { 'Content-Type': 'application/json' } })

  it('falls back to the static catalogue (not a 500) when D1 fails', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const db = fakeD1(() => { throw new Error('no such table') })
    const res = await serveIndex(ctx('/packs/index.json', staticIndex, { DB: db, PACKS: fakeR2() }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ packs: ['a', 'b'], featured: ['a'] })
    err.mockRestore()
  })

  it('merges flags and community packs only when PACKS is bound', async () => {
    const rows = [
      { id: 'a', published: 0, meta: '{}' },
      { id: 'c', published: 1, meta: '{"community":true}' },
    ]
    const db = fakeD1(() => rows)
    const bound = await serveIndex(ctx('/packs/index.json', staticIndex, { DB: db, PACKS: fakeR2() }))
    expect(await bound.json()).toEqual({ packs: ['b', 'c'], featured: [] })
    const unbound = await serveIndex(ctx('/packs/index.json', staticIndex, { DB: db }))
    expect((await unbound.json() as { packs: string[] }).packs).toEqual(['b'])
  })
})
