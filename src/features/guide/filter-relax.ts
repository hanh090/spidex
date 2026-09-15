/**
 * Zero-match recovery.
 *
 * Filters that match nothing must never dead-end: the app drops the
 * least-selective active filter, returns the closest matches, and names which
 * filter it relaxed so the UI can label it and offer a one-tap restore.
 *
 * "Least selective" = the filter whose removal admits the most candidates,
 * i.e. the one doing the least work to narrow the set.
 *
 * Ties are common with a small pack, so the rule is explicit: prefer the trait
 * declared LATER in the schema. Pack authors order traits from the most
 * reliable field judgement to the least — size before pattern — so relaxing
 * the later one keeps the discriminator the author trusted most.
 */
import type { TraitSchema } from '../../data/pack-manifest'
import { filter, type Candidate, type Selection } from './filter-engine'

export interface RelaxedResult<T> {
  results: T[]
  /** null when the unrelaxed selection already matched. */
  relaxedKey: string | null
  exact: boolean
}

export function filterWithRelax<T extends Candidate>(
  schema: TraitSchema,
  selection: Selection,
  species: T[],
): RelaxedResult<T> {
  const exactHits = filter(schema, selection, species)
  if (exactHits.length > 0) return { results: exactHits, relaxedKey: null, exact: true }

  const activeKeys = schema.traits.map((t) => t.key).filter((k) => (selection[k]?.length ?? 0) > 0)
  if (activeKeys.length === 0) return { results: species, relaxedKey: null, exact: true }

  let best: { key: string; results: T[] } | null = null
  // activeKeys follows schema order, so `>=` lets a later trait win a tie.
  for (const key of activeKeys) {
    const without: Selection = { ...selection, [key]: [] }
    const hits = filter(schema, without, species)
    if (!best || hits.length >= best.results.length) best = { key, results: hits }
  }

  // Every single-filter relaxation still empty: fall back to the whole pack
  // rather than showing nothing.
  if (!best || best.results.length === 0) {
    return { results: species, relaxedKey: activeKeys[0] ?? null, exact: false }
  }
  return { results: best.results, relaxedKey: best.key, exact: false }
}
