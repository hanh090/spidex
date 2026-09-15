/**
 * Bottom sheet.
 *
 * The previous filter sheet had a drag handle that only resized it — there was
 * no gesture that closed it, so the one motion every phone user already knows
 * did nothing. Here the drag both resizes and dismisses: past a threshold, or
 * on a fast downward flick, it closes.
 *
 * Built on Pointer Events rather than a gesture library. The whole app ships
 * no runtime dependencies for interaction, and this is one element.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { IconClose } from './icons'
import { useDialogA11y } from '../app/use-dialog-a11y'

interface Props {
  open: boolean
  onClose: () => void
  title: ReactNode
  /** Rendered at the sheet's top-right, beside the close control. */
  status?: ReactNode
  /** Pinned below the scrolling body — confirm and reset live here. */
  footer?: ReactNode
  children: ReactNode
  minHeight?: number
  maxHeight?: number
  initialHeight?: number
}

/** Drag down past this many px, or flick faster than this, and the sheet closes. */
const DISMISS_PX = 96
const FLICK_VELOCITY = 0.6 // px per ms

export function Sheet({
  open, onClose, title, status, footer, children,
  minHeight = 200, maxHeight = 660, initialHeight = 440,
}: Props) {
  const { t } = useTranslation()
  const [height, setHeight] = useState(initialHeight)
  const [drag, setDrag] = useState(0)
  const [dragging, setDragging] = useState(false)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const gesture = useRef<{ y0: number; h0: number; t0: number } | null>(null)

  // Escape, focus trap and focus restore. The sheet unmounts when closed, so
  // the inert half of this is a no-op here — the trap and restore are not.
  useEffect(() => { if (open) setDrag(0) }, [open])
  useDialogA11y(panelRef, open, onClose)

  if (!open) return null

  const start = (e: React.PointerEvent) => {
    gesture.current = { y0: e.clientY, h0: height, t0: e.timeStamp }
    setDragging(true)
    try {
      ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
    } catch {
      /* Pointer already released, or a synthetic event with no live pointer. */
    }
  }

  const move = (e: React.PointerEvent) => {
    const g = gesture.current
    if (!g) return
    const dy = e.clientY - g.y0
    if (dy > 0 && g.h0 <= minHeight + 1) {
      // Already at its smallest: further downward drag translates the sheet off-screen.
      setDrag(dy)
    } else {
      setDrag(0)
      setHeight(Math.max(minHeight, Math.min(maxHeight, g.h0 - dy)))
    }
  }

  const end = (e: React.PointerEvent) => {
    const g = gesture.current
    gesture.current = null
    setDragging(false)
    if (!g) return
    const dy = e.clientY - g.y0
    const velocity = dy / Math.max(1, e.timeStamp - g.t0)

    /*
     * Dismiss only when the drag was genuinely pushing the sheet away: it had
     * already shrunk to its minimum and kept going, or it was a deliberate
     * downward flick. Dismissing on raw distance instead would swallow every
     * resize — a drag from the sheet's full height down to a shorter one
     * travels well past DISMISS_PX and is not a request to close.
     */
    const wasTranslating = g.h0 <= minHeight + 1
    if ((wasTranslating && dy > DISMISS_PX) || (dy > 0 && velocity > FLICK_VELOCITY)) {
      onClose()
      return
    }
    setDrag(0)
  }

  return (
    <>
      <div
        onClick={onClose}
        aria-hidden
        style={{ position: 'absolute', inset: 0, background: 'var(--scrim)' }}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : undefined}
        tabIndex={-1}
        style={{
          position: 'absolute', left: 0, right: 0, bottom: 0, height,
          transform: `translateY(${drag}px)`,
          /* State, not the ref: a ref mutation does not re-render, so reading
             gesture.current here would paint a stale transition. */
          transition: dragging ? 'none' : `transform var(--move-sheet) var(--ease)`,
          background: 'var(--paper)', borderTop: 'var(--hair) solid var(--ink)',
          borderRadius: 'var(--radius-tap) var(--radius-tap) 0 0',
          display: 'flex', flexDirection: 'column', outline: 'none',
        }}
      >
        {/* The handle is the gesture surface and is itself a large target. */}
        <div
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={end}
          style={{ height: 30, display: 'grid', placeItems: 'center', cursor: 'grab', touchAction: 'none', flex: 'none' }}
        >
          <div style={{ width: 44, height: 5, borderRadius: 3, background: 'var(--ink-muted)' }} />
        </div>

        <div style={{
          flex: 'none', padding: '0 var(--gutter-sm) var(--space-3)',
          display: 'flex', alignItems: 'center', gap: 'var(--space-3)',
          borderBottom: 'var(--hair) solid var(--line)',
        }}>
          <span className="t-heading">{title}</span>
          {status && <span style={{ marginLeft: 'auto' }}>{status}</span>}
          <button
            onClick={onClose}
            aria-label={t('nav.close')}
            style={{
              width: 40, height: 40, minHeight: 40, flex: 'none', marginLeft: status ? 0 : 'auto',
              display: 'grid', placeItems: 'center', borderRadius: 'var(--radius-chip)',
              border: 'var(--hair) solid var(--line)', color: 'var(--ink)',
            }}
          >
            <IconClose size={16} />
          </button>
        </div>

        <div className="scroll-y" style={{ flex: 1, minHeight: 0, padding: 'var(--space-4) var(--gutter-sm)' }}>
          {children}
        </div>

        {footer && (
          <div style={{
            flex: 'none', padding: 'var(--space-3) var(--gutter-sm)',
            paddingBottom: 'max(var(--space-3), env(safe-area-inset-bottom))',
            borderTop: 'var(--hair) solid var(--line)', background: 'var(--panel)',
            display: 'flex', gap: 'var(--space-2)', alignItems: 'center',
          }}>
            {footer}
          </div>
        )}
      </div>
    </>
  )
}
