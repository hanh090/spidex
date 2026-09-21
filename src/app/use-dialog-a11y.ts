/**
 * Makes an always-mounted overlay behave like a dialog.
 *
 * The drawer and the sheet stay in the DOM so they can animate, which left
 * eleven focusable controls sitting in the tab order of every screen and an
 * `aria-modal="true"` permanently telling assistive tech that the rest of the
 * page was inert. A keyboard user tabbed through the whole settings panel
 * without seeing it.
 *
 * Three things have to be true, and none of them is the transform:
 *   - closed: removed from the tab order and from the accessibility tree
 *   - open: focus moves in, and Tab cycles inside rather than escaping behind
 *   - closed again: focus returns to whatever opened it
 *
 * `inert` does the first job in one attribute and is set imperatively because
 * React 18 does not forward it. `visibility: hidden` is not used instead: it
 * would cancel the slide-out transition.
 */
import { useEffect, type RefObject } from 'react'

const FOCUSABLE = [
  'a[href]', 'button:not([disabled])', 'input:not([disabled])',
  'select:not([disabled])', 'textarea:not([disabled])', '[tabindex]:not([tabindex="-1"])',
].join(',')

export function useDialogA11y(ref: RefObject<HTMLElement | null>, open: boolean, onClose: () => void): void {
  // Closed panels are inert: not focusable, not in the accessibility tree.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (open) {
      el.removeAttribute('inert')
      el.setAttribute('aria-modal', 'true')
    } else {
      el.setAttribute('inert', '')
      // aria-modal on a closed dialog claims the page behind it is unavailable.
      el.removeAttribute('aria-modal')
    }
  }, [ref, open])

  useEffect(() => {
    if (!open) return
    const el = ref.current
    if (!el) return

    const previouslyFocused = document.activeElement as HTMLElement | null

    // Focus the first real control, falling back to the panel itself.
    const first = el.querySelector<HTMLElement>(FOCUSABLE)
    ;(first ?? el).focus({ preventScroll: true })

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return }
      if (e.key !== 'Tab') return

      const items = Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE))
        .filter((n) => n.offsetParent !== null || n === document.activeElement)
      if (items.length === 0) return

      const firstItem = items[0]!
      const lastItem = items[items.length - 1]!
      // Wrap at both ends so Tab cannot walk out into the screen behind.
      if (e.shiftKey && document.activeElement === firstItem) {
        e.preventDefault(); lastItem.focus()
      } else if (!e.shiftKey && document.activeElement === lastItem) {
        e.preventDefault(); firstItem.focus()
      }
    }

    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      // Returning focus is what makes the control feel like it opened a thing
      // rather than teleporting the user to the top of the document.
      previouslyFocused?.focus?.({ preventScroll: true })
    }
  }, [ref, open, onClose])
}
