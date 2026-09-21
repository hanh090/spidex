/**
 * `useState` that survives the screen being unmounted.
 *
 * The router swaps one element for another, so opening a species from Explore
 * destroys Explore — and with it the filters, the search text and the scroll
 * position. In a guide that is the wrong behaviour twice over: narrowing 1,429
 * butterflies down to twelve candidates is the expensive part of the task, and
 * checking one of those twelve is exactly when you want the other eleven still
 * there when you come back.
 *
 * State lives in a module-level store, so it outlives the component but not
 * the session: a fresh launch starts clean, which is what a new outing wants.
 *
 * Key state that depends on the mounted pack BY pack, e.g. `explore:bird-vn`.
 * A selection refers to trait keys from one pack's schema and is meaningless
 * against another's, so a pack switch must not inherit it.
 */
import { useCallback, useState } from 'react'

const store = new Map<string, unknown>()

const read = <T,>(key: string, initial: T): T => (store.has(key) ? (store.get(key) as T) : initial)

export function useScreenState<T>(key: string, initial: T) {
  const [state, setState] = useState<{ key: string; value: T }>(() => ({ key, value: read(key, initial) }))

  /*
   * The key is not stable across a screen's first renders: it carries the
   * mounted pack id, and the pack loads asynchronously, so the first render
   * asks for `explore:none` and the next for `explore:bird-vn`. useState only
   * runs its initialiser once, so without this the hook would answer for the
   * first key forever and every restore would come back empty.
   *
   * Adjusting during render rather than in an effect is deliberate: an effect
   * would paint one frame of the previous scope's filters before correcting.
   */
  let current = state
  if (state.key !== key) {
    current = { key, value: read(key, initial) }
    setState(current)
  }

  const set = useCallback((next: T | ((prev: T) => T)) => {
    setState((prev) => {
      const resolved = typeof next === 'function' ? (next as (p: T) => T)(prev.value) : next
      store.set(key, resolved)
      return { key, value: resolved }
    })
  }, [key])

  return [current.value, set] as const
}

/** Drop everything remembered for a screen. Used when the scope changes. */
export function clearScreenState(prefix: string): void {
  for (const key of [...store.keys()]) {
    if (key.startsWith(prefix)) store.delete(key)
  }
}
