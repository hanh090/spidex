/**
 * S08 Sightings — the Needs-ID queue pinned at the top, then records grouped
 * by their own local day.
 *
 * "Log a sighting" is a pinned action here rather than a fourth tab.
 */
import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import type { Sighting } from '../data/db'
import { groupByDay, listSightings } from '../features/log/sighting-repo'
import { buildLifeList, type LifeListEntry } from '../features/log/life-list'
import { activeTrip, autoAssign, endTrip, startTrip } from '../features/log/trip-repo'
import type { Trip } from '../data/db'
import { download, toCsv, toGeoJson } from '../features/log/export'
import { Button, EmptyState, Meta, Badge } from '../ui/primitives'
import { IconPlus, IconChevron } from '../ui/icons'
import { formatDate, formatTime, formatNumber } from '../i18n/format'

type Tab = 'log' | 'life'

export function Sightings() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [tab, setTab] = useState<Tab>('log')
  const [all, setAll] = useState<Sighting[]>([])
  const [life, setLife] = useState<LifeListEntry[]>([])
  const [trip, setTrip] = useState<Trip | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    const [rows, ll, tr] = await Promise.all([listSightings(), buildLifeList(), activeTrip()])
    setAll(rows)
    setLife(ll)
    setTrip(tr ?? null)
    setLoading(false)
  }, [])

  /**
   * A trip groups a day's records, the way a walk is a checklist. Auto-assign
   * runs on close and is a DEFAULT only — reassignment stays available, since
   * a time window will sometimes group wrongly across midnight or a drive.
   */
  const toggleTrip = async () => {
    if (trip) {
      await endTrip(trip.id)
      await autoAssign(trip.id)
    } else {
      await startTrip(new Date().toLocaleDateString(), '')
    }
    await refresh()
  }

  useEffect(() => { void refresh() }, [refresh])

  const needsId = all.filter((s) => !s.speciesId)
  const identified = all.filter((s) => s.speciesId)

  if (loading) return null

  return (
    <div style={{ height: '100%', width: '100%', display: 'flex', flexDirection: 'column' }}>

      <div style={{ flex: 'none', display: 'flex', borderBottom: 'var(--hair) solid var(--line)' }}>
        {(['log', 'life'] as Tab[]).map((tb) => (
          <button key={tb} onClick={() => setTab(tb)} aria-pressed={tab === tb}
            style={{
              flex: 1, minHeight: 'var(--tap-min)',
              color: tab === tb ? 'var(--ink)' : 'var(--ink-muted)',
              borderBottom: `2px solid ${tab === tb ? 'var(--accent)' : 'transparent'}`,
              marginBottom: '-1.5px',
            }}>
            <span className="t-meta">{t(tb === 'log' ? 'sightings.title' : 'sightings.lifeList')}</span>
          </button>
        ))}
      </div>

      {tab === 'log' && (
        <div style={{
          flex: 'none', display: 'flex', alignItems: 'center', gap: 'var(--space-3)',
          padding: 'var(--space-2) var(--gutter-sm)', borderBottom: 'var(--hair) solid var(--line)',
          background: trip ? 'var(--panel)' : 'transparent',
        }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <Meta tone={trip ? 'ok' : 'muted'}>{trip ? t('sightings.tripActive') : t('sightings.tripNone')}</Meta>
          </div>
          <Button variant="inline" onClick={() => void toggleTrip()}>
            {trip ? t('sightings.endTrip') : t('sightings.startTrip')}
          </Button>
        </div>
      )}

      <div className="scroll-y" style={{ flex: 1, minHeight: 0 }}>
        {tab === 'life'
          ? <LifeList entries={life} />
          : all.length === 0
            ? <EmptyState title={t('sightings.empty')} fix={t('sightings.emptyFix')} />
            : (
              <>
                {needsId.length > 0 && (
                  <section style={{
                    margin: 'var(--gutter-sm)', border: 'var(--hair) solid var(--warn)', background: 'var(--alert)',
                  }}>
                    <div style={{
                      padding: 'var(--space-3)', borderBottom: 'var(--hair) solid var(--warn)',
                      display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
                    }}>
                      <Meta tone="warn">{t('sightings.needsId', { count: needsId.length })}</Meta>
                    </div>
                    {needsId.map((s) => (
                      <Link key={s.id} to={`/sightings/${s.id}`} style={{
                        display: 'flex', alignItems: 'center', gap: 'var(--space-3)',
                        minHeight: 'var(--tap-min)', padding: 'var(--space-2) var(--space-3)', color: 'var(--ink)',
                      }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div className="t-body">{s.notes || t('sightings.noNotes')}</div>
                          <Meta>{formatTime(s.at)}</Meta>
                        </div>
                        <IconChevron />
                      </Link>
                    ))}
                  </section>
                )}

                {groupByDay(identified).map((g) => (
                  <section key={g.key} style={{ padding: '0 var(--gutter-sm)' }}>
                    <div style={{
                      display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
                      padding: 'var(--space-4) 0 var(--space-2)',
                    }}>
                      <span className="t-heading">{formatDate(g.at)}</span>
                      <Meta>{t('sightings.records', { count: g.items.length })}</Meta>
                    </div>
                    {g.items.map((s) => (
                      <Link key={s.id} to={`/sightings/${s.id}`} style={{
                        display: 'flex', alignItems: 'center', gap: 'var(--space-3)',
                        minHeight: 'var(--tap-min)', padding: 'var(--space-2) 0',
                        borderBottom: 'var(--hair) solid var(--line)', color: 'var(--ink)',
                      }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div className="t-name">{s.speciesSnapshot?.commonName ?? s.speciesId}</div>
                          <div className="t-sci">{s.speciesSnapshot?.sciName}</div>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                          <Meta>{formatTime(s.at)}</Meta>
                          {s.clockConfidence === 'suspect' && <Badge tone="warn">{t('sightings.clockSuspect')}</Badge>}
                        </div>
                      </Link>
                    ))}
                  </section>
                ))}

                <div style={{ padding: 'var(--space-6) var(--gutter-sm)', display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                  <Button variant="secondary" onClick={() => exportCsv(all)}>{t('sightings.exportCsv')}</Button>
                  <Button variant="secondary" onClick={() => exportGeoJson(all)}>{t('sightings.exportGeoJson')}</Button>
                </div>
                <div style={{ padding: '0 var(--gutter-sm) var(--space-6)' }}>
                  <Meta>{t('sightings.exportNote')}</Meta>
                </div>
              </>
            )}
      </div>

      <div style={{ flex: 'none', padding: 'var(--space-3) var(--gutter-sm) var(--space-4)' }}>
        <Button variant="primary" full onClick={() => navigate('/log')}>
          <IconPlus /> {t('sightings.log')}
        </Button>
      </div>
    </div>
  )
}

function exportCsv(rows: Sighting[]) {
  download(`spidex-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(rows), 'text/csv')
}

function exportGeoJson(rows: Sighting[]) {
  download(`spidex-${new Date().toISOString().slice(0, 10)}.geojson`, toGeoJson(rows), 'application/geo+json')
}

function LifeList({ entries }: { entries: LifeListEntry[] }) {
  const { t } = useTranslation()
  if (!entries.length) return <EmptyState title={t('sightings.lifeEmpty')} fix={t('sightings.lifeEmptyFix')} />
  return (
    <div style={{ padding: '0 var(--gutter-sm)' }}>
      <div style={{ padding: 'var(--space-4) 0 var(--space-2)' }}>
        <Meta>{t('sightings.lifeCount', { count: entries.length })}</Meta>
      </div>
      {entries.map((e) => (
        <div key={e.speciesId} style={{
          display: 'flex', alignItems: 'center', gap: 'var(--space-3)',
          minHeight: 'var(--tap-min)', padding: 'var(--space-2) 0',
          borderBottom: 'var(--hair) solid var(--line)',
        }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="t-name">{e.commonName}</div>
            <div className="t-sci">{e.sciName}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <Meta>{t('sightings.firstSeen')}</Meta>
            <div className="t-body">{formatDate(e.firstSeen)}</div>
            <Meta>{formatNumber(e.count)}</Meta>
          </div>
        </div>
      ))}
    </div>
  )
}
