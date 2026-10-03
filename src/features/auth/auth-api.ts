import { setMeta } from '../../data/db'
import type { User } from './types'

/** A fresh session replaces whatever cookie was owed a logout. */
const supersedePendingLogout = () => setMeta('auth.pendingLogout', false)

/**
 * `known: false` means the server could not be asked (offline, outage) — the
 * caller must not read that as "signed out", or an offline launch would hide a
 * signed-in user's own records.
 */
export type SessionLookup = { known: true; user: User | null } | { known: false }

export async function fetchSession(): Promise<SessionLookup> {
  try {
    const res = await fetch('/api/auth/me', {
      headers: { Accept: 'application/json' },
    })
    if (!res.ok) return { known: false }
    const data = await res.json()
    return { known: true, user: data.user || null }
  } catch {
    return { known: false }
  }
}

export async function fetchCurrentUser(): Promise<User | null> {
  const session = await fetchSession()
  return session.known ? session.user : null
}

export async function signInWithPassword(email: string, password: string): Promise<User> {
  const res = await fetch('/api/auth/password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ email, password }),
  })

  const data = await res.json()
  if (!res.ok) {
    throw new Error(data.error || 'Failed to sign in')
  }

  await supersedePendingLogout()
  return data.user
}

export async function signUpWithPassword(
  email: string,
  password: string,
  firstName?: string,
  lastName?: string
): Promise<{ user: User; pendingVerification: boolean }> {
  const res = await fetch('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ email, password, firstName, lastName }),
  })

  const data = await res.json()
  if (!res.ok) {
    throw new Error(data.error || 'Failed to create account')
  }

  // The account exists but no session was issued, e.g. WorkOS wants the email
  // verified first. The user must sign in once that is done.
  if (data.pendingVerification !== true) await supersedePendingLogout()
  return { user: data.user, pendingVerification: data.pendingVerification === true }
}

export async function getOAuthUrl(provider: 'GoogleOAuth' | 'MicrosoftOAuth' | 'authkit'): Promise<string> {
  const res = await fetch(`/api/auth/oauth/${provider}`)
  const data = await res.json()
  if (!res.ok) {
    throw new Error(data.error || 'Failed to get OAuth URL')
  }
  return data.url
}

export async function exchangeOAuthCode(code: string): Promise<User> {
  const res = await fetch('/api/auth/callback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ code }),
  })

  const data = await res.json()
  if (!res.ok) {
    throw new Error(data.error || 'Failed to complete OAuth')
  }

  await supersedePendingLogout()
  return data.user
}

/** `true` only when the server confirmed the session cookie was cleared. */
export async function signOut(): Promise<boolean> {
  try {
    const res = await fetch('/api/auth/logout', { method: 'POST' })
    return res.ok
  } catch {
    return false
  }
}
