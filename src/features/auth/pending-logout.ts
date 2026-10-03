/**
 * Sign-out that survives being offline.
 *
 * The session cookie is HttpOnly, so only POST /api/auth/logout can clear it.
 * When that request cannot be made, the local session still ends at once (the
 * active user is cleared), and this flag records that the server-side session
 * is still owed a logout. Until it is delivered, the cookie must never be read
 * as "this person is signed in": otherwise the next launch with a connection
 * would sign the departed user back in and hand them the next person's guest
 * records.
 */
import { getMeta, setMeta } from '../../data/db'
import { fetchSession, signOut as postLogout, type SessionLookup } from './auth-api'

const KEY = 'auth.pendingLogout'

export const isLogoutPending = (): Promise<boolean> => getMeta<boolean>(KEY, false)
export const markLogoutPending = (): Promise<void> => setMeta(KEY, true)
export const clearLogoutPending = (): Promise<void> => setMeta(KEY, false)

/** Delivers an owed logout. `true` when nothing is owed any more. */
export async function flushPendingLogout(): Promise<boolean> {
  if (!(await isLogoutPending())) return true
  if (!(await postLogout())) return false
  await clearLogoutPending()
  return true
}

/**
 * Who is signed in, asked of the server only after any owed logout has been
 * delivered. While a logout is still undeliverable the answer is "nobody", so
 * the caller neither restores the departed account nor claims guest records for it.
 */
export async function lookupSession(): Promise<SessionLookup> {
  if (!(await flushPendingLogout())) return { known: true, user: null }
  return fetchSession()
}
