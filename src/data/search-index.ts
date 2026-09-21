/**
 * Offline species search.
 *
 * Indexes ALL languages plus the scientific name at once, regardless of the
 * active UI language: a German birder in Vietnam hears a Vietnamese name from
 * their guide and reads the English one in a book. Scoping the index to the
 * active language would break the core use case.
 *
 * Hand-rolled rather than a library: the binding requirement is
 * diacritic-insensitive Vietnamese matching, which is the part a generic
 * tokenizer needs configuring for anyway. ~1k species is a linear scan over a
 * prepared string — well inside budget and with no dependency to tune.
 */
import type { StoredSpecies } from './db'

/** Strip diacritics so "buom phuong" finds "bướm phượng", and đ/Đ map to d. */
export function fold(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .trim()
}

/** Everything a species can be searched by, folded and joined. */
export function buildSearchBlob(sp: {
  sciName: string
  commonNames: { en: string; de?: string; vi?: string }
  family: string
}): string {
  return fold([sp.sciName, sp.family, sp.commonNames.en, sp.commonNames.de ?? '', sp.commonNames.vi ?? ''].join(' '))
}

export interface SearchHit { id: string; score: number }

/**
 * Rank: a prefix match on a word beats a mid-word match; earlier beats later.
 * Every query term must appear, so "common bird" narrows rather than widens.
 */
export function search(species: StoredSpecies[], query: string, limit = 60): SearchHit[] {
  const terms = fold(query).split(/\s+/).filter(Boolean)
  if (!terms.length) return []

  const hits: SearchHit[] = []
  for (const sp of species) {
    const blob = sp.searchBlob
    let score = 0
    let all = true
    for (const term of terms) {
      const at = blob.indexOf(term)
      if (at === -1) { all = false; break }
      const wordStart = at === 0 || blob[at - 1] === ' '
      score += wordStart ? 100 - Math.min(at, 60) : 30 - Math.min(at, 25)
    }
    if (all) hits.push({ id: sp.id, score })
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, limit)
}
