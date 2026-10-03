/**
 * Trips list — the way into S09. Newest first, with the active trip flagged.
 */
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { listTripSummaries, type TripSummary } from '../features/log/trip-repo'
import { Badge, EmptyState, Meta } from '../ui/primitives'
import { NavBar } from '../ui/nav-bar'
import { IconChevron } from '../ui/icons'
import { formatDate } from '../i18n/format'

function tripRange(startedAt: number, endedAt?: number): string {
  const a = formatDate(startedAt)
  if (!endedAt) return a
  const b = formatDate(endedAt)
  return a === b ? a : `${a} – ${b}`
}

export function Trips() {
  const { t } = useTranslation()
  const [rows, setRows] = useState<TripSummary[] | null>(null)

  useEffect(() => {
    let cancelled = false
    void listTripSummaries().then((r) => { if (!cancelled) setRows(r) })
    return () => { cancelled = true }
  }, [])

  if (!rows) return null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100%', width: '100%' }}>
      <NavBar title={t('fieldLog.trips')} fallback="/sightings" />
      {rows.length === 0
        ? <EmptyState title={t('fieldLog.tripsEmpty')} fix={t('fieldLog.tripsEmptyFix')} />
        : (
          <div className="column" style={{ padding: 'var(--space-2) var(--gutter-sm) var(--space-6)' }}>
            {rows.map(({ trip, records, species }) => (
              <Link key={trip.id} to={`/trips/${trip.id}`} style={{
                display: 'flex', alignItems: 'center', gap: 'var(--space-3)',
                minHeight: 'var(--tap-min)', padding: 'var(--space-3) 0',
                borderBottom: 'var(--hair) solid var(--line)', color: 'var(--ink)',
              }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="t-name" style={{ overflowWrap: 'anywhere' }}>{trip.name || t('fieldLog.tripUntitled')}</div>
                  {trip.locationLabel && <div className="t-sci" style={{ overflowWrap: 'anywhere' }}>{trip.locationLabel}</div>}
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)', alignItems: 'center', marginTop: 4 }}>
                    <Meta>{tripRange(trip.startedAt, trip.endedAt)}</Meta>
                    {!trip.endedAt && <Badge tone="ok">{t('fieldLog.tripActive')}</Badge>}
                  </div>
                  <Meta>{t('fieldLog.tripSpecies', { count: species })} · {t('sightings.records', { count: records })}</Meta>
                </div>
                <IconChevron />
              </Link>
            ))}
          </div>
        )}
    </div>
  )
}
