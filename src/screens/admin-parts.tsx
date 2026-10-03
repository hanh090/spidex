/** Small presentational pieces shared by the admin console panels. */
import type { CSSProperties, ReactNode } from 'react'

export function Alert({ children }: { children: ReactNode }) {
  return (
    <p
      role="alert"
      className="t-body"
      style={{
        background: 'var(--alert)', border: 'var(--hair) solid var(--warn)',
        borderRadius: 'var(--radius-tap)', padding: 'var(--space-3)', margin: '0 0 var(--space-3)',
      }}
    >
      {children}
    </p>
  )
}

export function Chip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className="t-meta"
      style={{
        minHeight: 36, padding: '0 var(--space-3)',
        borderRadius: 'var(--radius-chip)',
        border: `var(--hair) solid ${active ? 'var(--accent)' : 'var(--line)'}`,
        color: active ? 'var(--accent)' : 'var(--ink-muted)',
        background: 'transparent',
      }}
    >
      {label}
    </button>
  )
}

export function fieldStyle(): CSSProperties {
  return {
    minHeight: 'var(--tap-min)', padding: 'var(--space-2) var(--space-3)',
    border: 'var(--hair) solid var(--ink-muted)', borderRadius: 'var(--radius-tap)',
    background: 'var(--paper)', color: 'var(--ink)', font: 'var(--type-body)',
  }
}
