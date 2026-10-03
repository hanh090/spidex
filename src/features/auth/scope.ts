/**
 * Which local records the current person may see.
 *
 * The device database is shared by whoever uses the phone, so ownership has to
 * be enforced at read time, not only on the server. A record is visible when
 * it is unclaimed (a guest's offline record, nobody owns it yet) or owned by
 * the active user. Records owned by another account stay on the device — they
 * are that account's data and sync back to it on its next sign-in — but are
 * never listed, counted or opened for anyone else.
 *
 * The active user is persisted rather than held in React state, so offline
 * launches (when /api/auth/me cannot answer) keep showing the same person's
 * records instead of flipping to the guest view.
 */
import { db, getMeta, setMeta, type Sighting, type Trip } from '../../data/db'

const ACTIVE_USER_KEY = 'auth.activeUserId'

export async function getActiveUserId(): Promise<string | null> {
  return getMeta<string | null>(ACTIVE_USER_KEY, null)
}

export async function setActiveUserId(userId: string | null): Promise<void> {
  await setMeta(ACTIVE_USER_KEY, userId)
}

export const isVisibleTo = (row: { userId?: string }, activeUserId: string | null): boolean =>
  !row.userId || row.userId === activeUserId

/** Every local sighting the current person may see, unordered. */
export async function visibleSightings(): Promise<Sighting[]> {
  const active = await getActiveUserId()
  return db.sightings.filter((s) => isVisibleTo(s, active)).toArray()
}

export async function canViewSighting(s: Sighting | undefined): Promise<boolean> {
  return !!s && isVisibleTo(s, await getActiveUserId())
}

export async function visibleTrips(): Promise<Trip[]> {
  const active = await getActiveUserId()
  return db.trips.orderBy('startedAt').reverse().filter((t) => isVisibleTo(t, active)).toArray()
}

/**
 * Records that exist only on this device or have not finished syncing:
 * unclaimed guest records, anything not yet `synced`, and records whose photos
 * have not uploaded. Signing out does not delete them, but they are hidden
 * from the next person and unreachable from other devices until this account
 * signs in here again — worth a warning.
 */
export async function countUnsynced(): Promise<number> {
  const mine = await visibleSightings()
  const ids = new Set<string>()
  for (const s of mine) if (!s.userId || s.syncState !== 'synced') ids.add(s.id)
  const visible = new Set(mine.map((s) => s.id))
  await db.photos
    .filter((p) => !p.deletedAt && p.syncState !== 'synced' && visible.has(p.sightingId))
    .each((p) => { ids.add(p.sightingId) })
  return ids.size
}
