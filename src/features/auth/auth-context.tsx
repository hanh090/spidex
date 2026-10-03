import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react'
import type { User, AuthState } from './types'
import {
  signInWithPassword,
  signUpWithPassword,
  getOAuthUrl,
} from './auth-api'
import { flushPendingLogout, markLogoutPending } from './pending-logout'
import { beginUserSession, endUserSession, refreshSession } from './session-transitions'

interface AuthContextValue extends AuthState {
  signIn: (email: string, pass: string) => Promise<User>
  signUp: (email: string, pass: string, first?: string, last?: string) => Promise<{ pendingVerification: boolean }>
  signOut: () => Promise<void>
  loginWithOAuth: (provider: 'GoogleOAuth' | 'MicrosoftOAuth' | 'authkit') => Promise<void>
  refreshUser: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  const refreshUser = useCallback(async () => {
    try {
      // Claims offline guest sightings and scopes local data to the user before
      // the UI renders as them; a signed-out answer stops showing the previous
      // account's records. Offline or server down: keep the current view.
      const user = await refreshSession()
      if (user === undefined) return
      setUser(user)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refreshUser()
    // An owed server-side logout is delivered as soon as the device is online
    // again, before anything asks the server who is signed in.
    const onOnline = () => void refreshUser()
    window.addEventListener('online', onOnline)
    return () => window.removeEventListener('online', onOnline)
  }, [refreshUser])

  const signIn = async (email: string, pass: string): Promise<User> => {
    const loggedIn = await signInWithPassword(email, pass)
    if (loggedIn.id) await beginUserSession(loggedIn.id)
    setUser(loggedIn)
    return loggedIn
  }

  const signUp = async (email: string, pass: string, first?: string, last?: string) => {
    const { user: created, pendingVerification } = await signUpWithPassword(email, pass, first, last)
    if (pendingVerification) return { pendingVerification }
    if (created.id) await beginUserSession(created.id)
    setUser(created)
    return { pendingVerification }
  }

  const signOut = async () => {
    // Fail closed on the device first: the person is signed out locally even
    // with no signal, and the server-side logout is owed until it succeeds.
    await markLogoutPending()
    await endUserSession()
    setUser(null)
    await flushPendingLogout()
  }

  const loginWithOAuth = async (provider: 'GoogleOAuth' | 'MicrosoftOAuth' | 'authkit') => {
    const url = await getOAuthUrl(provider)
    window.location.href = url
  }

  const value: AuthContextValue = {
    user,
    loading,
    isGuest: !user,
    signIn,
    signUp,
    signOut,
    loginWithOAuth,
    refreshUser,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return ctx
}
