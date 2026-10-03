/**
 * Guards around the pack media cache and the service-worker route that serves it.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { db } from '../db'
import { fetchManifest, downloadPack, deletePack, isPackKey, isMediaResponse } from '../pack-download'
import { PACK_IMAGE_CACHE, PACK_URL_PREFIX, isPackMediaRequest } from '../cache-names'

const root = `${process.cwd()}/public/packs/bird-min`
const manifestText = readFileSync(`${root}/pack.json`, 'utf8')
const ndjsonText = readFileSync(`${root}/species.ndjson`, 'utf8')

describe('service-worker pack route', () => {
  const match = (path: string) => isPackMediaRequest({ url: new URL(path, 'https://spidex.test') })

  it('matches media under /packs/ only', () => {
    expect(match('/packs/bird-vn/img/a.webp')).toBe(true)
    expect(match('/packs/bird-vn/audio/a.MP3')).toBe(true)
    expect(match('/packs/bird-min/img/x.svg')).toBe(true)
  })

  it('never matches manifests, the catalogue or non-pack paths', () => {
    expect(match('/packs/index.json')).toBe(false)
    expect(match('/packs/bird-vn/pack.json')).toBe(false)
    expect(match('/packs/bird-vn/species.ndjson')).toBe(false)
    expect(match('/assets/logo.svg')).toBe(false)
  })

  it('is self-contained: serialised source references no module identifiers', () => {
    const src = isPackMediaRequest.toString()
    expect(src).not.toContain('PACK_URL_PREFIX')
    // Rebuild the function from its source alone, as the service worker does.
    const rebuilt = new Function(`return (${src})`)() as typeof isPackMediaRequest
    expect(rebuilt({ url: new URL('https://x.test/packs/a/img/b.webp') })).toBe(true)
    expect(rebuilt({ url: new URL('https://x.test/packs/index.json') })).toBe(false)
  })

  it('inlined prefix literal equals PACK_URL_PREFIX', () => {
    expect(isPackMediaRequest.toString()).toContain(JSON.stringify(PACK_URL_PREFIX))
  })
})

describe('media content-type guard', () => {
  const res = (type: string) => new Response('x', { headers: { 'content-type': type } })
  it('accepts image/*, svg and audio/*, rejects html and missing types', () => {
    expect(isMediaResponse(res('image/webp'))).toBe(true)
    expect(isMediaResponse(res('image/svg+xml'))).toBe(true)
    expect(isMediaResponse(res('audio/mpeg'))).toBe(true)
    expect(isMediaResponse(res('text/html; charset=utf-8'))).toBe(false)
    expect(isMediaResponse(new Response('x'))).toBe(false)
  })
})

describe('downloadPack content-type handling', () => {
  beforeEach(async () => {
    await Promise.all([db.packs.clear(), db.species.clear(), db.meta.clear()])
    const cache = await caches.open(PACK_IMAGE_CACHE)
    for (const k of await cache.keys()) await cache.delete(k)
  })
  afterEach(() => vi.unstubAllGlobals())

  const stubFetch = (imageType: string) =>
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/pack.json')) return new Response(manifestText, { headers: { 'content-type': 'application/json' } })
      if (url.endsWith('/species.ndjson')) return new Response(ndjsonText, { headers: { 'content-type': 'application/x-ndjson' } })
      return new Response('<svg/>', { headers: { 'content-type': imageType } })
    }))

  it('does not cache SPA index.html served for image URLs', async () => {
    stubFetch('text/html; charset=utf-8')
    const r = await downloadPack({ baseUrl: 'https://spidex.test/packs/bird-min', acknowledgedNoPersist: true })
    expect(r.ok).toBe(true)
    const cache = await caches.open(PACK_IMAGE_CACHE)
    expect(await cache.keys()).toHaveLength(0)
  })

  it('caches genuine images', async () => {
    stubFetch('image/svg+xml')
    const r = await downloadPack({ baseUrl: 'https://spidex.test/packs/bird-min', acknowledgedNoPersist: true })
    expect(r.ok).toBe(true)
    const cache = await caches.open(PACK_IMAGE_CACHE)
    expect((await cache.keys()).length).toBeGreaterThan(0)
  })

  it('rejects an html pack.json', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>', { headers: { 'content-type': 'text/html' } })))
    const r = await downloadPack({ baseUrl: 'https://spidex.test/packs/nope', acknowledgedNoPersist: true })
    expect(r.ok).toBe(false)
  })
})

describe('pack update refetches media under unchanged filenames', () => {
  beforeEach(async () => {
    await Promise.all([db.packs.clear(), db.species.clear(), db.meta.clear()])
    const cache = await caches.open(PACK_IMAGE_CACHE)
    for (const k of await cache.keys()) await cache.delete(k)
  })
  afterEach(() => vi.unstubAllGlobals())

  /**
   * Mimics the service worker's CacheFirst route: a request is answered from
   * the pack cache when an entry exists, otherwise from the "network".
   */
  const stubSwFetch = (version: number, body: string, failMedia = false) => {
    const manifest = JSON.stringify({ ...JSON.parse(manifestText), version })
    const calls: { url: string; init?: RequestInit }[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      calls.push({ url, init })
      if (url.endsWith('/pack.json')) return new Response(manifest, { headers: { 'content-type': 'application/json' } })
      if (url.endsWith('/species.ndjson')) return new Response(ndjsonText, { headers: { 'content-type': 'application/x-ndjson' } })
      const hit = await (await caches.open(PACK_IMAGE_CACHE)).match(url)
      if (hit) return hit
      if (failMedia) throw new Error('offline')
      return new Response(body, { headers: { 'content-type': 'image/svg+xml' } })
    }))
    return calls
  }
  const base = 'https://spidex.test/packs/bird-min'
  const install = () => downloadPack({ baseUrl: base, acknowledgedNoPersist: true })
  const bodies = async () => {
    const cache = await caches.open(PACK_IMAGE_CACHE)
    return Promise.all((await cache.keys()).map(async (k) => (await cache.match(k))!.text()))
  }

  it('replaces cached media when the pack version changes', async () => {
    stubSwFetch(1, 'old')
    expect((await install()).ok).toBe(true)
    expect(new Set(await bodies())).toEqual(new Set(['old']))

    const calls = stubSwFetch(2, 'new')
    expect((await install()).ok).toBe(true)
    expect(new Set(await bodies())).toEqual(new Set(['new']))
    expect(calls.filter((c) => !/\.(json|ndjson)$/.test(c.url)).every((c) => c.init?.cache === 'reload')).toBe(true)
  })

  it('keeps the old copy when the refetch fails', async () => {
    stubSwFetch(1, 'old')
    await install()
    stubSwFetch(2, 'new', true)
    expect((await install()).ok).toBe(true)
    expect(new Set(await bodies())).toEqual(new Set(['old']))
  })

  it('does not bypass the cache for a same-version reinstall', async () => {
    stubSwFetch(1, 'old')
    await install()
    const calls = stubSwFetch(1, 'new')
    await install()
    expect(new Set(await bodies())).toEqual(new Set(['old']))
    expect(calls.some((c) => c.init?.cache === 'reload')).toBe(false)
  })
})

describe('listed pack whose files are missing', () => {
  afterEach(() => vi.unstubAllGlobals())
  it('fetchManifest reports failure (never throws) when the SPA shell answers pack.json', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<!doctype html>', { headers: { 'content-type': 'text/html' } })))
    const r = await fetchManifest('/packs/butterfly-sg')
    expect(r.ok).toBe(false)
  })
})

describe('pack delete cache-key matching', () => {
  it('matches only keys under /packs/<id>/', () => {
    expect(isPackKey('https://s.test/packs/bird-vn/img/a.webp', 'bird-vn')).toBe(true)
    expect(isPackKey('https://s.test/packs/bird-vn/img/a.webp', 'img')).toBe(false)
    expect(isPackKey('https://s.test/packs/butterfly-vn/img/a.webp', 'img')).toBe(false)
    expect(isPackKey('not a url', 'img')).toBe(false)
  })

  it('deleting a pack named img leaves other packs cached media intact', async () => {
    const cache = await caches.open(PACK_IMAGE_CACHE)
    const keep = 'https://s.test/packs/bird-vn/img/a.webp'
    const drop = 'https://s.test/packs/img/img/b.webp'
    await cache.put(keep, new Response('a'))
    await cache.put(drop, new Response('b'))
    await deletePack('img')
    expect(await cache.match(keep)).toBeDefined()
    expect(await cache.match(drop)).toBeUndefined()
  })
})
