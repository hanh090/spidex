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

describe('pack update fetches only media it does not already hold', () => {
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
  const stubSwFetch = (version: number, body: string, opts: { ndjson?: string; failMedia?: boolean } = {}) => {
    const manifest = JSON.stringify({ ...JSON.parse(manifestText), version })
    const calls: { url: string; init?: RequestInit }[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      calls.push({ url, init })
      if (url.endsWith('/pack.json')) return new Response(manifest, { headers: { 'content-type': 'application/json' } })
      if (url.endsWith('/species.ndjson')) return new Response(opts.ndjson ?? ndjsonText, { headers: { 'content-type': 'application/x-ndjson' } })
      const hit = await (await caches.open(PACK_IMAGE_CACHE)).match(url)
      if (hit) return hit
      if (opts.failMedia) throw new Error('offline')
      return new Response(body, { headers: { 'content-type': 'image/svg+xml' } })
    }))
    return { calls, media: () => calls.filter((c) => !/\.(json|ndjson)$/.test(c.url)).map((c) => c.url) }
  }
  const base = 'https://spidex.test/packs/bird-min'
  const install = () => downloadPack({ baseUrl: base, acknowledgedNoPersist: true })
  const cachedUrls = async () => (await (await caches.open(PACK_IMAGE_CACHE)).keys()).map((k) => k.url).sort()
  const bodies = async () => {
    const cache = await caches.open(PACK_IMAGE_CACHE)
    return Promise.all((await cache.keys()).map(async (k) => (await cache.match(k))!.text()))
  }

  /** The species data with the first image of the first species moved to a new filename. */
  const renamedFirstImage = () => {
    const lines = ndjsonText.split('\n')
    const sp = JSON.parse(lines[0]!)
    const from: string = sp.images[0].thumbUrl
    const to = from.replace(/(\.[a-z]+)$/i, '-1a2b3c4d$1')
    sp.images[0] = { ...sp.images[0], thumbUrl: to, ...(sp.images[0].fullUrl ? { fullUrl: to } : {}) }
    lines[0] = JSON.stringify(sp)
    return { ndjson: lines.join('\n'), from: `${base}/${from}`, to: `${base}/${to}` }
  }

  it('does not fetch any media again when only the version changed', async () => {
    stubSwFetch(1, 'old')
    expect((await install()).ok).toBe(true)
    const before = await cachedUrls()

    const second = stubSwFetch(2, 'new')
    expect((await install()).ok).toBe(true)
    expect(second.media()).toEqual([])
    expect(new Set(await bodies())).toEqual(new Set(['old']))
    expect(await cachedUrls()).toEqual(before)
  })

  it('fetches only the new URL and evicts the one no longer referenced', async () => {
    stubSwFetch(1, 'old')
    await install()
    const { ndjson, from, to } = renamedFirstImage()
    expect(await cachedUrls()).toContain(from)

    const second = stubSwFetch(2, 'new', { ndjson })
    expect((await install()).ok).toBe(true)
    expect(second.media()).toEqual([to])
    const urls = await cachedUrls()
    expect(urls).toContain(to)
    expect(urls).not.toContain(from)
    expect(second.calls.every((c) => c.init?.cache !== 'reload')).toBe(true)
  })

  it('skips a new URL it cannot fetch and still drops the one no longer referenced', async () => {
    stubSwFetch(1, 'old')
    await install()
    const { ndjson, from, to } = renamedFirstImage()
    stubSwFetch(2, 'new', { ndjson, failMedia: true })
    expect((await install()).ok).toBe(true)
    const urls = await cachedUrls()
    expect(urls).not.toContain(to)
    expect(urls).not.toContain(from)
    expect(urls.length).toBeGreaterThan(0)
  })

  it('retries a URL an earlier run failed to store', async () => {
    stubSwFetch(1, 'x', { failMedia: true })
    await install()
    expect(await cachedUrls()).toEqual([])
    const again = stubSwFetch(1, 'ok')
    await install()
    expect(again.media().length).toBeGreaterThan(0)
    expect(new Set(await bodies())).toEqual(new Set(['ok']))
  })

  it('never evicts another pack\'s cached media', async () => {
    const cache = await caches.open(PACK_IMAGE_CACHE)
    await cache.put('https://spidex.test/packs/other-pack/img/a.webp', new Response('o', { headers: { 'content-type': 'image/webp' } }))
    stubSwFetch(1, 'old')
    await install()
    stubSwFetch(2, 'new')
    await install()
    expect(await cachedUrls()).toContain('https://spidex.test/packs/other-pack/img/a.webp')
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
