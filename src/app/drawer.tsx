/**
 * The drawer holds settings only — never a destination that could be a tab.
 * Per the design system: the full lockup, pack scope, pack library, language,
 * theme. Nothing that a user would navigate to as a task.
 */
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { LANGUAGES, setLanguage, type LanguageCode } from '../i18n'
import { THEMES, type ThemeSetting } from '../lib/theme'
import { formatBytes } from '../i18n/format'
import { Meta, Row } from '../ui/primitives'
import { IconClose } from '../ui/icons'
import type { PersistState, StorageEstimate } from '../lib/storage'
import { useActivePackName } from '../features/guide/use-active-pack-name'
import { useAuth } from '../features/auth/auth-context'
import { SignInModal } from '../screens/sign-in-modal'

interface Props {
  open: boolean
  onClose: () => void
  themeSetting: ThemeSetting
  onTheme: (t: ThemeSetting) => void
  persist: PersistState | null
  usage: StorageEstimate | null
}

export function Drawer({ open, onClose, themeSetting, onTheme, persist, usage }: Props) {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const { name: packName } = useActivePackName()
  const { user, isGuest, signOut } = useAuth()
  const [signInOpen, setSignInOpen] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)

  // Escape closes; focus moves into the panel so the drawer is keyboard-usable.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    panelRef.current?.focus()
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const storageLabel =
    persist === 'granted' ? t('storage.persisted')
    : persist === 'denied' ? t('storage.notPersisted')
    : t('storage.unsupported')

  return (
    <>
      <div
        onClick={onClose}
        aria-hidden
        style={{
          position: 'fixed', inset: 0, background: 'var(--scrim)',
          opacity: open ? 1 : 0, pointerEvents: open ? 'auto' : 'none',
          transition: `opacity var(--move-sheet) var(--ease)`, zIndex: 20,
        }}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={t('drawer.settings')}
        tabIndex={-1}
        style={{
          position: 'fixed', inset: '0 auto 0 0', width: 'min(86vw, 340px)', zIndex: 21,
          background: 'var(--panel)', borderRight: 'var(--hair) solid var(--ink)',
          transform: open ? 'translateX(0)' : 'translateX(-100%)',
          transition: `transform var(--move-sheet) var(--ease)`,
          display: 'flex', flexDirection: 'column', outline: 'none',
        }}
      >
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: 'var(--space-3)',
          padding: 'max(var(--space-4), calc(var(--space-2) + env(safe-area-inset-top))) var(--gutter-sm) var(--space-4)',
          borderBottom: 'var(--hair) solid var(--line)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', minWidth: 0 }}>
            <img src="/icons/icon.svg" alt="" width={40} height={40} style={{ display: 'block', flex: 'none' }} />
            <div style={{ minWidth: 0 }}>
              <div className="t-heading">{t('app.name')}</div>
              <Meta>{t('app.tagline')}</Meta>
            </div>
          </div>
          <button onClick={onClose} aria-label={t('nav.close')}
            style={{ minWidth: 'var(--tap-min)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ink)' }}>
            <IconClose />
          </button>
        </div>

        <div className="scroll-y" style={{ flex: 1, paddingBottom: 'max(var(--space-6), calc(var(--space-3) + env(safe-area-inset-bottom)))' }}>
          <Section label={t('scope.label')} />
          <Row label={packName ?? t('scope.none')} />
          <Row label={t('scope.manage')} onClick={() => { onClose(); navigate('/library') }} />

          <Section label={t('drawer.account', 'Account')} />
          {isGuest ? (
            <Row
              label={t('account.guest', 'Guest (Offline)')}
              value={t('account.signIn', 'Sign in')}
              onClick={() => setSignInOpen(true)}
            />
          ) : (
            <Row
              label={user?.email || 'Logged In'}
              value={t('account.signOut', 'Sign out')}
              onClick={() => void signOut()}
            />
          )}

          <Section label={t('drawer.language')} />
          {LANGUAGES.map((l) => (
            <Row
              key={l.code}
              label={l.name}
              selected={i18n.language === l.code}
              onClick={() => setLanguage(l.code as LanguageCode)}
            />
          ))}

          <Section label={t('drawer.theme')} />
          {THEMES.map((th) => (
            <Row
              key={th.id}
              label={t(th.labelKey)}
              value={th.id === 'sun' ? t('theme.sunHint') : th.id === 'dawn' ? t('theme.dawnHint') : undefined}
              selected={themeSetting === th.id}
              onClick={() => onTheme(th.id)}
            />
          ))}

          <Section label={t('drawer.storage')} />
          <Row label={storageLabel} />
          {usage && (
            <Row label={t('storage.used', { used: formatBytes(usage.usage), quota: formatBytes(usage.quota) })} />
          )}
        </div>
      </div>
      <SignInModal open={signInOpen} onClose={() => setSignInOpen(false)} />
    </>
  )
}

function Section({ label }: { label: string }) {
  return (
    <div style={{
      padding: 'var(--space-6) var(--gutter-sm) var(--space-2)',
      borderBottom: 'var(--hair) solid var(--line)', marginBottom: 'var(--space-1)',
    }}>
      <Meta>{label}</Meta>
    </div>
  )
}
