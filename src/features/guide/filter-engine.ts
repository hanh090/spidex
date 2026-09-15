/**
 * Trait filtering. A pure function of (schema, selection, species) — no React,
 * no database, no DOM, so correctness is testable directly.
 *
 * Explore and Identify are two presentations of THIS engine. Neither may hold
 * filtering logic of its own; that duplication is the most likely
 * architectural failure in the guide and it doubles the bug surface.
 */
import type { TraitSchema, Trait } from '../../data/pack-manifest'

/** trait key -> selected option values. An absent or empty key is "any". */
export type Selection = Record<string, string[]>

export interface Candidate {
  id: string
  traits: Record<string, string | string[]>
}

const asArray = (v: string | string[] | undefined): string[] =>
  v == null ? [] : Array.isArray(v) ? v : [v]

/**
 * A species matches a trait when it carries at least one selected value.
 * Within a trait, values are OR'd; across traits, AND'd — so picking "black"
 * and "gold" widens the colour test while adding a size narrows overall.
 */
export function matchesTrait(candidate: Candidate, trait: Trait, selected: string[]): boolean {
  if (!selected.length) return true
  const have = asArray(candidate.traits[trait.key])
  return selected.some((s) => have.includes(s))
}

export function filter<T extends Candidate>(schema: TraitSchema, selection: Selection, species: T[]): T[] {
  const active = schema.traits.filter((t) => (selection[t.key]?.length ?? 0) > 0)
  if (!active.length) return species
  return species.filter((sp) => active.every((t) => matchesTrait(sp, t, selection[t.key]!)))
}

export function countSelected(selection: Selection): number {
  return Object.values(selection).reduce((n, v) => n + (v?.length ?? 0), 0)
}

/** Toggle a value, honouring `type` (single replaces) and `max` (multi caps). */
export function toggle(schema: TraitSchema, selection: Selection, key: string, value: string): Selection {
  const trait = schema.traits.find((t) => t.key === key)
  if (!trait) return selection
  const current = selection[key] ?? []
  const has = current.includes(value)

  if (trait.type === 'single') {
    return { ...selection, [key]: has ? [] : [value] }
  }
  if (has) {
    return { ...selection, [key]: current.filter((v) => v !== value) }
  }
  const next = [...current, value]
  const capped = trait.max ? next.slice(-trait.max) : next
  return { ...selection, [key]: capped }
}

export function clearAll(): Selection {
  return {}
}
