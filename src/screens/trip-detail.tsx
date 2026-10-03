/**
 * S09 Trip detail — edit the trip, end or resume it, and see its sightings
 * grouped by day. Assignment by time window is a default; every record can be
 * taken out of the trip by hand.
 */
import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import type { Sighting, Trip } from '../data/db'
import { groupByDay } from '../features/log/sighting-repo'
import { fromLocalInput, toLocalInput } from '../features/log/clock'
import {
  autoAssign, countSpecies, endTrip, getTrip, reassign, resumeTrip, tripSightings, updateTrip,
} from '../features/log/trip-repo'
import { Badge, Button, EmptyState, Meta } from '../ui/primitives'
import { NavBar } from '../ui/nav-bar'
import { IconChevron } from '../ui/icons'
import { formatDate, formatTime } from '../i18n/format'

const inputStyle: React.CSSProperties = {
  display: 'block', width: '100%', minHeight: 'var(--tap-min)',
  background: 'var(--paper)', border: 'var(--hair) solid var(--line)',
  color: 'var(--ink)', padding: '0 var(--space-2)', font: 'var(--type-body)',
}

export function TripDetail() {
  const { id } = useParams()
  const { t } = useTranslation()
  const [trip, setTrip] = useState<Trip | null>(null)
  const [rows, setRows] = useState<Sighting[]>([])
  const [loading, setLoading] = useState(true)
  const [name, setName] = useState('')
  const [location, setLocation] = useState('')
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [note, setNote] = useState<{ tone: 'ok' | 'warn'; text: string } | null>(null)

  const load = useCallback(async () => {
    if (!id) { setLoading(false); return }
    const [tr, sightings] = await Promise.all([getTrip(id), tripSightings(id)])
    setTrip(tr ?? null)
    setRows(sightings)
    if (tr) {
      setName(tr.name)
      setLocation(tr.locationLabel)
      setStart(toLocalInput(tr.startedAt))
      setEnd(tr.endedAt ? toLocalInput(tr.endedAt) : '')
    }
    setLoading(false)
  }, [id])

  useEffect(() => { void load() }, [load])

  if (loading) return null
  if (!trip) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100%', width: '100%' }}>
        <NavBar fallback="/trips" />
        <EmptyState title={t('fieldLog.tripNotFound')} fix={t('fieldLog.tripsEmptyFix')} />
      </div>
    )
  }

  const save = async () => {
    const startedAt = fromLocalInput(start)
    const parsedEnd = end ? fromLocalInput(end) : null
    if (startedAt == null || (end && parsedEnd == null)) { setNote({ tone: 'warn', text: t('fieldLog.tripSaveFailed') }); return }
    const endedAt = parsedEnd ?? undefined
    if (endedAt != null && endedAt < startedAt) { setNote({ tone: 'warn', text: t('fieldLog.tripEndBeforeStart') }); return }
    try {
      await updateTrip(trip.id, { name: name.trim(), locationLabel: location.trim(), startedAt, endedAt })
      await load()
      setNote({ tone: 'ok', text: t('fieldLog.tripSaved') })
    } catch (e) {
      console.error('[spidex] trip save failed', e)
      setNote({ tone: 'warn', text: t('fieldLog.tripSaveFailed') })
    }
  }

  const toggleActive = async () => {
    if (trip.endedAt) await resumeTrip(trip.id)
    else { await endTrip(trip.id); await autoAssign(trip.id) }
    setNote(null)
    await load()
  }

  const addWindow = async () => {
    const n = await autoAssign(trip.id)
    setNote({ tone: 'ok', text: n ? t('fieldLog.tripAdded', { count: n }) : t('fieldLog.tripAddedNone') })
    await load()
  }

  const remove = async (sid: string) => {
    await reassign(sid, undefined)
    await load()
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100%', width: '100%' }}>
      <NavBar title={trip.name || t('fieldLog.tripUntitled')} fallback="/trips" />

      <div className="column" style={{ padding: 'var(--space-4) var(--gutter-sm) var(--space-6)', display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)', alignItems: 'center' }}>
          <Badge tone={trip.endedAt ? 'muted' : 'ok'}>{trip.endedAt ? t('fieldLog.tripEnded') : t('fieldLog.tripActive')}</Badge>
          <Meta>{t('fieldLog.tripSpecies', { count: countSpecies(rows) })} · {t('sightings.records', { count: rows.length })}</Meta>
        </div>

        <section style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          <Field label={t('fieldLog.tripName')}>
            <input value={name} onChange={(e) => setName(e.target.value)} style={inputStyle} />
          </Field>
          <Field label={t('fieldLog.tripLocation')}>
            <input value={location} onChange={(e) => setLocation(e.target.value)} style={inputStyle} />
          </Field>
          <Field label={t('fieldLog.tripStart')}>
            <input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} style={inputStyle} />
          </Field>
          <Field label={t('fieldLog.tripEnd')}>
            <input type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} style={inputStyle} />
          </Field>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)', alignItems: 'center' }}>
            <Button variant="secondary" onClick={() => void save()}>{t('fieldLog.tripSave')}</Button>
            <Button variant="inline" onClick={() => void toggleActive()}>
              {trip.endedAt ? t('fieldLog.tripResume') : t('fieldLog.tripEndNow')}
            </Button>
          </div>
          {note && <div role="status"><Meta tone={note.tone}>{note.text}</Meta></div>}
        </section>

        <section>
          {rows.length === 0
            ? (
              <div style={{ padding: 'var(--space-4) 0' }}>
                <div className="t-heading">{t('fieldLog.tripNoSightings')}</div>
                <p className="t-body" style={{ color: 'var(--ink-muted)', margin: 'var(--space-2) 0 0' }}>{t('fieldLog.tripNoSightingsFix')}</p>
              </div>
            )
            : groupByDay(rows).map((g) => (
              <div key={g.key}>
                <div style={{
                  display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 'var(--space-2)',
                  padding: 'var(--space-4) 0 var(--space-2)',
                }}>
                  <span className="t-heading">{formatDate(g.at, 'UTC')}</span>
                  <Meta>{t('sightings.records', { count: g.items.length })}</Meta>
                </div>
                {g.items.map((s) => (
                  <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', borderBottom: 'var(--hair) solid var(--line)' }}>
                    <Link to={`/sightings/${s.id}`} style={{
                      flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 'var(--space-3)',
                      minHeight: 'var(--tap-min)', padding: 'var(--space-2) 0', color: 'var(--ink)',
                    }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="t-name" style={{ overflowWrap: 'anywhere' }}>
                          {s.speciesSnapshot?.commonName ?? t('sightings.unidentified')}
                        </div>
                        {s.speciesSnapshot && <div className="t-sci" style={{ overflowWrap: 'anywhere' }}>{s.speciesSnapshot.sciName}</div>}
                        <Meta>{formatTime(s.at)}</Meta>
                      </div>
                      <IconChevron />
                    </Link>
                    <Button variant="inline" onClick={() => void remove(s.id)} aria-label={t('fieldLog.tripRemoveRow')}
                      style={{ flex: 'none', maxWidth: 110, textAlign: 'center' }}>
                      <span className="t-meta">{t('fieldLog.tripRemoveRow')}</span>
                    </Button>
                  </div>
                ))}
              </div>
            ))}
          <div style={{ paddingTop: 'var(--space-4)' }}>
            <Button variant="secondary" onClick={() => void addWindow()}>{t('fieldLog.tripAddWindow')}</Button>
          </div>
        </section>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'block' }}>
      <div style={{ marginBottom: 'var(--space-1)' }}><Meta>{label}</Meta></div>
      {children}
    </label>
  )
}
