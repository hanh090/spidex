import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react'
import type { User, AuthState } from './types'
import {
  fetchCurrentUser,
  signInWithPassword,
  signUpWithPassword,
  getOAuthUrl,
  signOut as apiSignOut,
} from './auth-api'
import { claimGuestSightings } from './claim'

interface AuthContextValue extends AuthState {
  signIn: (email: string, pass: string) => Promise<User>
  signUp: (email: string, pass: string, first?: string, last?: string) => Promise<User>
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
      const current = await fetchCurrentUser()
      setUser(current)
      if (current?.id) {
        // Automatically claim any offline guest sightings on session discovery
        void claimGuestSightings(current.id)
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refreshUser()
  }, [refreshUser])

  const signIn = async (email: string, pass: string): Promise<User> => {
    const loggedIn = await signInWithPassword(email, pass)
    setUser(loggedIn)
    if (loggedIn.id) {
      await claimGuestSightings(loggedIn.id)
    }
    return loggedIn
  }

  const signUp = async (email: string, pass: string, first?: string, last?: string): Promise<User> => {
    const created = await signUpWithPassword(email, pass, first, last)
    setUser(created)
    if (created.id) {
      await claimGuestSightings(created.id)
    }
    return created
  }

  const signOut = async () => {
    await apiSignOut()
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
