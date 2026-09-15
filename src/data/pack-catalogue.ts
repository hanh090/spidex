/**
 * The packs bundled with this build.
 *
 * This is the single list. The pack library screen and the first-run
 * onboarding both read it, and both take every display string — name, species
 * count, region, licence — from the pack's own manifest. Nothing about a pack
 * is written twice, and nothing about a pack is written in one language:
 * `name` is LocalizedText and resolves per the interface language.
 */

/** Every pack shipped in `public/packs/`, in library display order. */
export const CATALOGUE = [
  'butterfly-vn',
  'bird-vn',
  'butterfly-th',
  'bird-th',
  'butterfly-sg',
  'butterfly-min',
  'bird-min',
] as const

/**
 * Offered on first run, before the user has reached the library.
 *
 * Two only. A first-run screen that lists seven packs is a decision, and the
 * user has no basis to make it yet — these are the two national checklists
 * with photographic plates. Everything else stays one tap away in the library.
 */
export const FEATURED = ['bird-vn', 'butterfly-vn'] as const

export type PackId = (typeof CATALOGUE)[number]
