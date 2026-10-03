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

const put = (images: unknown[], env: Record<string, unknown>, id = 'a', baseVersion: number | null = manifest.version) =>
  call('PUT', `/api/admin/media/packs/bird-vn/species/${id}/images`, env, { body: JSON.stringify({ images, ...(baseVersion == null ? {} : { baseVersion }) }), type: 'application/json' })

/** ASSETS serving a different deployed release of bird-vn. */
const deployed = (version: number, ndjson: string) => ({
  fetch: async (input: Request | URL | string) => {
    const path = new URL(input instanceof Request ? input.url : String(input), 'https://x.test').pathname
    const files: Record<string, string> = {
      ...statics,
      '/packs/bird-vn/pack.json': JSON.stringify({ ...manifest, version }),
      '/packs/bird-vn/species.ndjson': ndjson,
    }
    return path in files
      ? new Response(files[path], { headers: { 'Content-Type': 'application/json' } })
      : new Response('<!doctype html>', { headers: { 'Content-Type': 'text/html' } })
  },
})

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
    expect(await (await put([img('a-1', 'CC-BY-4.0')], env, 'a', 3)).json()).toMatchObject({ version: 4 })
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

  it.each([
    ['https url', 'https://cdn.test/a.jpg'],
    ['http url', 'http://cdn.test/a.jpg'],
    ['protocol-relative url', '//cdn.test/a.jpg'],
  ])('rejects an absolute %s for an image with a clear message and writes nothing', async (_n, url) => {
    const r2 = fakeR2()
    for (const field of ['thumbUrl', 'fullUrl']) {
      const res = await put([{ ...img('a-1', 'CC0'), [field]: url }], { PACKS: r2 })
      expect(res.status).toBe(400)
      expect(((await res.json()) as any).error).toMatch(new RegExp(`${field} must be a relative pack path.*not an absolute URL`))
    }
    expect(r2.store.size).toBe(0)
  })

  it('rejects empty lists, unknown species and bad bodies', async () => {
    expect((await put([], { PACKS: fakeR2() })).status).toBe(400)
    expect((await put([img('z-1', 'CC0')], { PACKS: fakeR2() }, 'zzz')).status).toBe(404)
    const bad = await call('PUT', '/api/admin/media/packs/bird-vn/species/a/images', { PACKS: fakeR2() }, { body: 'not json', type: 'application/json' })
    expect(bad.status).toBe(400)
  })

  it('requires the base version and answers 409 when the pack moved on, writing nothing', async () => {
    const r2 = fakeR2()
    const missing = await put([img('a-1', 'CC0')], { PACKS: r2 }, 'a', null)
    expect(missing.status).toBe(400)
    const stale = await put([img('a-1', 'CC0')], { PACKS: r2 }, 'a', 1)
    expect(stale.status).toBe(409)
    expect(await stale.json()).toMatchObject({ version: 2, error: expect.stringMatching(/Reload/) })
    expect(r2.store.size).toBe(0)
  })

  it('lets only one of two editors who loaded the same version save', async () => {
    const r2 = fakeR2()
    const env = { PACKS: r2 }
    expect((await put([img('a-1', 'CC0')], env, 'a', 2)).status).toBe(200)
    expect((await put([img('b-1', 'CC0')], env, 'b', 2)).status).toBe(409)
    expect(JSON.parse(r2.store.get('overrides/bird-vn/species.ndjson')!.split('\n')[1]!).images[0].license).toBe('CC BY-NC 4.0')
  })

  it('starts from the deployed release once it supersedes the override, and saves above it', async () => {
    // An edit made on release v6 left override v7; a deploy then shipped v7
    // (with a new species and none of the edit's images).
    const stale = species('a', 'Alpha stale', [img('a-stale', 'CC0')])
    const release = [species('a', 'Alpha', [img('a-1', 'CC-BY-4.0')]), species('n', 'New species', [img('n-1', 'CC0')])].join('\n') + '\n'
    const r2 = fakeR2({
      'overrides/bird-vn/pack.json': JSON.stringify({ ...manifest, version: 7 }),
      'overrides/bird-vn/species.ndjson': stale + '\n',
    })
    const env = { PACKS: r2, ASSETS: deployed(7, release) }

    const listed = (await (await call('GET', '/api/admin/media/packs/bird-vn/species', env)).json()) as any
    expect(listed.version).toBe(7)
    expect(listed.species.map((s: any) => s.id)).toEqual(['a', 'n'])
    const packs = (await (await call('GET', '/api/admin/media/packs', env)).json()) as any
    expect(packs.packs[0]).toMatchObject({ version: 7, speciesCount: 2 })

    const res = await put([img('a-1', 'CC0'), img('a-2', 'CC0', 'img/x.png', 'wing')], env, 'a', 7)
    expect(await res.json()).toMatchObject({ ok: true, version: 8 })
    const written = r2.store.get('overrides/bird-vn/species.ndjson')!.split('\n')
    expect(written.map((l) => l && JSON.parse(l).id).filter(Boolean)).toEqual(['a', 'n'])
    expect(JSON.parse(r2.store.get('overrides/bird-vn/pack.json')!).version).toBe(8)
  })

  it('keeps an override that is still above the deployed version', async () => {
    const edited = species('a', 'Alpha edited', [img('a-1', 'CC0')]) + '\n'
    const r2 = fakeR2({
      'overrides/bird-vn/pack.json': JSON.stringify({ ...manifest, version: 3 }),
      'overrides/bird-vn/species.ndjson': edited,
    })
    const listed = (await (await call('GET', '/api/admin/media/packs/bird-vn/species', { PACKS: r2 })).json()) as any
    expect(listed).toMatchObject({ version: 3, total: 1 })
  })

  it('answers 400, not 500, for a malformed percent escape in the path', async () => {
    expect((await call('GET', '/api/admin/media/packs/%E0%A4%A/species', { PACKS: fakeR2() })).status).toBe(400)
  })

  it('edits a published community pack in place under its own prefix', async () => {
    const r2 = fakeR2({
      'submissions/sub_1/pack.json': JSON.stringify({ ...manifest, id: 'c-pack', version: 1 }),
      'submissions/sub_1/species.ndjson': NDJSON,
    })
    const db = fakeD1((sql) => (/FROM admin_resources/.test(sql) && /kind = 'pack'/.test(sql)
      ? [{ id: 'c-pack', meta: JSON.stringify({ community: true, prefix: 'submissions/sub_1' }) }] : null))
    const res = await call('PUT', '/api/admin/media/packs/c-pack/species/a/images', { PACKS: r2, DB: db },
      { body: JSON.stringify({ images: [img('a-1', 'CC0')], baseVersion: 1 }), type: 'application/json' })
    expect(await res.json()).toMatchObject({ ok: true, version: 2 })
    expect(JSON.parse(r2.store.get('submissions/sub_1/pack.json')!).version).toBe(2)
    expect([...r2.store.keys()].some((k) => k.startsWith('overrides/'))).toBe(false)
  })
})

describe('uploads', () => {
  it('stores a raster image at bundled/<pack>/img/ with its image type and returns the relative url', async () => {
    const r2 = fakeR2()
    const res = await upload('img/new-1.png', { PACKS: r2, DB: fakeD1(() => null) })
    expect(await res.json()).toEqual({ ok: true, url: 'img/new-1.png', renamed: false })
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
    expect((await upload('img/shipped.jpg', { PACKS: r2 }, PNG, 'image/png', '&replace=1')).status).toBe(409)
  })

  it('replace=1 keeps the existing object and stores the new bytes under a content-derived name', async () => {
    const r2 = fakeR2({ 'bundled/bird-vn/img/a.png': 'OLD' })
    const res = await upload('img/a.png', { PACKS: r2 }, PNG, 'image/png', '&replace=1')
    const body = (await res.json()) as any
    expect(res.status).toBe(200)
    expect(body.url).toMatch(/^img\/a-[0-9a-f]{8}\.png$/)
    expect(body.renamed).toBe(true)
    expect(r2.store.get('bundled/bird-vn/img/a.png')).toBe('OLD')
    expect(r2.store.has(`bundled/bird-vn/${body.url}`)).toBe(true)
    expect(r2.types.get(`bundled/bird-vn/${body.url}`)).toBe('image/png')

    // Same bytes again: same name, nothing new written, still no overwrite.
    const again = (await (await upload('img/a.png', { PACKS: r2 }, PNG, 'image/png', '&replace=1')).json()) as any
    expect(again.url).toBe(body.url)
    // Different bytes: a different name.
    const other = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 9, 9, 9])
    const third = (await (await upload('img/a.png', { PACKS: r2 }, other, 'image/png', '&replace=1')).json()) as any
    expect(third.url).not.toBe(body.url)
    expect([...r2.store.keys()].filter((k) => k.startsWith('bundled/bird-vn/img/')).length).toBe(3)
  })

  it('a first upload under a free name is stored as asked and not renamed', async () => {
    const res = await upload('img/free.png', { PACKS: fakeR2() }, PNG, 'image/png', '&replace=1')
    expect(await res.json()).toMatchObject({ url: 'img/free.png', renamed: false })
  })

  const ftyp = (brand: string) => new Uint8Array([0, 0, 0, 24, ...[...'ftyp'].map((c) => c.charCodeAt(0)), ...[...brand].map((c) => c.charCodeAt(0)), 0, 0, 0, 0])
  it.each([['avif', 200], ['avis', 200], ['heic', 415], ['mif1', 415], ['isom', 415], ['mp42', 415]])(
    'ISO-BMFF brand %s as .avif -> %i', async (brand, status) => {
      const r2 = fakeR2()
      expect((await upload('img/x.avif', { PACKS: r2 }, ftyp(brand), 'image/avif')).status).toBe(status)
      expect(r2.store.size).toBe(status === 200 ? 1 : 0)
    })

  it('404s for an unknown pack id', async () => {
    const res = await call('POST', '/api/admin/media/packs/ghost/upload?path=img/a.png', { PACKS: fakeR2() }, { body: PNG, type: 'image/png' })
    expect(res.status).toBe(404)
  })
})

describe('pack list subrequest budget', () => {
  it('stays under the Free-plan limit of 50 for a full catalogue', async () => {
    const bundled = Array.from({ length: 12 }, (_, i) => `bird-${i}`)
    const community = Array.from({ length: 10 }, (_, i) => ({ id: `com-${i}`, meta: JSON.stringify({ community: true, prefix: `submissions/s${i}` }) }))
    let calls = 0
    const files: Record<string, string> = { '/packs/index.json': JSON.stringify({ packs: bundled }) }
    for (const id of bundled) {
      files[`/packs/${id}/pack.json`] = JSON.stringify({ ...manifest, id })
      files[`/packs/${id}/species.ndjson`] = NDJSON
    }
    const assets = { fetch: async (input: Request | URL | string) => {
      calls++
      const path = new URL(input instanceof Request ? input.url : String(input), 'https://x.test').pathname
      return path in files ? new Response(files[path], { headers: { 'Content-Type': 'application/json' } }) : new Response('<!doctype html>', { headers: { 'Content-Type': 'text/html' } })
    } }
    const initial: Record<string, string> = {}
    // Half the bundled packs carry a live override: the costliest case.
    for (const id of bundled.slice(0, 6)) {
      initial[`overrides/${id}/pack.json`] = JSON.stringify({ ...manifest, id, version: 9 })
      initial[`overrides/${id}/species.ndjson`] = NDJSON
    }
    for (let i = 0; i < 10; i++) {
      initial[`submissions/s${i}/pack.json`] = JSON.stringify({ ...manifest, id: `com-${i}` })
      initial[`submissions/s${i}/species.ndjson`] = NDJSON
    }
    const r2 = fakeR2(initial)
    const counted = { ...r2, get: async (k: string) => { calls++; return r2.get(k) }, head: async (k: string) => { calls++; return r2.head(k) } }
    const db = fakeD1((sql) => { calls++; return /FROM admin_resources/.test(sql) ? community : null })

    // Warm: the first listing populates the per-isolate manifest cache; count the second.
    await call('GET', '/api/admin/media/packs', { PACKS: counted, DB: db, ASSETS: assets })
    calls = 0
    const res = await call('GET', '/api/admin/media/packs', { PACKS: counted, DB: db, ASSETS: assets })
    const { packs } = (await res.json()) as any
    expect(packs).toHaveLength(22)
    expect(packs.some((p: any) => p.missing)).toBe(false)
    expect(calls).toBeLessThan(50)
  })
})
