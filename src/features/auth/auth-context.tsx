import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react'
import type { User, AuthState } from './types'
import {
  fetchSession,
  signInWithPassword,
  signUpWithPassword,
  getOAuthUrl,
  signOut as apiSignOut,
} from './auth-api'
import { setActiveUserId } from './scope'
import { beginUserSession, endUserSession } from './session-transitions'

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
      const session = await fetchSession()
      // Offline or server down: keep whatever view we have rather than guess.
      if (!session.known) return
      if (session.user?.id) {
        // Claims offline guest sightings and scopes local data to this user
        // before the UI renders as them.
        await beginUserSession(session.user.id)
      } else {
        // Authoritatively signed out (e.g. session expired): stop showing the
        // previous account's records. The install identity is left alone.
        await setActiveUserId(null)
      }
      setUser(session.user)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refreshUser()
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
    await apiSignOut()
    await endUserSession()
    setUser(null)
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
