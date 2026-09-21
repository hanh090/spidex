/**
 * Connectivity.
 *
 * There is no backend until Phase 5, so this reports link state only and is
 * never used to gate a local read. `navigator.onLine` is true on a captive
 * portal and on a jungle wifi router with no uplink; reachability derived
 * from real sync outcomes arrives in Phase 6, where a signal exists to
 * consume. Deliberately not a heartbeat — this app cannot afford the radio.
 */
import { useEffect, useState } from 'react'

export function useOnline(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine)
  useEffect(() => {
    const up = () => setOnline(true)
    const down = () => setOnline(false)
    window.addEventListener('online', up)
    window.addEventListener('offline', down)
    return () => {
      window.removeEventListener('online', up)
      window.removeEventListener('offline', down)
    }
  }, [])
  return online
}
