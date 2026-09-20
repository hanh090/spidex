/**
 * Full-screen plate viewer.
 *
 * Plates are the product — a grid thumbnail answers "is this it?", the viewer
 * answers "is this EXACTLY it?", which is a zoom question. Pinch to zoom,
 * double-tap to toggle, drag to pan, Esc or the ✕ to leave. Pointer events,
 * not touch events, so a mouse on desktop behaves the same way.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { IconClose } from './icons'

interface Props {
  src: string
  alt: string
  /** Credit line, rendered under the plate — attribution survives fullscreen. */
  caption?: string
  onClose: () => void
}

const MIN = 1
const MAX = 5

export function PlateViewer({ src, alt, caption, onClose }: Props) {
  const { t } = useTranslation()
  const [scale, setScale] = useState(1)
  const [pos, setPos] = useState({ x: 0, y: 0 })
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const pinch = useRef<{ dist: number; scale: number; cx: number; cy: number } | null>(null)
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null)
  const lastTap = useRef(0)
  const frame = useRef<HTMLDivElement>(null)

  const clamp = (s: number) => Math.min(MAX, Math.max(MIN, s))
  const reset = useCallback(() => { setScale(1); setPos({ x: 0, y: 0 }) }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    // The viewer owns the gesture space: no scrolling behind it.
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [onClose])

  const zoomAt = (next: number, cx: number, cy: number) => {
    const rect = frame.current?.getBoundingClientRect()
    const ox = rect ? cx - rect.left - rect.width / 2 : 0
    const oy = rect ? cy - rect.top - rect.height / 2 : 0
    setScale((prev) => {
      const s = clamp(next)
      const ratio = s / prev
      setPos((p) => s === 1 ? { x: 0, y: 0 } : { x: p.x - ox * (ratio - 1), y: p.y - oy * (ratio - 1) })
      return s
    })
  }

  const onPointerDown = (e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })

    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()] as [{ x: number; y: number }, { x: number; y: number }]
      pinch.current = {
        dist: Math.hypot(a.x - b.x, a.y - b.y),
        scale,
        cx: (a.x + b.x) / 2,
        cy: (a.y + b.y) / 2,
      }
      drag.current = null
      return
    }

    // Double-tap toggles between fit and a working zoom at the tap point.
    const now = Date.now()
    if (now - lastTap.current < 300 && pointers.current.size === 1) {
      zoomAt(scale > 1.2 ? 1 : 2.5, e.clientX, e.clientY)
      lastTap.current = 0
      return
    }
    lastTap.current = now
    drag.current = { x: pos.x, y: pos.y, px: e.clientX, py: e.clientY }
  }

  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })

    if (pinch.current && pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()] as [{ x: number; y: number }, { x: number; y: number }]
      const dist = Math.hypot(a.x - b.x, a.y - b.y)
      zoomAt(pinch.current.scale * (dist / pinch.current.dist), (a.x + b.x) / 2, (a.y + b.y) / 2)
      return
    }
    if (drag.current && scale > 1) {
      setPos({
        x: drag.current.x + (e.clientX - drag.current.px),
        y: drag.current.y + (e.clientY - drag.current.py),
      })
    }
  }

  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId)
    if (pointers.current.size < 2) pinch.current = null
    if (pointers.current.size === 0) {
      drag.current = null
      if (scale <= 1) reset()
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={alt}
      style={{
        position: 'fixed', inset: 0, zIndex: 50, background: 'var(--scrim)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        ref={frame}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        style={{
          position: 'absolute', inset: 0, touchAction: 'none', overflow: 'hidden',
          display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: scale > 1 ? 'grab' : 'zoom-in',
        }}
      >
        {/* Plates are drawn on white mounts; the mount is part of the object. */}
        <img
          src={src}
          alt={alt}
          draggable={false}
          style={{
            maxWidth: '92vw', maxHeight: '82vh', objectFit: 'contain',
            background: '#fff', border: 'var(--hair) solid var(--line)',
            transform: `translate(${pos.x}px, ${pos.y}px) scale(${scale})`,
            transformOrigin: 'center', userSelect: 'none',
          }}
        />
      </div>

      <button
        onClick={onClose}
        aria-label={t('nav.close')}
        style={{
          position: 'absolute', top: 'max(12px, env(safe-area-inset-top))', right: 12,
          width: 'var(--tap-min)', height: 'var(--tap-min)', borderRadius: 'var(--radius-tap)',
          background: 'var(--panel)', border: 'var(--hair) solid var(--line)', color: 'var(--ink)',
          display: 'grid', placeItems: 'center',
        }}
      >
        <IconClose />
      </button>

      {caption && (
        <div
          className="t-meta"
          style={{
            position: 'absolute', left: 0, right: 0, bottom: 'max(12px, env(safe-area-inset-bottom))',
            textAlign: 'center', color: 'var(--paper)', textShadow: '0 1px 2px rgba(0,0,0,0.5)',
            padding: '0 var(--gutter-sm)', pointerEvents: 'none',
          }}
        >
          {caption}
        </div>
      )}
    </div>
  )
}
