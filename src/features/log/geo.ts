/**
 * GPS as an explicit state machine, acquired on demand only.
 *
 * A save is NEVER blocked on a GPS state — a sighting with no fix is still a
 * sighting. Continuous tracking is the largest battery drain available to this
 * app and is deliberately absent.
 */
import { useCallback, useState } from 'react'

export type GeoState =
  | { kind: 'idle' }
  | { kind: 'acquiring' }
  | { kind: 'fixed'; lat: number; lng: number; accuracy: number }
  | { kind: 'no_fix' }
  | { kind: 'denied' }
  | { kind: 'unavailable' }

export function useGeo() {
  const [state, setState] = useState<GeoState>({ kind: 'idle' })

  const acquire = useCallback(() => {
    if (!navigator.geolocation) { setState({ kind: 'unavailable' }); return }
    setState({ kind: 'acquiring' })
    navigator.geolocation.getCurrentPosition(
      (pos) => setState({
        kind: 'fixed',
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy: pos.coords.accuracy,
      }),
      (err) => setState(err.code === err.PERMISSION_DENIED ? { kind: 'denied' } : { kind: 'no_fix' }),
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 60_000 },
    )
  }, [])

  const setManual = useCallback((lat: number, lng: number) => {
    setState({ kind: 'fixed', lat, lng, accuracy: 0 })
  }, [])

  const clear = useCallback(() => setState({ kind: 'idle' }), [])

  return { state, acquire, setManual, clear }
}
