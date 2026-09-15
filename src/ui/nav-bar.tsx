/**
 * The top bar of a pushed screen.
 *
 * Five screens each carried their own copy of this bar and their own copy of
 * the "go back, or go home if there is nothing to go back to" rule. It is one
 * component now, and it installs the swipe-back gesture, so a screen cannot
 * ship the bar without the gesture or the gesture without the bar.
 */
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { IconChevron } from './icons'
import { useGoBack, useSwipeBack } from '../app/use-swipe-back'

interface Props {
  /** Centred, truncated to one line. Omit for a bar that is only a way back. */
  title?: ReactNode
  /** Trailing control — favourite, save, overflow. */
  action?: ReactNode
  /** Set when the screen handles its own dismissal (an unsaved-changes guard). */
  onBack?: () => void
  /** Where to land when this screen was opened cold, with no history to pop. */
  fallback?: string
}

export function NavBar({ title, action, onBack, fallback }: Props) {
  const { t } = useTranslation()
  const goBack = useGoBack(fallback)
  const back = onBack ?? goBack

  useSwipeBack(back)

  return (
    <nav
      aria-label={t('nav.back')}
      style={{
        position: 'sticky', top: 0, zIndex: 10, flex: 'none', width: '100%',
        display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
        padding: 'max(var(--space-2), env(safe-area-inset-top)) var(--gutter-sm) var(--space-2)',
        background: 'var(--panel)', borderBottom: 'var(--hair) solid var(--line)',
      }}
    >
      <button
        onClick={back}
        aria-label={t('nav.back')}
        style={{
          minWidth: 'var(--tap-min)', minHeight: 'var(--tap-min)', flex: 'none',
          display: 'flex', alignItems: 'center', gap: 2, marginLeft: -6,
          color: 'var(--ink)', background: 'none',
        }}
      >
        <span style={{ transform: 'rotate(180deg)', display: 'flex' }}><IconChevron size={22} /></span>
        <span className="t-meta">{t('nav.back')}</span>
      </button>

      <div style={{ flex: 1, minWidth: 0, textAlign: 'center' }}>
        {title && (
          <div className="t-name" style={{
            fontSize: 15, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {title}
          </div>
        )}
      </div>

      {/* Balances the back control so the title stays optically centred. */}
      <div style={{ minWidth: 'var(--tap-min)', flex: 'none', display: 'flex', justifyContent: 'flex-end' }}>
        {action}
      </div>
    </nav>
  )
}
