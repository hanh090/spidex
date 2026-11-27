/**
 * The packs actually on offer right now: every id the published index names
 * whose manifest can be fetched and validated.
 *
 * The library and the first-run screen both read this, so the number of packs
 * one shows can never differ from the other. An id the index lists but the
 * server cannot serve (no directory yet, offline) is not on offer and is not
 * counted anywhere.
 */
import { fetchPackIndex, type PackIndex } from '../../data/pack-index'
import { fetchManifest } from '../../data/pack-download'
import type { PackManifest } from '../../data/pack-manifest'
import { packBaseUrl } from './use-pack'

export interface PublishedPack {
  id: string
  manifest: PackManifest
  /** Position in the published catalogue, from 1 — the pack's catalogue number. */
  catNo: number
}

export interface PublishedCatalogue {
  index: PackIndex
  /** In catalogue order. */
  packs: PublishedPack[]
}

export async function fetchPublishedPacks(): Promise<PublishedCatalogue> {
  const index = await fetchPackIndex()
  const fetched = await Promise.all(
    index.packs.map(async (id, i) => {
      const res = await fetchManifest(packBaseUrl(id))
      return res.ok && res.manifest.releaseStatus !== 'fixture'
        ? { id, manifest: res.manifest, catNo: i + 1 }
        : null
    }),
  )
  return { index, packs: fetched.filter((p): p is PublishedPack => p !== null) }
}
