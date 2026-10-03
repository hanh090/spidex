import { db } from '../../data/db'

/**
 * Claims local records for the authenticated user account.
 * - Local-first stamping: only records with no owner (`userId` unset)
 * - Idempotent: already claimed records are never re-stamped, so another
 *   account's records on a shared device cannot be taken over
 *
 * Trips and favourites are claimed alongside, so a guest's trip names and
 * target species follow their sightings.
 * Returns the number of sightings claimed.
 */
export async function claimGuestSightings(userId: string): Promise<number> {
  let claimedCount = 0
  await db.transaction('rw', db.sightings, db.trips, db.favourites, async () => {
    const unclaimed = await db.sightings.filter((s) => !s.userId).toArray()
    for (const s of unclaimed) {
      await db.sightings.update(s.id, { userId })
      claimedCount++
    }
    const trips = await db.trips.filter((t) => !t.userId).toArray()
    for (const t of trips) await db.trips.update(t.id, { userId })
    // Favourites move to the account's own id; one the account already has wins.
    const favs = await db.favourites.filter((f) => !f.userId).toArray()
    for (const f of favs) {
      await db.favourites.delete(f.id)
      const owned = `${userId}|${f.packId}:${f.speciesId}`
      if (!(await db.favourites.get(owned))) await db.favourites.add({ ...f, id: owned, userId })
    }
  })
  return claimedCount
}
