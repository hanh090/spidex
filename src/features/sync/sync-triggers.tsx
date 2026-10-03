/**
 * Foreground sync triggers: sign-in, `online`, and the app regaining focus.
 * Renders nothing. Nothing here registers a service-worker sync — if the app
 * is closed, nothing syncs, and the UI never claims otherwise.
 *
 * Focus and `online` can fire together (and focus fires on every tab switch),
 * so automatic triggers are throttled; the manual "Sync now" button is not.
 */
import { useEffect } from 'react'
import { useAuth } from '../auth/auth-context'
import { syncNow } from './engine'

export const AUTO_SYNC_MIN_INTERVAL_MS = 30_000

export function SyncTriggers() {
  const { user } = useAuth()
  const userId = user?.id

  useEffect(() => {
    // Guests never sync.
    if (!userId) return
    let last = 0
    const trigger = () => {
      const now = Date.now()
      if (now - last < AUTO_SYNC_MIN_INTERVAL_MS) return
      last = now
      void syncNow(userId)
    }
    const onVisible = () => { if (document.visibilityState === 'visible') trigger() }

    trigger() // sign-in / app start with an existing session
    window.addEventListener('online', trigger)
    window.addEventListener('focus', trigger)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.removeEventListener('online', trigger)
      window.removeEventListener('focus', trigger)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [userId])

  return null
}
