import { beforeEach, describe, expect, it } from 'vitest'
import { onRequest } from '../[[catchall]]'
import { signSession } from '../../../lib/session'
import { fakeD1, fakeR2 } from '../../../lib/__tests__/fakes'
import { resetBundledPackIds } from '../../../lib/bundled-packs'
import { MAX_UPLOAD_BYTES } from '../../../lib/media-admin'

const SECRET = 's3cret'

const manifest = {
  id: 'bird-vn', name: { en: 'Birds of VN' }, version: 2, speciesCount: 3,
  traitSchema: { traits: [], aspects: { required: ['profile'], optional: ['wing'] }, sections: [] },
}
const img = (id: string, license: string, thumbUrl = `img/${id}.jpg`, aspect = 'profile') =>
  ({ id, aspect, credit: 'A. Photographer', license, thumbUrl, fullUrl: thumbUrl })
const species = (id: string, name: string, images: object[]) =>
  JSON.stringify({ id, sciName: `Sci ${id}`, commonNames: { en: name }, family: 'F', sensitivity: 0, images })
const NDJSON = [
  species('a', 'Alpha', [img('a-1', 'CC-BY-4.0')]),
  species('b', 'Beta', [img('b-1', 'CC BY-NC 4.0')]),
  species('c', 'Gamma', [img('c-1', 'CC0', 'img/bird-archetype-corvid.svg')]),
].join('\n') + '\n'

const statics: Record<string, string> = {
  '/packs/index.json': JSON.stringify({ packs: ['bird-vn'] }),
  '/packs/bird-vn/pack.json': JSON.stringify(manifest),
  '/packs/bird-vn/species.ndjson': NDJSON,
  '/packs/bird-vn/img/shipped.jpg': 'JPG',
}
const ASSETS = {
  fetch: async (input: Request | URL | string) => {
    const path = new URL(input instanceof Request ? input.url : String(input), 'https://x.test').pathname
    return path in statics
      ? new Response(statics[path], { headers: { 'Content-Type': 'application/json' } })
      : new Response('<!doctype html>', { headers: { 'Content-Type': 'text/html' } })
  },
}

async function call(
  method: string, path: string, env: Record<string, unknown>,
  init: { body?: BodyInit; type?: string; email?: string; verified?: boolean; anon?: boolean } = {},
) {
  const headers: Record<string, string> = { Origin: 'https://x.test' }
  if (init.type) headers['Content-Type'] = init.type
  if (!init.anon) {
    headers.Cookie = `spidex_session=${await signSession(
      { userId: 'u', email: init.email ?? 'boss@x.co', emailVerified: init.verified ?? true }, SECRET)}`
  }
  return onRequest({
    request: new Request(`https://x.test${path}`, { method, headers, body: init.body }),
    env: { SESSION_SECRET: SECRET, ADMIN_EMAILS: 'boss@x.co', ASSETS, ...env },
  })
}

const put = (images: unknown[], env: Record<string, unknown>, id = 'a') =>
  call('PUT', `/api/admin/media/packs/bird-vn/species/${id}/images`, env, { body: JSON.stringify({ images }), type: 'application/json' })

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])
const upload = (path: string, env: Record<string, unknown>, body: BodyInit = PNG, type = 'image/png', extra = '') =>
  call('POST', `/api/admin/media/packs/bird-vn/upload?path=${encodeURIComponent(path)}${extra}`, env, { body, type })

beforeEach(() => resetBundledPackIds())

describe('media API gate', () => {
  it.each([
    ['anonymous', { anon: true }, 401],
    ['signed in but not on the allowlist', { email: 'rando@x.co' }, 403],
    ['allowlisted but unverified', { verified: false }, 403],
  ])('%s -> %i', async (_n, init, status) => {
    const r2 = fakeR2()
    expect((await call('GET', '/api/admin/media/packs', { PACKS: r2 }, init as never)).status).toBe(status)
    expect((await call('PUT', '/api/admin/media/packs/bird-vn/species/a/images', { PACKS: r2 }, { ...init, body: '{}' } as never)).status).toBe(status)
    expect((await call('POST', '/api/admin/media/packs/bird-vn/upload?path=img/a.png', { PACKS: r2 }, { ...init, body: PNG, type: 'image/png' } as never)).status).toBe(status)
    expect(r2.store.size).toBe(0)
  })

  it('answers 503 when the bucket is not bound', async () => {
    expect((await call('GET', '/api/admin/media/packs', {})).status).toBe(503)
  })
})

describe('listing', () => {
  it('lists bundled packs with licence counts and flags', async () => {
    const res = await call('GET', '/api/admin/media/packs', { PACKS: fakeR2() })
    const { packs } = await res.json() as any
    expect(packs).toHaveLength(1)
    expect(packs[0]).toMatchObject({
      id: 'bird-vn', community: false, version: 2, speciesCount: 3,
      licenses: { 'CC-BY-4.0': 1, 'CC BY-NC 4.0': 1, CC0: 1 },
      counts: { images: 3, nc: 1, nd: 0, archetype: 1 },
    })
  })

  it('filters by nc / archetype, searches, and pages with a cursor', async () => {
    const env = { PACKS: fakeR2() }
    const get = async (qs: string) => (await (await call('GET', `/api/admin/media/packs/bird-vn/species?${qs}`, env)).json()) as any
    expect((await get('filter=nc')).species.map((s: any) => s.id)).toEqual(['b'])
    expect((await get('filter=archetype')).species.map((s: any) => s.id)).toEqual(['c'])
    expect((await get('filter=nd')).species).toEqual([])
    expect((await get('q=gam')).species.map((s: any) => s.id)).toEqual(['c'])
    const all = await get('')
    expect(all).toMatchObject({ total: 3, nextCursor: null, aspects: { required: ['profile'] } })
    expect(all.species[1].images[0].flags).toEqual({ nc: true, nd: false, archetype: false })
    expect((await call('GET', '/api/admin/media/packs/bird-vn/species?filter=bogus', env)).status).toBe(400)
    expect((await call('GET', '/api/admin/media/packs/nope/species', env)).status).toBe(404)
  })
})

describe('saving images', () => {
  it('writes overrides, bumps the version on every save, and leaves other species untouched', async () => {
    const r2 = fakeR2()
    const db = fakeD1(() => null)
    const env = { PACKS: r2, DB: db }
    const first = await put([img('a-1', 'CC-BY-4.0'), img('a-2', 'CC0', 'img/new.png', 'wing')], env)
    expect(first.status).toBe(200)
    expect(await first.json()).toMatchObject({ ok: true, version: 3 })

    const written = r2.store.get('overrides/bird-vn/species.ndjson')!
    const lines = written.split('\n')
    expect(lines[1]).toBe(NDJSON.split('\n')[1])
    expect(JSON.parse(lines[0]!).images.map((i: any) => i.id)).toEqual(['a-1', 'a-2'])
    expect(JSON.parse(r2.store.get('overrides/bird-vn/pack.json')!).version).toBe(3)
    expect(r2.types.get('overrides/bird-vn/species.ndjson')).toBe('application/x-ndjson')
    // The next save builds on the override, not the static file.
    expect(await (await put([img('a-1', 'CC-BY-4.0')], env)).json()).toMatchObject({ version: 4 })
    expect(JSON.parse(r2.store.get('overrides/bird-vn/species.ndjson')!.split('\n')[0]!).images).toHaveLength(1)
    expect(db.log.filter((l) => /admin_audit/.test(l.sql)).map((l) => l.args[2])).toEqual(['media.images.save', 'media.images.save'])
  })

  it.each([
    ['CC-BY-ND-4.0'], ['CC BY-ND 4.0'], ['CC-BY-NC-ND'], ['No Derivatives'],
  ])('rejects the NoDerivatives licence %s and writes nothing', async (license) => {
    const r2 = fakeR2()
    const res = await put([img('a-1', license)], { PACKS: r2 })
    expect(res.status).toBe(400)
    expect(((await res.json()) as any).error).toMatch(/NoDerivatives/)
    expect(r2.store.size).toBe(0)
  })

  it('still allows NC and licences that merely contain the letters', async () => {
    expect((await put([img('a-1', 'CC BY-NC 4.0')], { PACKS: fakeR2() })).status).toBe(200)
    expect((await put([img('a-1', 'CC-BY-ANDREW')], { PACKS: fakeR2() })).status).toBe(200)
  })

  it('keeps required aspects satisfied', async () => {
    const r2 = fakeR2()
    const res = await put([img('a-2', 'CC0', 'img/x.png', 'wing')], { PACKS: r2 })
    expect(res.status).toBe(400)
    expect(((await res.json()) as any).error).toMatch(/missing required aspect "profile"/)
    expect(r2.store.size).toBe(0)
  })

  it.each([
    ['unknown aspect', { ...img('a-1', 'CC0'), aspect: 'belly' }, /aspect "belly"/],
    ['blank credit', { ...img('a-1', 'CC0'), credit: ' ' }, /credit required/],
    ['blank licence', { ...img('a-1', 'CC0'), license: '' }, /license required/],
    ['javascript url', { ...img('a-1', 'CC0'), thumbUrl: 'javascript:alert(1)' }, /thumbUrl/],
    ['traversal url', { ...img('a-1', 'CC0'), fullUrl: '../../secret.jpg' }, /fullUrl/],
    ['protocol-relative url', { ...img('a-1', 'CC0'), thumbUrl: '//evil.test/x.jpg' }, /thumbUrl/],
  ])('rejects %s', async (_n, bad, msg) => {
    const res = await put([bad], { PACKS: fakeR2() })
    expect(res.status).toBe(400)
    expect(((await res.json()) as any).error).toMatch(msg)
  })

  it('accepts absolute https urls and rejects empty lists, unknown species and bad bodies', async () => {
    expect((await put([img('a-1', 'CC0', 'https://cdn.test/a.jpg')], { PACKS: fakeR2() })).status).toBe(200)
    expect((await put([], { PACKS: fakeR2() })).status).toBe(400)
    expect((await put([img('z-1', 'CC0')], { PACKS: fakeR2() }, 'zzz')).status).toBe(404)
    const bad = await call('PUT', '/api/admin/media/packs/bird-vn/species/a/images', { PACKS: fakeR2() }, { body: 'not json', type: 'application/json' })
    expect(bad.status).toBe(400)
  })

  it('edits a published community pack in place under its own prefix', async () => {
    const r2 = fakeR2({
      'submissions/sub_1/pack.json': JSON.stringify({ ...manifest, id: 'c-pack', version: 1 }),
      'submissions/sub_1/species.ndjson': NDJSON,
    })
    const db = fakeD1((sql) => (/FROM admin_resources/.test(sql) && /kind = 'pack'/.test(sql)
      ? [{ id: 'c-pack', meta: JSON.stringify({ community: true, prefix: 'submissions/sub_1' }) }] : null))
    const res = await call('PUT', '/api/admin/media/packs/c-pack/species/a/images', { PACKS: r2, DB: db },
      { body: JSON.stringify({ images: [img('a-1', 'CC0')] }), type: 'application/json' })
    expect(await res.json()).toMatchObject({ ok: true, version: 2 })
    expect(JSON.parse(r2.store.get('submissions/sub_1/pack.json')!).version).toBe(2)
    expect([...r2.store.keys()].some((k) => k.startsWith('overrides/'))).toBe(false)
  })
})

describe('uploads', () => {
  it('stores a raster image at bundled/<pack>/img/ with its image type and returns the relative url', async () => {
    const r2 = fakeR2()
    const res = await upload('img/new-1.png', { PACKS: r2, DB: fakeD1(() => null) })
    expect(await res.json()).toEqual({ ok: true, url: 'img/new-1.png' })
    expect(r2.store.has('bundled/bird-vn/img/new-1.png')).toBe(true)
    expect(r2.types.get('bundled/bird-vn/img/new-1.png')).toBe('image/png')
  })

  it.each([
    ['../pack.json'], ['img/../../x.png'], ['pack.json'], ['img/a.html'], ['img/a.svg'], ['audio/a.png'], ['img/a b.png'], [''],
  ])('refuses the path %j', async (p) => {
    const r2 = fakeR2()
    expect((await upload(p, { PACKS: r2 })).status).toBe(400)
    expect(r2.store.size).toBe(0)
  })

  it('checks the content type and the bytes', async () => {
    const r2 = fakeR2()
    expect((await upload('img/a.png', { PACKS: r2 }, '<html>', 'text/html')).status).toBe(415)
    expect((await upload('img/a.png', { PACKS: r2 }, '<svg/>', 'image/svg+xml')).status).toBe(415)
    expect((await upload('img/a.png', { PACKS: r2 }, 'plain text, not a png', 'image/png')).status).toBe(415)
    expect((await upload('img/a.png', { PACKS: r2 }, new Uint8Array(0), 'image/png')).status).toBe(400)
    expect(r2.store.size).toBe(0)
  })

  it('caps the size', async () => {
    const r2 = fakeR2()
    const big = new Uint8Array(MAX_UPLOAD_BYTES + 1)
    big.set(PNG)
    expect((await upload('img/big.png', { PACKS: r2 }, big)).status).toBe(413)
    expect(r2.store.size).toBe(0)
  })

  it('never overwrites without replace=1, nor a file shipped in the deploy', async () => {
    const r2 = fakeR2({ 'bundled/bird-vn/img/a.png': 'OLD' })
    expect((await upload('img/a.png', { PACKS: r2 })).status).toBe(409)
    expect(r2.store.get('bundled/bird-vn/img/a.png')).toBe('OLD')
    expect((await upload('img/a.png', { PACKS: r2 }, PNG, 'image/png', '&replace=1')).status).toBe(200)
    expect(r2.store.get('bundled/bird-vn/img/a.png')).toBe('bin')
    expect((await upload('img/shipped.jpg', { PACKS: r2 }, PNG, 'image/png', '&replace=1')).status).toBe(409)
  })

  it('404s for an unknown pack id', async () => {
    const res = await call('POST', '/api/admin/media/packs/ghost/upload?path=img/a.png', { PACKS: fakeR2() }, { body: PNG, type: 'image/png' })
    expect(res.status).toBe(404)
  })
})
