/**
 * Component primitives, per section 06 of the design system.
 * Rules not shadows, zero radius, one accent action per screen.
 */
import type { ReactNode, ButtonHTMLAttributes } from 'react'
import { IconCheck } from './icons'

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'inline'
  full?: boolean
  children: ReactNode
}

export function Button({ variant = 'secondary', full, children, style, ...rest }: ButtonProps) {
  const shared: React.CSSProperties = {
    font: 'var(--type-action)',
    minHeight: variant === 'inline' ? 'var(--tap-min)' : 'var(--tap-primary)',
    padding: variant === 'inline' ? '0 var(--space-2)' : '0 var(--space-4)',
    width: full ? '100%' : undefined,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 'var(--space-2)',
    borderRadius: 'var(--radius)',
    transition: `background var(--move-push) var(--ease), color var(--move-push) var(--ease)`,
  }
  const skin: Record<string, React.CSSProperties> = {
    primary: { background: 'var(--accent)', color: 'var(--paper)' },
    secondary: { background: 'transparent', color: 'var(--ink)', border: 'var(--hair) solid var(--ink)' },
    inline: { background: 'transparent', color: 'var(--accent)' },
  }
  return <button style={{ ...shared, ...skin[variant], ...style }} {...rest}>{children}</button>
}

/** Uppercase mono metadata. Never nowrap — translated strings must wrap. */
export function Meta({ children, tone = 'muted' }: { children: ReactNode; tone?: 'muted' | 'warn' | 'ok' | 'accent' }) {
  const colour = { muted: 'var(--ink-muted)', warn: 'var(--warn)', ok: 'var(--ok)', accent: 'var(--accent)' }[tone]
  return <span className="t-meta" style={{ color: colour }}>{children}</span>
}

export function Badge({ children, tone = 'muted' }: { children: ReactNode; tone?: 'muted' | 'warn' | 'ok' | 'accent' }) {
  const c = { muted: 'var(--ink-muted)', warn: 'var(--warn)', ok: 'var(--ok)', accent: 'var(--accent)' }[tone]
  return (
    <span className="t-meta" style={{ color: c, border: `var(--hair) solid ${c}`, padding: '3px 6px', borderRadius: 'var(--radius)' }}>
      {children}
    </span>
  )
}

/** Empty states name the fix — never a bare "nothing here". */
export function EmptyState({ title, fix, action }: { title: string; fix: string; action?: ReactNode }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      gap: 'var(--space-3)', padding: 'var(--space-8) var(--gutter-sm)', textAlign: 'center', height: '100%',
    }}>
      <div className="t-heading">{title}</div>
      <p className="t-body" style={{ color: 'var(--ink-muted)', margin: 0, maxWidth: '34ch', textWrap: 'pretty' }}>{fix}</p>
      {action}
    </div>
  )
}

export function Skeleton({ height = 16, width = '100%' }: { height?: number; width?: number | string }) {
  return <div aria-hidden style={{ height, width, background: 'var(--panel)' }} />
}

/** A row in the drawer or a settings list. */
export function Row({ label, value, onClick, selected }: {
  label: ReactNode; value?: ReactNode; onClick?: () => void; selected?: boolean
}) {
  const inner = (
    <>
      <span className="t-body" style={{ flex: 1, minWidth: 0 }}>{label}</span>
      {value != null && <span className="t-meta" style={{ color: 'var(--ink-muted)', textAlign: 'right' }}>{value}</span>}
      {selected && <span style={{ color: 'var(--accent)', display: 'flex' }}><IconCheck size={17} /></span>}
    </>
  )
  const style: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 'var(--space-3)', width: '100%',
    minHeight: 'var(--tap-min)', padding: '0 var(--gutter-sm)', textAlign: 'left',
    background: selected ? 'var(--panel)' : 'transparent',
  }
  return onClick
    ? <button style={style} onClick={onClick} aria-pressed={selected}>{inner}</button>
    : <div style={style}>{inner}</div>
}
