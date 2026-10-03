/**
 * Local-database side of signing in and out. Kept apart from the React context
 * so the shared-device guarantees can be tested against the real tables.
 */
import { rotateInstallId } from '../../data/db'
import { claimGuestSightings } from './claim'
import { getActiveUserId, setActiveUserId } from './scope'
import { lookupSession } from './pending-logout'
import type { User } from './types'

/**
 * Make `userId` the active person: records they own become visible, and
 * unclaimed guest records are stamped to them. Run BEFORE the UI learns of the
 * new user, so the first query it makes already sees the right records.
 */
export async function beginUserSession(userId: string): Promise<void> {
  await setActiveUserId(userId)
  await claimGuestSightings(userId)
}

/**
 * Hand the device back clean. Any record the departing account left unclaimed
 * is stamped to it first (so it cannot be inherited), the active user is
 * cleared, and the install identity rotates so the next person's records are
 * not attributed to this install.
 */
export async function endUserSession(): Promise<void> {
  const departing = await getActiveUserId()
  if (departing) await claimGuestSightings(departing)
  await setActiveUserId(null)
  await rotateInstallId()
}

/**
 * Ask the server who is signed in and bring the local scope in line. Returns
 * `undefined` when the server could not be asked (keep the current view), else
 * the signed-in user or null. An owed logout is delivered first, and while it
 * cannot be delivered nobody is treated as signed in, so the departed account's
 * cookie neither restores that user nor claims the next person's guest records.
 */
export async function refreshSession(): Promise<User | null | undefined> {
  const session = await lookupSession()
  if (!session.known) return undefined
  if (session.user?.id) {
    await beginUserSession(session.user.id)
  } else {
    await setActiveUserId(null)
  }
  return session.user
}
