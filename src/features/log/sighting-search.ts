/**
 * Search over the field log.
 *
 * A sighting is found by what the person remembers of it: the species (in any
 * of the pack's names as stored on the record, or its scientific name) or a
 * word from their own notes. Matching is diacritic-insensitive, the same way
 * species search is, so "bong chanh" finds "Bồng chanh".
 */
import type { Sighting } from '../../data/db'
import { fold } from '../../data/search-index'

/** Every term must appear somewhere on the record; an empty query keeps all. */
export function filterSightings(rows: Sighting[], query: string): Sighting[] {
  const terms = fold(query).split(/\s+/).filter(Boolean)
  if (!terms.length) return rows
  return rows.filter((s) => {
    const blob = fold([s.speciesSnapshot?.commonName ?? '', s.speciesSnapshot?.sciName ?? '', s.notes].join(' '))
    return terms.every((term) => blob.includes(term))
  })
}
