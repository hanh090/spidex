/**
 * S15 Credits — balance and history. Credits are recorded but not charged yet;
 * the screen says so plainly. The last known balance is cached for offline.
 */
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../features/auth/auth-context'
import { cachedBalance, fetchCredits, type CreditEntry, type CreditsPage } from '../features/sync/credits-api'
import { Button, EmptyState, Meta } from '../ui/primitives'
import { NavBar } from '../ui/nav-bar'
import { SignInModal } from './sign-in-modal'
import { formatDate, formatNumber, formatTime } from '../i18n/format'

/** Signed, locale-formatted: "+10,000" / "-5". */
const signed = (n: number) => (n > 0 ? '+' : '') + formatNumber(n)

export function Credits() {
  const { t } = useTranslation()
  const { user } = useAuth()
  const userId = user?.id
  const [balance, setBalance] = useState<number | null>(null)
  const [stale, setStale] = useState(false)
  const [enforced, setEnforced] = useState(false)
  const [history, setHistory] = useState<CreditEntry[]>([])
  const [next, setNext] = useState<CreditsPage['next']>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [signInOpen, setSignInOpen] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const page = await fetchCredits()
      setBalance(page.balance); setEnforced(page.enforced); setHistory(page.history); setNext(page.next); setStale(false)
    } catch {
      // Offline or server down: fall back to the last balance this device saw.
      const cached = await cachedBalance()
      setBalance(cached ? cached.balance : null)
      setStale(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { if (userId) void load() }, [userId, load])

  const more = async () => {
    if (!next) return
    setLoadingMore(true)
    try {
      const page = await fetchCredits(next)
      setHistory((h) => [...h, ...page.history]); setNext(page.next)
    } catch { /* keep what is shown; the button stays for another try */ } finally {
      setLoadingMore(false)
    }
  }

  const body = !userId ? (
    <EmptyState
      title={t('credits.signInTitle')}
      fix={t('credits.signInFix')}
      action={<Button variant="primary" onClick={() => setSignInOpen(true)}>{t('account.signIn', 'Sign in')}</Button>}
    />
  ) : (
    <div className="scroll-y column" style={{ flex: 1, padding: 'var(--space-4) var(--gutter-sm) var(--space-8)', display: 'grid', gap: 'var(--space-4)', alignContent: 'start' }}>
      <h1 className="t-title" style={{ margin: 0 }}>{t('credits.title')}</h1>

      <div role="note" className="t-body" style={{
        border: 'var(--hair) solid var(--line)', borderRadius: 'var(--radius-tap)',
        padding: 'var(--space-3)', background: 'var(--panel)', textWrap: 'pretty',
      }}>
        {enforced ? t('credits.enforced') : t('credits.notCharged')}
      </div>

      <section style={{ display: 'grid', gap: 'var(--space-1)' }}>
        <Meta>{t('credits.balance')}</Meta>
        <div className="t-title" aria-live="polite">
          {balance === null ? (loading ? t('credits.loading') : t('credits.unavailable')) : formatNumber(balance)}
        </div>
        {stale && balance !== null && <Meta tone="warn">{t('credits.offlineCached')}</Meta>}
      </section>

      <section style={{ display: 'grid', gap: 'var(--space-2)' }}>
        <h2 className="t-heading" style={{ margin: 0 }}>{t('credits.history')}</h2>
        {history.length === 0 && !loading && (
          <p className="t-body" style={{ color: 'var(--ink-muted)', margin: 0 }}>
            {stale ? t('credits.historyOffline') : t('credits.noHistory')}
          </p>
        )}
        {history.map((h) => (
          <div key={h.id} style={{
            display: 'flex', alignItems: 'center', gap: 'var(--space-3)', minHeight: 'var(--tap-min)',
            borderBottom: 'var(--hair) solid var(--line)',
          }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="t-body">{t(`credits.reason.${h.reason}`, h.reason)}</div>
              <Meta>{formatDate(h.createdAt)} {formatTime(h.createdAt)}</Meta>
            </div>
            <span className="t-body" style={{ fontVariantNumeric: 'tabular-nums' }}>{signed(h.delta)}</span>
          </div>
        ))}
        {next && (
          <div><Button variant="secondary" onClick={() => void more()} disabled={loadingMore}>{t('credits.more')}</Button></div>
        )}
      </section>
    </div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%' }}>
      <NavBar title={t('credits.title')} />
      {body}
      <SignInModal open={signInOpen} onClose={() => setSignInOpen(false)} />
    </div>
  )
}
