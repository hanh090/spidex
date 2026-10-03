/**
 * Favourites are target species. A favourite is "seen" once any sighting
 * exists for the same pack-scoped species, so the list doubles as a target
 * checklist for the next outing.
 */
import { db, speciesUid, type Favourite, type StoredSpecies } from '../../data/db'
import { visibleSightings } from '../auth/scope'

export interface FavouriteView {
  favourite: Favourite
  /** Undefined when the species' pack is no longer installed. */
  species?: StoredSpecies
  /** Names from a sighting snapshot, used when the pack is gone. */
  sciName?: string
  commonName?: string
  seen: boolean
  lastSeen?: number
}

export async function listFavourites(): Promise<FavouriteView[]> {
  const [favs, sightings] = await Promise.all([
    db.favourites.orderBy('addedAt').reverse().toArray(),
    visibleSightings(),
  ])
  const species = await db.species.bulkGet(favs.map((f) => speciesUid(f.packId, f.speciesId)))
  const seen = new Map<string, { at: number; sci?: string; common?: string }>()
  for (const s of sightings) {
    if (!s.speciesId || !s.packId) continue
    const key = speciesUid(s.packId, s.speciesId)
    const prev = seen.get(key)
    if (!prev || s.at > prev.at) {
      seen.set(key, { at: s.at, sci: s.speciesSnapshot?.sciName, common: s.speciesSnapshot?.commonName })
    }
  }
  return favs.map((favourite, i) => {
    const hit = seen.get(favourite.id)
    return {
      favourite,
      species: species[i],
      sciName: hit?.sci,
      commonName: hit?.common,
      seen: !!hit,
      lastSeen: hit?.at,
    }
  })
}

export async function removeFavourite(id: string): Promise<void> {
  await db.favourites.delete(id)
}
