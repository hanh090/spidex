import { describe, it, expect } from 'vitest'
import { filter, toggle, matchesTrait, countSelected } from '../filter-engine'
import { filterWithRelax } from '../filter-relax'
import type { TraitSchema } from '../../../data/pack-manifest'

const L = (en: string) => ({ en })

const butterflySchema: TraitSchema = {
  traits: [
    { key: 'size', label: L('Wingspan'), type: 'single', render: 'chip',
      options: [{ v: 'small' }, { v: 'med' }, { v: 'large' }] },
    { key: 'colour', label: L('Colour'), type: 'multi', render: 'swatch', max: 3,
      options: [{ v: 'black' }, { v: 'gold' }, { v: 'red' }, { v: 'blue' }] },
    { key: 'pattern', label: L('Pattern'), type: 'multi', render: 'chip',
      options: [{ v: 'spots' }, { v: 'bands' }, { v: 'eyespots' }] },
  ],
  aspects: { required: ['dorsal', 'ventral'], optional: [] },
  sections: [],
}

/** A bird schema shares no trait key with the butterfly one. */
const birdSchema: TraitSchema = {
  traits: [
    { key: 'sizeRef', label: L('Size'), type: 'single', render: 'referent-image',
      options: [{ v: 'sparrow', img: 'a.svg' }, { v: 'crow', img: 'b.svg' }] },
    { key: 'behaviour', label: L('Behaviour'), type: 'multi', render: 'chip',
      options: [{ v: 'water' }, { v: 'soaring' }] },
  ],
  aspects: { required: ['standing'], optional: [] },
  sections: [],
}

const species = [
  { id: 'helena', traits: { size: 'large', colour: ['black', 'gold'], pattern: ['bands'] } },
  { id: 'mormon', traits: { size: 'med', colour: ['black', 'white'], pattern: ['spots'] } },
  { id: 'rose', traits: { size: 'med', colour: ['black', 'red'], pattern: ['bands', 'spots'] } },
  { id: 'pansy', traits: { size: 'small', colour: ['orange', 'blue'], pattern: ['eyespots'] } },
]

const birds = [
  { id: 'kingfisher', traits: { sizeRef: 'sparrow', behaviour: ['water'] } },
  { id: 'eagle', traits: { sizeRef: 'crow', behaviour: ['soaring'] } },
]

describe('filter-engine', () => {
  it('returns everything for an empty selection', () => {
    expect(filter(butterflySchema, {}, species)).toHaveLength(4)
    expect(filter(butterflySchema, { size: [], colour: [] }, species)).toHaveLength(4)
  })

  it('ANDs across traits and ORs within a trait', () => {
    // colour OR: black or blue matches everything except none
    expect(filter(butterflySchema, { colour: ['black', 'blue'] }, species).map((s) => s.id))
      .toEqual(['helena', 'mormon', 'rose', 'pansy'])
    // AND across: med AND black -> mormon, rose
    expect(filter(butterflySchema, { size: ['med'], colour: ['black'] }, species).map((s) => s.id))
      .toEqual(['mormon', 'rose'])
  })

  it('matches a scalar trait value as well as an array one', () => {
    const t = butterflySchema.traits[0]!
    expect(matchesTrait(species[0]!, t, ['large'])).toBe(true)
    expect(matchesTrait(species[0]!, t, ['small'])).toBe(false)
  })

  it('single-type traits replace, multi-type accumulate', () => {
    let s = toggle(butterflySchema, {}, 'size', 'med')
    s = toggle(butterflySchema, s, 'size', 'large')
    expect(s.size).toEqual(['large'])

    s = toggle(butterflySchema, s, 'colour', 'black')
    s = toggle(butterflySchema, s, 'colour', 'gold')
    expect(s.colour).toEqual(['black', 'gold'])
  })

  it('toggling an active value clears it', () => {
    const s = toggle(butterflySchema, { size: ['med'] }, 'size', 'med')
    expect(s.size).toEqual([])
  })

  it('honours max on a multi trait by dropping the oldest', () => {
    let s: Record<string, string[]> = {}
    for (const c of ['black', 'gold', 'red', 'blue']) s = toggle(butterflySchema, s, 'colour', c)
    expect(s.colour).toHaveLength(3)
    expect(s.colour).toEqual(['gold', 'red', 'blue'])
  })

  it('counts selected values across traits', () => {
    expect(countSelected({ size: ['med'], colour: ['black', 'gold'] })).toBe(3)
  })

  it('drives a disjoint bird vocabulary with no code change', () => {
    expect(filter(birdSchema, { sizeRef: ['sparrow'] }, birds).map((b) => b.id)).toEqual(['kingfisher'])
    expect(filter(birdSchema, { behaviour: ['soaring'] }, birds).map((b) => b.id)).toEqual(['eagle'])
  })
})

describe('filter-relax', () => {
  it('reports an exact match without relaxing', () => {
    const r = filterWithRelax(butterflySchema, { size: ['med'] }, species)
    expect(r.exact).toBe(true)
    expect(r.relaxedKey).toBeNull()
    expect(r.results).toHaveLength(2)
  })

  it('never returns empty: relaxes a filter and names which one', () => {
    // large + eyespots matches nothing. Dropping size admits pansy; dropping
    // pattern admits helena — a genuine tie, broken toward the later trait.
    const r = filterWithRelax(butterflySchema, { size: ['large'], pattern: ['eyespots'] }, species)
    expect(r.exact).toBe(false)
    expect(r.results.length).toBeGreaterThan(0)
    expect(r.relaxedKey).toBe('pattern')
  })

  it('relaxes the genuinely least selective filter when there is no tie', () => {
    // med + blue matches nothing. Dropping colour admits 2 (mormon, rose);
    // dropping size admits only pansy. Colour is the less selective filter.
    const r = filterWithRelax(butterflySchema, { size: ['med'], colour: ['blue'] }, species)
    expect(r.relaxedKey).toBe('colour')
    expect(r.results.map((s) => s.id)).toEqual(['mormon', 'rose'])
  })

  it('falls back to the whole pack when no single relaxation helps', () => {
    const r = filterWithRelax(butterflySchema, { size: ['large'], colour: ['blue'], pattern: ['eyespots'] }, species)
    expect(r.results.length).toBeGreaterThan(0)
    expect(r.exact).toBe(false)
  })

  it('relaxes nothing when the pack itself is empty', () => {
    const r = filterWithRelax(butterflySchema, { size: ['med'] }, [])
    expect(r.results).toEqual([])
  })
})
