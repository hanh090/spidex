import { db } from '../../data/db'

/**
 * Claims local sightings for the authenticated user account.
 * Follows Phase 5 specification:
 * - Local-first stamping: WHERE userId IS NULL
 * - Idempotent: already claimed records are never re-stamped
 */
export async function claimGuestSightings(userId: string): Promise<number> {
  let claimedCount = 0
  await db.transaction('rw', db.sightings, async () => {
    const unclaimed = await db.sightings.filter((s) => !s.userId).toArray()
    for (const s of unclaimed) {
      await db.sightings.update(s.id, { userId })
      claimedCount++
    }
  })
  return claimedCount
}
