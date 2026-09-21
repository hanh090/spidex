/**
 * Edge swipe-back for pushed screens.
 *
 * Installed PWAs have no browser chrome, so on Android there is no back
 * affordance at all beyond the system gesture, and on iOS standalone mode
 * Safari's own interactive pop is unavailable. Without this, the only way out
 * of a species page is to hit one 40px target in the top-left corner — with
 * the phone in one hand and binoculars in the other.
 *
 * Deliberately edge-anchored: the gesture only arms when it begins within
 * EDGE_PX of the left edge, so horizontal rails inside the screen (the filter
 * chips, the aspect tabs, the similar-species row) keep their own scrolling.
 */
import { useCallback, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'

/** The gesture arms only when it starts this close to the left edge. */
const EDGE_PX = 28
/** Horizontal travel that commits the pop. */
const COMMIT_PX = 72
/** Beyond this much vertical drift it is a scroll, not a swipe. */
const SLOP_PX = 40

export function useSwipeBack(onBack: () => void, enabled = true): void {
  const state = useRef<{ x0: number; y0: number; armed: boolean } | null>(null)

  useEffect(() => {
    if (!enabled) return
    if (typeof window === 'undefined') return

    const down = (e: PointerEvent) => {
      if (e.pointerType === 'mouse') return
      state.current = { x0: e.clientX, y0: e.clientY, armed: e.clientX <= EDGE_PX }
    }

    const up = (e: PointerEvent) => {
      const s = state.current
      state.current = null
      if (!s?.armed) return
      const dx = e.clientX - s.x0
      const dy = Math.abs(e.clientY - s.y0)
      if (dx >= COMMIT_PX && dy <= SLOP_PX) onBack()
    }

    window.addEventListener('pointerdown', down, { passive: true })
    window.addEventListener('pointerup', up, { passive: true })
    window.addEventListener('pointercancel', () => { state.current = null }, { passive: true })
    return () => {
      window.removeEventListener('pointerdown', down)
      window.removeEventListener('pointerup', up)
    }
  }, [onBack, enabled])
}

/**
 * Pop to the previous screen, or to `fallback` when this screen was opened
 * directly — a shared species link, or a cold start on a deep route.
 */
export function useGoBack(fallback = '/'): () => void {
  const navigate = useNavigate()
  return useCallback(() => {
    if (typeof window !== 'undefined' && window.history.length > 1) navigate(-1)
    else navigate(fallback)
  }, [navigate, fallback])
}
