/**
 * Signing out with no connection must still end the session at the next
 * launch: the HttpOnly cookie can only be cleared by the server, so the logout
 * is owed and delivered first, and nothing is claimed for the departed account.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../../data/db'
import { listSightings, saveSighting } from '../../log/sighting-repo'
import { getActiveUserId } from '../scope'
import { beginUserSession, endUserSession, refreshSession } from '../session-transitions'
import { isLogoutPending, markLogoutPending } from '../pending-logout'
import { signInWithPassword } from '../auth-api'

const A = { id: 'user-a', email: 'a@x.co' }

/** A server that holds A's cookie until a successful POST /api/auth/logout. */
function serverWithCookie(online: { value: boolean }) {
  let cookie = true
  const calls: string[] = []
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? 'GET'} ${url}`)
    if (!online.value) throw new TypeError('Failed to fetch')
    if (url === '/api/auth/logout') { cookie = false; return new Response('{"success":true}') }
    if (url === '/api/auth/me') return new Response(JSON.stringify({ user: cookie ? A : null }))
    if (url === '/api/auth/password') { cookie = true; return new Response(JSON.stringify({ user: { id: 'user-c', email: 'c@x.co' } })) }
    return new Response('{}', { status: 404 })
  })
  return { fn, calls, hasCookie: () => cookie }
}

beforeEach(async () => {
  await Promise.all([db.sightings.clear(), db.photos.clear(), db.trips.clear(), db.meta.clear()])
})
afterEach(() => vi.unstubAllGlobals())

/** What the sign-out button does, minus React. */
async function signOutOffline() {
  await markLogoutPending()
  await endUserSession()
}

describe('sign-out while offline', () => {
  it('ends the session locally at once and records that a logout is owed', async () => {
    await beginUserSession(A.id)
    await signOutOffline()
    expect(await getActiveUserId()).toBeNull()
    expect(await isLogoutPending()).toBe(true)
  })

  it('does not restore the departed user or claim the next guest records while the logout cannot be delivered', async () => {
    const online = { value: false }
    const server = serverWithCookie(online)
    vi.stubGlobal('fetch', server.fn)

    await beginUserSession(A.id)
    await signOutOffline()
    // B logs a sighting as a guest.
    await saveSighting({ count: 1, notes: 'b-guest', photos: [] })

    // Back online but the logout request itself still fails (flaky link).
    online.value = false
    expect(await refreshSession()).toBeNull()
    expect(await getActiveUserId()).toBeNull()
    expect((await db.sightings.toArray()).every((s) => !s.userId)).toBe(true)

    // Connection returns: the logout goes out before anything asks who is signed in.
    online.value = true
    expect(await refreshSession()).toBeNull()
    const requests = server.calls
    expect(requests.indexOf('POST /api/auth/logout')).toBeGreaterThanOrEqual(0)
    expect(requests.indexOf('POST /api/auth/logout')).toBeLessThan(requests.indexOf('GET /api/auth/me'))
    expect(server.hasCookie()).toBe(false)
    expect(await isLogoutPending()).toBe(false)

    // B's record was never stamped with A's id.
    expect((await db.sightings.toArray()).map((s) => s.userId)).toEqual([undefined])
    expect((await listSightings()).map((s) => s.notes)).toEqual(['b-guest'])
  })

  it('never asks the server who is signed in while the owed logout fails', async () => {
    const online = { value: true }
    const server = serverWithCookie(online)
    // Logout is refused (5xx) but /me would still answer with A.
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      server.calls.push(`${init?.method ?? 'GET'} ${url}`)
      if (url === '/api/auth/logout') return new Response('{}', { status: 503 })
      return new Response(JSON.stringify({ user: A }))
    }))
    await signOutOffline()
    expect(await refreshSession()).toBeNull()
    expect(server.calls).toEqual(['POST /api/auth/logout'])
    expect(await isLogoutPending()).toBe(true)
  })

  it('a later sign-in supersedes the owed logout instead of being logged out by it', async () => {
    const online = { value: true }
    const server = serverWithCookie(online)
    vi.stubGlobal('fetch', server.fn)
    await signOutOffline()
    await signInWithPassword('c@x.co', 'pw-long-enough')
    expect(await isLogoutPending()).toBe(false)
    expect(await refreshSession()).toMatchObject({ id: 'user-a' }) // server cookie is whatever the server says; no logout was sent
    expect(server.calls).not.toContain('POST /api/auth/logout')
  })

  it('an ordinary launch with nothing owed just asks the server', async () => {
    const online = { value: true }
    const server = serverWithCookie(online)
    vi.stubGlobal('fetch', server.fn)
    expect(await refreshSession()).toMatchObject({ id: 'user-a' })
    expect(await getActiveUserId()).toBe('user-a')
    expect(server.calls).toEqual(['GET /api/auth/me'])
  })
})
