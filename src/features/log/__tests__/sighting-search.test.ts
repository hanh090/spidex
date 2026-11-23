import { describe, it, expect } from 'vitest'
import type { Sighting } from '../../../data/db'
import { filterSightings } from '../sighting-search'

function row(id: string, commonName: string | undefined, sciName: string | undefined, notes: string): Sighting {
  return {
    id, notes,
    speciesSnapshot: commonName ? { commonName, sciName: sciName ?? '' } : undefined,
  } as Sighting
}

const rows = [
  row('a', 'Common Kingfisher', 'Alcedo atthis', 'perched on a reed'),
  row('b', 'Bồng chanh đỏ', 'Ceyx erithaca', ''),
  row('c', undefined, undefined, 'small brown bird near the đầm'),
]

const ids = (q: string) => filterSightings(rows, q).map((s) => s.id)

describe('filterSightings', () => {
  it('keeps everything for an empty or blank query', () => {
    expect(ids('')).toEqual(['a', 'b', 'c'])
    expect(ids('   ')).toEqual(['a', 'b', 'c'])
  })

  it('matches the common name, the scientific name and the notes', () => {
    expect(ids('kingfisher')).toEqual(['a'])
    expect(ids('ceyx')).toEqual(['b'])
    expect(ids('reed')).toEqual(['a'])
  })

  it('finds unidentified records by their notes', () => {
    expect(ids('brown bird')).toEqual(['c'])
  })

  it('ignores case and Vietnamese diacritics', () => {
    expect(ids('BONG CHANH do')).toEqual(['b'])
    expect(ids('dam')).toEqual(['c'])
  })

  it('needs every term, so more words narrow the list', () => {
    expect(ids('kingfisher reed')).toEqual(['a'])
    expect(ids('kingfisher brown')).toEqual([])
  })
})
