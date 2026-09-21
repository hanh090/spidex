/**
 * The fixture gate.
 *
 * Phase 2's acceptance turns on two claims that are easy to assert loosely and
 * hard to assert honestly:
 *
 *   1. A pack missing an image licence, a sensitivity, or an English common
 *      name FAILS validation — not warns.
 *   2. `traitSchema` drives filters, aspects and sections, so a butterfly pack
 *      and a bird pack with disjoint vocabularies both work with no code change.
 *
 * This reads the real files from public/packs rather than inline copies, so
 * the fixtures cannot drift away from what the app actually ships.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { parseManifest, parseSpeciesNdjson } from '../pack-manifest'
import { filter } from '../../features/guide/filter-engine'
import { buildSearchBlob, search, fold } from '../search-index'
import type { StoredSpecies } from '../db'

// vitest runs from the project root; __dirname is not defined under ESM.
const root = `${process.cwd()}/public/packs`

function loadPack(id: string) {
  const manifestRaw = JSON.parse(readFileSync(`${root}/${id}/pack.json`, 'utf8'))
  const m = parseManifest(manifestRaw)
  if (!m.ok) throw new Error(`${id} manifest invalid: ${JSON.stringify(m.issues)}`)
  const s = parseSpeciesNdjson(readFileSync(`${root}/${id}/species.ndjson`, 'utf8'), m.value.traitSchema)
  if (!s.ok) throw new Error(`${id} species invalid: ${JSON.stringify(s.issues)}`)
  return { manifest: m.value, species: s.value }
}

describe('fixture packs', () => {
  it.each(['butterfly-min', 'bird-min'])('%s validates and matches its declared count', (id) => {
    const { manifest, species } = loadPack(id)
    expect(species).toHaveLength(manifest.speciesCount)
  })

  it.each(['butterfly-min', 'bird-min'])('%s: every image carries a credit and a licence', (id) => {
    const { species } = loadPack(id)
    for (const sp of species) {
      expect(sp.images.length).toBeGreaterThan(0)
      for (const im of sp.images) {
        expect(im.credit.length).toBeGreaterThan(0)
        expect(im.license.length).toBeGreaterThan(0)
      }
    }
  })

  it.each(['butterfly-min', 'bird-min'])('%s: every species carries a sensitivity category', (id) => {
    const { species } = loadPack(id)
    for (const sp of species) expect([0, 1, 2, 3]).toContain(sp.sensitivity)
  })

  it.each(['butterfly-min', 'bird-min'])('%s: every species carries its schema-required aspects', (id) => {
    const { manifest, species } = loadPack(id)
    for (const sp of species) {
      const present = new Set(sp.images.map((im) => im.aspect))
      for (const need of manifest.traitSchema.aspects.required) expect(present.has(need)).toBe(true)
    }
  })

  it('the two packs have genuinely disjoint trait vocabularies', () => {
    const b = new Set(loadPack('butterfly-min').manifest.traitSchema.traits.map((t) => t.key))
    const a = new Set(loadPack('bird-min').manifest.traitSchema.traits.map((t) => t.key))
    expect([...b].some((k) => a.has(k))).toBe(false)
  })

  it('one filter engine serves both packs with no code change', () => {
    const bf = loadPack('butterfly-min')
    const bd = loadPack('bird-min')

    const large = filter(bf.manifest.traitSchema, { size: ['large'] }, bf.species)
    expect(large.map((s) => s.sciName)).toEqual(['Troides helena'])

    const water = filter(bd.manifest.traitSchema, { behaviour: ['water'] }, bd.species)
    expect(water.map((s) => s.sciName).sort()).toEqual(['Alcedo atthis', 'Egretta garzetta'])
  })

  it('the bird pack exercises the referent-image renderer the butterfly pack does not', () => {
    const renders = (id: string) => loadPack(id).manifest.traitSchema.traits.map((t) => t.render)
    expect(renders('bird-min')).toContain('referent-image')
    expect(renders('butterfly-min')).toContain('swatch')
    expect(renders('butterfly-min')).not.toContain('referent-image')
  })

  it('taxon sections come from the pack, not from code', () => {
    const keys = (id: string) => loadPack(id).manifest.traitSchema.sections.map((s) => s.key)
    expect(keys('butterfly-min')).toEqual(['hostPlants'])
    expect(keys('bird-min')).toEqual(['call', 'flight'])
  })
})

describe('manifest validation rejects, not warns', () => {
  /** The real butterfly schema, so these assertions test the shipped contract. */
  const schema = loadPack('butterfly-min').manifest.traitSchema

  it('rejects a species whose image has no licence', () => {
    const line = JSON.stringify({
      id: 'x', sciName: 'X y', commonNames: { en: 'X' }, family: 'F', traits: {},
      sensitivity: 0,
      images: [{ id: 'i', aspect: 'dorsal', credit: 'C', thumbUrl: 'a.svg' },
               { id: 'j', aspect: 'ventral', credit: 'C', license: 'CC0-1.0', thumbUrl: 'b.svg' }],
    })
    expect(parseSpeciesNdjson(line, schema).ok).toBe(false)
  })

  it('rejects a species with no sensitivity category', () => {
    const line = JSON.stringify({
      id: 'x', sciName: 'X y', commonNames: { en: 'X' }, family: 'F', traits: {},
      images: [{ id: 'i', aspect: 'dorsal', credit: 'C', license: 'L', thumbUrl: 'a.svg' },
               { id: 'j', aspect: 'ventral', credit: 'C', license: 'L', thumbUrl: 'b.svg' }],
    })
    expect(parseSpeciesNdjson(line, schema).ok).toBe(false)
  })

  it('rejects a species with no English common name', () => {
    const line = JSON.stringify({
      id: 'x', sciName: 'X y', commonNames: { vi: 'Chỉ tiếng Việt' }, family: 'F', traits: {},
      sensitivity: 0,
      images: [{ id: 'i', aspect: 'dorsal', credit: 'C', license: 'L', thumbUrl: 'a.svg' },
               { id: 'j', aspect: 'ventral', credit: 'C', license: 'L', thumbUrl: 'b.svg' }],
    })
    expect(parseSpeciesNdjson(line, schema).ok).toBe(false)
  })

  it('rejects a species missing a schema-required aspect', () => {
    const line = JSON.stringify({
      id: 'x', sciName: 'X y', commonNames: { en: 'X' }, family: 'F', traits: {}, sensitivity: 0,
      images: [{ id: 'i', aspect: 'dorsal', credit: 'C', license: 'L', thumbUrl: 'a.svg' }],
    })
    const r = parseSpeciesNdjson(line, schema)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(JSON.stringify(r.issues)).toContain('ventral')
  })
})

describe('search covers every language at once', () => {
  const rows = (): StoredSpecies[] =>
    loadPack('butterfly-min').species.map((sp) => ({
      ...sp, packId: 'butterfly-min', packVersion: 1, searchBlob: buildSearchBlob(sp),
    })) as StoredSpecies[]

  it('finds a species by its English, German, Vietnamese or scientific name', () => {
    const all = rows()
    for (const q of ['Common Birdwing', 'Helenafalter', 'Bướm phượng cánh vàng', 'Troides']) {
      const hit = search(all, q)[0]
      expect(hit, `no hit for "${q}"`).toBeDefined()
      expect(hit!.id).toBe('bm-helena')
    }
  })

  it('matches Vietnamese without diacritics, as it would be typed in the field', () => {
    expect(search(rows(), 'buom phuong canh vang')[0]?.id).toBe('bm-helena')
    expect(fold('Bướm phượng cánh vàng')).toBe('buom phuong canh vang')
  })

  it('every query term must appear, so more words narrow', () => {
    const all = rows()
    expect(search(all, 'common').length).toBeGreaterThan(1)
    expect(search(all, 'common rose')).toHaveLength(1)
  })
})
