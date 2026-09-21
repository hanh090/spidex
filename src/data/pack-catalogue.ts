/**
 * The packs bundled with this build — now a FALLBACK, not the catalogue.
 *
 * The published catalogue lives at `public/packs/index.json` and is fetched
 * at runtime by `pack-index.ts`, so a new pack can be offered without an app
 * release. This list remains for two cases: the index fetch failing (offline,
 * or a deploy that predates it), and onboarding before the network has
 * answered. Keep it in sync with the index — `scripts/build_pack_index.py`
 * regenerates the index from the pack manifests on disk.
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
