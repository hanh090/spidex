import type { User } from './types'

export async function fetchCurrentUser(): Promise<User | null> {
  try {
    const res = await fetch('/api/auth/me', {
      headers: { Accept: 'application/json' },
    })
    if (!res.ok) return null
    const data = await res.json()
    return data.user || null
  } catch {
    return null
  }
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

  return data.user
}

export async function signOut(): Promise<void> {
  try {
    await fetch('/api/auth/logout', { method: 'POST' })
  } catch {
    // Ignore network error on logout
  }
}
