/**
 * S14 Sync status — last sync, counts per state, conflicts to resolve, and a
 * manual "Sync now". Sync runs only while the app is open; this screen says so.
 */
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../features/auth/auth-context'
import {
  getLastError, getLastSyncAt, getSyncCounts, isSyncing, onSyncChange, syncNow,
  type BadgeState, type SyncCounts, type SyncReport,
} from '../features/sync/engine'
import { keepMine, keepServer, listConflicts, type ConflictView } from '../features/sync/conflict'
import { Badge, Button, EmptyState, Meta } from '../ui/primitives'
import { NavBar } from '../ui/nav-bar'
import { SignInModal } from './sign-in-modal'
import { formatDate, formatNumber, formatTime } from '../i18n/format'

const STATES: BadgeState[] = ['queued', 'synced', 'conflict', 'failed']

function summary(p: Record<string, unknown> | null | undefined, fallbackNeedsId: string): string {
  if (!p) return ''
  const snap = p.speciesSnapshot as { commonName?: string } | undefined
  const bits = [snap?.commonName ?? fallbackNeedsId, `×${formatNumber(Number(p.count ?? 1))}`]
  if (typeof p.notes === 'string' && p.notes) bits.push(p.notes.slice(0, 80))
  return bits.join(' · ')
}

export function SyncStatus() {
  const { t } = useTranslation()
  const { user } = useAuth()
  const userId = user?.id
  const [counts, setCounts] = useState<SyncCounts | null>(null)
  const [conflicts, setConflicts] = useState<ConflictView[]>([])
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(null)
  const [lastError, setLastError] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(isSyncing())
  const [report, setReport] = useState<SyncReport | null>(null)
  const [signInOpen, setSignInOpen] = useState(false)

  const refresh = useCallback(async () => {
    if (!userId) return
    const [c, list, at, err] = await Promise.all([getSyncCounts(userId), listConflicts(userId), getLastSyncAt(), getLastError()])
    setCounts(c); setConflicts(list); setLastSyncAt(at); setLastError(err); setSyncing(isSyncing())
  }, [userId])

  useEffect(() => {
    void refresh()
    return onSyncChange(() => void refresh())
  }, [refresh])

  const sync = async () => {
    if (!userId) return
    setReport(await syncNow(userId))
    await refresh()
  }

  const resolve = async (id: string, side: 'mine' | 'server') => {
    if (!userId) return
    if (side === 'server') await keepServer(userId, id)
    else {
      await keepMine(id)
      void sync()
    }
    await refresh()
  }

  const message =
    report?.authExpired ? t('sync.authExpired')
    : report?.offline ? t('sync.offline')
    : report && !report.ok ? t('sync.failed')
    : report?.needsCredits ? t('sync.needsCredits')
    : lastError ? t('sync.lastFailed')
    : null

  const body = !userId ? (
    <EmptyState
      title={t('sync.signInTitle')}
      fix={t('sync.signInFix')}
      action={<Button variant="primary" onClick={() => setSignInOpen(true)}>{t('account.signIn', 'Sign in')}</Button>}
    />
  ) : (
    <div className="scroll-y column" style={{ flex: 1, padding: 'var(--space-4) var(--gutter-sm) var(--space-8)', display: 'grid', gap: 'var(--space-4)', alignContent: 'start' }}>
      <h1 className="t-title" style={{ margin: 0 }}>{t('sync.title')}</h1>
      <p className="t-body" style={{ color: 'var(--ink-muted)', margin: 0, textWrap: 'pretty' }}>{t('sync.foregroundOnly')}</p>

      <section style={{ display: 'grid', gap: 'var(--space-2)' }}>
        <Meta>{t('sync.lastSync')}</Meta>
        <div className="t-body">
          {lastSyncAt ? `${formatDate(lastSyncAt)} ${formatTime(lastSyncAt)}` : t('sync.never')}
        </div>
        {message && (
          <div role="status" className="t-body" style={{ color: 'var(--warn)' }}>{message}</div>
        )}
        <div>
          <Button variant="primary" onClick={() => void sync()} disabled={syncing}>
            {syncing ? t('sync.syncing') : t('sync.syncNow')}
          </Button>
        </div>
      </section>

      {counts && (
        <section aria-label={t('sync.counts')} style={{ border: 'var(--hair) solid var(--line)', borderRadius: 'var(--radius-card)', background: 'var(--paper)' }}>
          {STATES.map((s) => (
            <div key={s} style={{
              display: 'flex', alignItems: 'center', gap: 'var(--space-3)', minHeight: 'var(--tap-min)',
              padding: '0 var(--space-4)', borderBottom: 'var(--hair) solid var(--line)',
            }}>
              <span className="t-body" style={{ flex: 1 }}>{t(`sync.state.${s}`)}</span>
              <Meta>{t('sync.countSightings', { count: counts.sightings[s], n: formatNumber(counts.sightings[s]) })}</Meta>
              <Meta>{t('sync.countPhotos', { count: counts.photos[s], n: formatNumber(counts.photos[s]) })}</Meta>
            </div>
          ))}
        </section>
      )}

      <section style={{ display: 'grid', gap: 'var(--space-3)' }}>
        <h2 className="t-heading" style={{ margin: 0 }}>{t('sync.conflictsTitle')}</h2>
        {conflicts.length === 0 && <p className="t-body" style={{ color: 'var(--ink-muted)', margin: 0 }}>{t('sync.noConflicts')}</p>}
        {conflicts.length > 0 && <p className="t-body" style={{ margin: 0, textWrap: 'pretty' }}>{t('sync.conflictsLede')}</p>}
        {conflicts.map(({ local, server }) => (
          <article key={local.id} style={{
            border: 'var(--hair) solid var(--warn)', borderRadius: 'var(--radius-card)',
            padding: 'var(--space-4)', background: 'var(--paper)', display: 'grid', gap: 'var(--space-2)',
          }}>
            <div className="t-name">{local.speciesSnapshot?.commonName ?? t('sync.needsId')}</div>
            <Meta>{formatDate(local.at + local.tzOffsetMinutes * 60_000, 'UTC')} {formatTime(local.at)}</Meta>
            <div>
              <Badge tone="accent">{t('sync.mine')}</Badge>
              <div className="t-body">{summary(local as unknown as Record<string, unknown>, t('sync.needsId'))}</div>
            </div>
            <div>
              <Badge tone="warn">{t('sync.server')}</Badge>
              <div className="t-body">
                {server.deletedAt !== null ? t('sync.serverDeleted') : summary(server.payload, t('sync.needsId'))}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
              <Button variant="secondary" onClick={() => void resolve(local.id, 'mine')}>{t('sync.keepMine')}</Button>
              <Button variant="secondary" onClick={() => void resolve(local.id, 'server')}>{t('sync.keepServer')}</Button>
            </div>
          </article>
        ))}
      </section>
    </div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%' }}>
      <NavBar title={t('sync.title')} />
      {body}
      <SignInModal open={signInOpen} onClose={() => setSignInOpen(false)} />
    </div>
  )
}
