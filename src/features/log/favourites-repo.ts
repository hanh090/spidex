/**
 * Favourites are target species. A favourite is "seen" once any sighting
 * exists for the same pack-scoped species, so the list doubles as a target
 * checklist for the next outing.
 */
import { db, speciesUid, type Favourite, type StoredSpecies } from '../../data/db'
import { getActiveUserId, isVisibleTo, visibleSightings } from '../auth/scope'

export interface FavouriteView {
  favourite: Favourite
  /** Undefined when the species' pack is no longer installed. */
  species?: StoredSpecies
  /** Names from a sighting snapshot, used when the pack is gone. */
  sciName?: string
  commonName?: string
  seen: boolean
  lastSeen?: number
  /** Stored offset of that last sighting, to show its date where it was observed. */
  lastSeenOffset?: number
}

/**
 * Favourites are per person on a shared device, like sightings: an owned row's
 * id carries the user so two accounts can favourite the same species without
 * overwriting each other, and only unowned (guest) or the active user's rows
 * are ever listed or changed.
 */
export const favouriteId = (userId: string | null, packId: string, speciesId: string): string =>
  userId ? `${userId}|${packId}:${speciesId}` : speciesUid(packId, speciesId)

export async function isFavourite(packId: string, speciesId: string): Promise<boolean> {
  return !!(await db.favourites.get(favouriteId(await getActiveUserId(), packId, speciesId)))
}

export async function setFavourite(packId: string, speciesId: string, on: boolean): Promise<void> {
  const userId = await getActiveUserId()
  const id = favouriteId(userId, packId, speciesId)
  if (!on) {
    await db.favourites.delete(id)
    return
  }
  await db.favourites.put({ id, packId, speciesId, addedAt: Date.now(), ...(userId ? { userId } : {}) })
}

export async function listFavourites(): Promise<FavouriteView[]> {
  const active = await getActiveUserId()
  const [favs, sightings] = await Promise.all([
    db.favourites.orderBy('addedAt').reverse().filter((f) => isVisibleTo(f, active)).toArray(),
    visibleSightings(),
  ])
  const species = await db.species.bulkGet(favs.map((f) => speciesUid(f.packId, f.speciesId)))
  const seen = new Map<string, { at: number; offset: number; sci?: string; common?: string }>()
  for (const s of sightings) {
    if (!s.speciesId || !s.packId) continue
    const key = speciesUid(s.packId, s.speciesId)
    const prev = seen.get(key)
    if (!prev || s.at > prev.at) {
      seen.set(key, { at: s.at, offset: s.tzOffsetMinutes, sci: s.speciesSnapshot?.sciName, common: s.speciesSnapshot?.commonName })
    }
  }
  return favs.map((favourite, i) => {
    const hit = seen.get(speciesUid(favourite.packId, favourite.speciesId))
    return {
      favourite,
      species: species[i],
      sciName: hit?.sci,
      commonName: hit?.common,
      seen: !!hit,
      lastSeen: hit?.at,
      lastSeenOffset: hit?.offset,
    }
  })
}

export async function removeFavourite(id: string): Promise<void> {
  const row = await db.favourites.get(id)
  if (!row || !isVisibleTo(row, await getActiveUserId())) return
  await db.favourites.delete(id)
}
