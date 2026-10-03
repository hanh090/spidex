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
import type { Density } from '../lib/density'
import { fetchAdminStatus } from '../features/admin/admin-api'
import { formatBytes } from '../i18n/format'
import { Meta, Row } from '../ui/primitives'
import { IconClose } from '../ui/icons'
import { useDialogA11y } from './use-dialog-a11y'
import type { ReactNode } from 'react'
import type { PersistState, StorageEstimate } from '../lib/storage'
import { useActivePackName } from '../features/guide/use-active-pack-name'
import { useAuth } from '../features/auth/auth-context'
import { SignInModal } from '../screens/sign-in-modal'

interface Props {
  open: boolean
  onClose: () => void
  themeSetting: ThemeSetting
  onTheme: (t: ThemeSetting) => void
  density: Density
  onDensity: (d: Density) => void
  persist: PersistState | null
  usage: StorageEstimate | null
}

export function Drawer({ open, onClose, themeSetting, onTheme, density, onDensity, persist, usage }: Props) {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const { name: packName } = useActivePackName()
  const { user, isGuest, signOut } = useAuth()
  const [signInOpen, setSignInOpen] = useState(false)
  const [isAdmin, setIsAdmin] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)

  /*
   * The admin row appears only for allowlisted staff. This is presentation,
   * not the boundary — /api/admin/* re-verifies on every call regardless of
   * what the drawer chose to render.
   */
  useEffect(() => {
    if (!user) { setIsAdmin(false); return }
    let cancelled = false
    void fetchAdminStatus().then((s) => { if (!cancelled) setIsAdmin(s.isAdmin) })
    return () => { cancelled = true }
  }, [user])

  /*
   * Escape, focus trap, focus restore, and inert-when-closed. The panel stays
   * mounted so it can slide, which previously left every control inside it in
   * the tab order of every screen.
   */
  useDialogA11y(panelRef, open, onClose)

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
        /* aria-modal is set only while open — see useDialogA11y. */
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
            <img
              src="/icons/icon.svg"
              alt=""
              width={44}
              height={44}
              style={{ display: 'block', flex: 'none', borderRadius: 'var(--radius-tap)' }}
            />
            <div style={{ minWidth: 0 }}>
              <div className="t-title" style={{ fontSize: 22 }}>{t('app.name')}</div>
              <Meta>{t('app.tagline')}</Meta>
            </div>
          </div>
          <button onClick={onClose} aria-label={t('nav.close')}
            style={{ minWidth: 'var(--tap-min)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ink)' }}>
            <IconClose />
          </button>
        </div>

        <div
          className="scroll-y"
          style={{
            flex: 1,
            paddingTop: 'var(--space-5)',
            paddingBottom: 'max(var(--space-6), calc(var(--space-3) + env(safe-area-inset-bottom)))',
          }}
        >
          <Section label={t('scope.label')}>
            <Row label={packName ?? t('scope.none')} />
            <Row label={t('scope.manage')} onClick={() => { onClose(); navigate('/library') }} />
          </Section>

          <Section label={t('drawer.account', 'Account')}>
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
            {isAdmin && (
              <Row label={t('drawer.admin', 'Admin console')} onClick={() => { onClose(); navigate('/admin') }} />
            )}
          </Section>

          <Section label={t('drawer.language')}>
            {LANGUAGES.map((l) => (
              <Row
                key={l.code}
                label={l.name}
                selected={i18n.language === l.code}
                onClick={() => setLanguage(l.code as LanguageCode)}
              />
            ))}
          </Section>

          <Section label={t('drawer.theme')}>
            {THEMES.map((th) => (
              <Row
                key={th.id}
                label={
                  <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                    <ThemeSwatch colours={th.swatch} />
                    <span style={{ minWidth: 0 }}>
                      <span style={{ display: 'block' }}>{t(th.labelKey)}</span>
                      {(th.id === 'sun' || th.id === 'dawn') && (
                        <span className="t-meta" style={{ color: 'var(--ink-muted)' }}>
                          {t(th.id === 'sun' ? 'theme.sunHint' : 'theme.dawnHint')}
                        </span>
                      )}
                    </span>
                  </span>
                }
                selected={themeSetting === th.id}
                onClick={() => onTheme(th.id)}
              />
            ))}
          </Section>

          <Section label={t('fieldLog.section')}>
            <Row label={t('fieldLog.trips')} onClick={() => { onClose(); navigate('/trips') }} />
            <Row label={t('fieldLog.lifeList')} onClick={() => { onClose(); navigate('/life-list') }} />
            <Row label={t('fieldLog.favourites')} onClick={() => { onClose(); navigate('/favourites') }} />
          </Section>

          <Section label={t('drawer.field', 'Field use')}>
            <Row
              label={
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: 'block' }}>{t('field.targets', 'Larger touch targets')}</span>
                  <span className="t-meta" style={{ color: 'var(--ink-muted)' }}>
                    {t('field.targetsHint', 'For gloved or one-handed use')}
                  </span>
                </span>
              }
              selected={density === 'field'}
              onClick={() => onDensity(density === 'field' ? 'standard' : 'field')}
            />
          </Section>

          <Section label={t('drawer.storage')}>
            {usage && (
              <StorageMeter
                usage={usage}
                label={t('storage.used', { used: formatBytes(usage.usage), quota: formatBytes(usage.quota) })}
              />
            )}
            <Row label={storageLabel} />
          </Section>
        </div>
      </div>
      <SignInModal open={signInOpen} onClose={() => setSignInOpen(false)} />
    </>
  )
}

/**
 * A settings group. An h2 rather than a styled div, so the drawer can be
 * navigated by heading instead of tabbed through end to end.
 */
function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section style={{ padding: '0 var(--gutter-sm)', marginBottom: 'var(--space-6)' }}>
      <h2 style={{
        font: 'var(--type-label)', fontWeight: 600, color: 'var(--ink-muted)',
        margin: '0 0 var(--space-2)',
      }}>
        {label}
      </h2>
      {/* Bounded so a group reads as one object rather than as loose rows. */}
      <div style={{
        border: 'var(--hair) solid var(--line)', borderRadius: 'var(--radius-tap)',
        overflow: 'hidden', background: 'var(--paper)',
      }}>
        {children}
      </div>
    </section>
  )
}

/** Ground, ink and accent from the theme itself — what you are choosing. */
function ThemeSwatch({ colours }: { colours: [string, string, string] | null }) {
  if (!colours) return <span aria-hidden style={{ width: 34, flex: 'none' }} />
  const [ground, ink, accent] = colours
  return (
    <span
      aria-hidden
      style={{
        width: 34, height: 22, flex: 'none', borderRadius: 4,
        border: 'var(--hair) solid var(--line)', background: ground,
        display: 'grid', gridTemplateColumns: '1fr 1fr', alignItems: 'center',
        justifyItems: 'center', overflow: 'hidden',
      }}
    >
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: ink }} />
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: accent }} />
    </span>
  )
}

/**
 * Storage as a bar, not a sentence. "1.2 GB of 8 GB" is a number the user has
 * to convert into a feeling about whether the next pack fits; the bar is the
 * feeling.
 */
function StorageMeter({ usage, label }: { usage: StorageEstimate; label: string }) {
  const pct = usage.quota > 0 ? Math.min(100, Math.round((usage.usage / usage.quota) * 100)) : 0
  return (
    <div style={{ padding: 'var(--space-2) var(--gutter-sm) var(--space-4)' }}>
      <div
        role="img"
        aria-label={label}
        style={{ height: 6, background: 'var(--line)', borderRadius: 3, overflow: 'hidden' }}
      >
        <div style={{ width: `${pct}%`, height: '100%', background: 'var(--accent)' }} />
      </div>
      <div className="t-meta" style={{ color: 'var(--ink-muted)', marginTop: 'var(--space-2)' }}>
        {label}
      </div>
    </div>
  )
}
