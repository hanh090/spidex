/**
 * Scroll restoration for the app's inner scroll container.
 *
 * The shell owns the viewport and only inner regions scroll, so the browser's
 * own restoration never applies — it restores the document, which never moves.
 * Without this every navigation started at the top, including going *back*:
 * scroll to the 800th species, open it, return, and you are at the first again.
 *
 * Push goes to the top, which is right for a screen you have not seen. Pop
 * restores where you were, which is right for one you are returning to.
 *
 * Position is recorded while scrolling, not when the screen unmounts. Effect
 * cleanup runs after React has already swapped the DOM, so reading the
 * scroller then measures the screen that just arrived, not the one leaving.
 *
 * The listener sits on the shell in capture phase: scroll events do not bubble
 * but they do capture, so one listener catches whichever descendant actually
 * scrolls, whether that is a screen's own region or the shell itself. It also
 * survives the scroller appearing late, which it does on every screen that
 * waits on the pack to load.
 */
import { useEffect, useRef } from 'react'
import { useLocation, useNavigationType } from 'react-router-dom'

/** Positions by location key. Session-scoped, like the history entries. */
const positions = new Map<string, number>()

/** Frames to keep re-applying a restore while the list paints in. */
const RESTORE_FRAMES = 12

export function useScrollRestoration(containerRef: React.RefObject<HTMLElement | null>): void {
  const location = useLocation()
  const navigationType = useNavigationType()
  const keyRef = useRef(location.key)
  keyRef.current = location.key

  // Record continuously, against whatever the current history entry is.
  useEffect(() => {
    const main = containerRef.current
    if (!main) return
    const onScroll = (e: Event) => {
      const el = e.target as HTMLElement
      if (el && typeof el.scrollTop === 'number') positions.set(keyRef.current, el.scrollTop)
    }
    main.addEventListener('scroll', onScroll, { passive: true, capture: true })
    return () => main.removeEventListener('scroll', onScroll, { capture: true } as EventListenerOptions)
  }, [containerRef])

  useEffect(() => {
    const main = containerRef.current
    if (!main) return

    const target = navigationType === 'POP' ? (positions.get(location.key) ?? 0) : 0
    const scroller = (): HTMLElement | null =>
      main.querySelector<HTMLElement>('.scroll-y') ?? main

    if (target === 0) {
      const el = scroller()
      if (el) el.scrollTop = 0
      return
    }

    /*
     * The list paints over several frames after this effect, and a scrollTop
     * set against a container that is still short is silently clamped. Keep
     * re-applying until it takes or the budget runs out.
     */
    let frame = 0
    let raf = 0
    const apply = () => {
      const el = scroller()
      if (el) {
        el.scrollTop = target
        if (Math.abs(el.scrollTop - target) < 1) return
      }
      if (++frame < RESTORE_FRAMES) raf = requestAnimationFrame(apply)
    }
    raf = requestAnimationFrame(apply)
    return () => cancelAnimationFrame(raf)
  }, [containerRef, location.key, navigationType])
}
