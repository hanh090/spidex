import { describe, expect, it } from 'vitest'
import {
  checkSpeciesNdjson, deletePrefix, isRealAsset, isValidPackId, mergeCatalogue, sanitizePath, servingPrefix,
} from '../submissions'
import { fakeR2, htmlFallback } from './fakes'

describe('pack ids', () => {
  it.each(['img', 'audio', 'fonts', 'packs', 'icons', 'assets', 'submissions', 'index'])('reserves %s', (id) => {
    expect(isValidPackId(id)).toBe(false)
  })
  it('accepts normal slugs and rejects bad shapes', () => {
    expect(isValidPackId('bird-dalat')).toBe(true)
    expect(isValidPackId('Bird')).toBe(false)
    expect(isValidPackId('-x')).toBe(false)
  })
})

describe('isRealAsset', () => {
  it('treats the SPA html fallback as a miss', () => {
    expect(isRealAsset(htmlFallback())).toBe(false)
    expect(isRealAsset(new Response('x', { status: 404 }))).toBe(false)
    expect(isRealAsset(new Response('{}', { headers: { 'Content-Type': 'application/json' } }))).toBe(true)
  })
})

describe('sanitizePath', () => {
  it('applies the uploader allowlist', () => {
    expect(sanitizePath('img/a.webp')).toBe('img/a.webp')
    expect(sanitizePath('photos/a.jpg')).toBeNull()
    expect(sanitizePath('img/../pack.json')).toBeNull()
    expect(sanitizePath('img/a.html')).toBeNull()
  })
})

describe('servingPrefix', () => {
  it('uses meta.prefix, falling back to the legacy packs/<id>', () => {
    expect(servingPrefix('x', { prefix: 'submissions/sub_1' })).toBe('submissions/sub_1')
    expect(servingPrefix('x', {})).toBe('packs/x')
  })
  it.each(['user-photos/u1', 'overrides/bird-vn', 'bundled/x', 'submissions', 'submissions/a/b', 'submissions/../user-photos', '../x/y'])(
    'never serves from the unsafe prefix %s', (prefix) => {
      expect(servingPrefix('x', { prefix })).toBe('packs/x')
    })
})

describe('mergeCatalogue', () => {
  const index = { packs: ['a', 'b'], featured: ['a', 'b'] }
  const rows = [
    { id: 'a', published: false, community: false },
    { id: 'c', published: true, community: true },
    { id: 'd', published: true, community: false },
  ]
  it('hides unpublished and appends community packs when storage is bound', () => {
    expect(mergeCatalogue(index, rows, true)).toEqual({ packs: ['b', 'c'], featured: ['b'] })
  })
  it('omits community packs when storage is not bound', () => {
    expect(mergeCatalogue(index, rows, false).packs).toEqual(['b'])
  })
})

describe('deletePrefix', () => {
  it('deletes across pages and only under the prefix', async () => {
    const r2 = fakeR2({
      'submissions/s1/a': '1', 'submissions/s1/b': '1', 'submissions/s1/c': '1', 'submissions/s1/d': '1', 'submissions/s1/e': '1',
      'submissions/s10/a': '1', 'packs/live/pack.json': '1',
    })
    expect(await deletePrefix(r2, 'submissions/s1')).toBe(5)
    expect([...r2.store.keys()].sort()).toEqual(['packs/live/pack.json', 'submissions/s10/a'])
  })
  it('refuses a prefix that could widen to the bucket root', async () => {
    await expect(deletePrefix(fakeR2(), 'packs')).rejects.toThrow()
    await expect(deletePrefix(fakeR2(), '')).rejects.toThrow()
  })
  it('refuses to sweep private user photos or other non-pack prefixes', async () => {
    const r2 = fakeR2({ 'user-photos/u1/p.jpg': 'private', 'overrides/bird/pack.json': '{}' })
    await expect(deletePrefix(r2, 'user-photos/u1')).rejects.toThrow()
    await expect(deletePrefix(r2, 'overrides/bird')).rejects.toThrow()
    expect(r2.store.size).toBe(2)
  })
})

describe('checkSpeciesNdjson ND licences', () => {
  const line = (license: string) => JSON.stringify({ id: 's', sciName: 'X y', images: [{ credit: 'c', license }] })
  it.each(['CC BY-ND 4.0', 'CC BY-NC-ND 4.0', 'CC-BY-ND-4.0', 'no derivatives'])('refuses %s', (license) => {
    expect(checkSpeciesNdjson(line(license)).issues.join()).toMatch(/NoDerivatives/)
  })
  it.each(['CC BY 4.0', 'CC BY-NC 4.0', 'CC BY-SA 4.0', 'CC0'])('accepts %s', (license) => {
    expect(checkSpeciesNdjson(line(license)).issues).toEqual([])
  })
})
