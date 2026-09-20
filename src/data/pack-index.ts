/**
 * The published pack catalogue.
 *
 * `public/packs/index.json` is the remote list — a pack ships by dropping a
 * directory on the server and adding its id here, with no app release. The
 * bundled CATALOGUE is the fallback for two cases: a deploy older than this
 * file (the fetch 404s into the SPA shell, which fails to parse), and the
 * offline path, where every remote manifest fetch would fail anyway and the
 * library correctly shows only what is installed.
 */
import { CATALOGUE, FEATURED } from './pack-catalogue'

export interface PackIndex {
  /** Catalogue order — display order in the library. */
  packs: string[]
  /** Offered on first run. */
  featured: string[]
}

interface RawIndex {
  version?: number
  packs?: unknown
  featured?: unknown
}

const INDEX_URL = '/packs/index.json'

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
}

/**
 * Fetch the published index, falling back to the bundled list.
 *
 * `cache: 'no-store'` matters twice over: a pack added server-side must show
 * up without a service-worker update, and the pack manager's "update
 * available" badge compares against what is actually published right now.
 */
export async function fetchPackIndex(): Promise<PackIndex> {
  try {
    const res = await fetch(INDEX_URL, { cache: 'no-store' })
    if (res.ok) {
      const raw = (await res.json()) as RawIndex
      const packs = strings(raw.packs)
      if (packs.length) {
        const featured = strings(raw.featured)
        return { packs, featured: featured.length ? featured : [...FEATURED] }
      }
    }
  } catch {
    /* Offline — the bundled list still names what this build knows about. */
  }
  return { packs: [...CATALOGUE], featured: [...FEATURED] }
}
