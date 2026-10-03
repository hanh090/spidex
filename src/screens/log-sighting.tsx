/**
 * S06 / S07 — log a sighting, with or without a species.
 *
 * Arriving with ?speciesId= is the two-tap path from a species page. Arriving
 * without one is "log unknown": photo and notes now, identify later at camp.
 * Nothing here needs signal, an account, GPS, a photo, or a species.
 */
import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useSpecies } from '../features/guide/use-pack'
import { useGeo } from '../features/log/geo'
import { prepare, releasePreview, type CapturedPhoto } from '../features/log/photo-store'
import { QuotaError, retryPhotos, saveSighting } from '../features/log/sighting-repo'
import { toLocalInput } from '../features/log/clock'
import { activeTrip, listTrips, startTrip } from '../features/log/trip-repo'
import type { Trip } from '../data/db'
import { Button, Meta } from '../ui/primitives'
import { NavBar } from '../ui/nav-bar'
import { IconPlus } from '../ui/icons'
import { resolve } from '../data/localized'
import { formatDate, formatTime } from '../i18n/format'

const NEW_TRIP = '__new'

export function LogSighting() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const speciesId = params.get('speciesId') ?? undefined
  const { species } = useSpecies(speciesId)
  const geo = useGeo()

  const [count, setCount] = useState(1)
  const [notes, setNotes] = useState('')
  const [at, setAt] = useState(() => Date.now())
  const [photos, setPhotos] = useState<CapturedPhoto[]>([])
  const [tripId, setTripId] = useState<string | undefined>()
  const [saving, setSaving] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  /** Set when the sighting committed but photos did not — retry photos only,
   *  never the whole save, which would mint a second record. */
  const [savedId, setSavedId] = useState<string | null>(null)

  /** Non-null while the user is naming a trip to create on save. */
  const [newTripName, setNewTripName] = useState<string | null>(null)
  const [trips, setTrips] = useState<Trip[]>([])

  useEffect(() => {
    void Promise.all([activeTrip(), listTrips()]).then(([tr, all]) => { setTripId(tr?.id); setTrips(all) })
  }, [])
  useEffect(() => { geo.acquire() }, [])   // on demand, once, on open
  // Preview URLs are full-resolution derivatives; release them on unmount.
  useEffect(() => () => { photos.forEach(releasePreview) }, [photos])

  const onFiles = async (files: FileList | null) => {
    if (!files) return
    const prepared = await Promise.all([...files].map(prepare))
    setPhotos((p) => [...p, ...prepared])
  }

  const save = async () => {
    setSaving(true)
    setProblem(null)

    // Already committed: only the photos need another attempt.
    if (savedId) {
      const stillFailed = await retryPhotos(savedId, photos)
      setSaving(false)
      if (stillFailed.length) { setProblem(t('log.quota', { count: stillFailed.length })); return }
      navigate('/sightings', { replace: true })
      return
    }

    const fix = geo.state.kind === 'fixed' ? geo.state : null
    try {
      let useTripId = tripId
      if (newTripName !== null) {
        // Created once: remembered so a failed save does not mint a second trip on retry.
        const created = await startTrip(newTripName.trim() || new Date().toLocaleDateString(), '')
        useTripId = created.id
        setTripId(created.id)
        setTrips((all) => [created, ...all])
        setNewTripName(null)
      }
      await saveSighting({
        species: species ?? undefined,
        count,
        notes,
        at,
        lat: fix?.lat,
        lng: fix?.lng,
        accuracy: fix?.accuracy,
        tripId: useTripId,
        photos,
      })
      navigate('/sightings', { replace: true })
    } catch (e) {
      // Never report a save that did not fully commit.
      if (e instanceof QuotaError) {
        setSavedId(e.sightingId)
        setProblem(t('log.quota', { count: e.failedPhotoIds.length }))
      } else {
        // Never show a raw internal error; the user cannot act on Dexie text.
        setProblem(t('log.saveFailed'))
        console.error('[spidex] save failed', e)
      }
    } finally {
      setSaving(false)
    }
  }

  const handleBack = () => {
    if (window.history.length > 1) {
      navigate(-1)
    } else {
      navigate('/sightings')
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100%', width: '100%' }}>
      <NavBar
        title={species ? resolve(species.commonNames) : t('sightings.logUnknown')}
        onBack={handleBack}
        fallback="/sightings"
      />

      <div className="column" style={{ padding: 'var(--space-4) var(--gutter-sm) 0', display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>

        <section>
          <div style={{ marginBottom: 'var(--space-2)' }}><Meta>{t('log.photos')}</Meta></div>
          <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
            {photos.map((p) => (
              <img key={p.id} src={p.previewUrl} alt=""
                style={{ width: 84, height: 84, objectFit: 'cover', border: 'var(--hair) solid var(--line)' }} />
            ))}
            <label style={{
              width: 84, height: 84, border: 'var(--hair) dashed var(--ink-muted)',
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              gap: 4, cursor: 'pointer', color: 'var(--ink-muted)',
            }}>
              <IconPlus />
              <span className="t-meta">{t('log.addPhoto')}</span>
              <input type="file" accept="image/*" capture="environment" multiple
                onChange={(e) => void onFiles(e.target.files)} className="sr-only" />
            </label>
          </div>
          {photos.length > 0 && <div style={{ marginTop: 'var(--space-2)' }}><Meta>{t('log.originalsKept')}</Meta></div>}
        </section>

        <section>
          <div style={{ marginBottom: 'var(--space-2)' }}><Meta>{t('log.notes')}</Meta></div>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={4}
            placeholder={t('log.notesPlaceholder')}
            style={{
              width: '100%', padding: 'var(--space-3)', background: 'var(--paper)',
              border: 'var(--hair) solid var(--line)', font: 'var(--type-body)',
              color: 'var(--ink)', resize: 'vertical',
            }}
          />
        </section>

        <section style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          <FieldRow label={t('log.position')} value={<GeoValue geo={geo} />}
            action={<Button variant="inline" onClick={geo.acquire}>{t('log.retry')}</Button>} />

          <FieldRow
            label={t('log.time')}
            value={
              <div>
                <span className="t-body">{formatDate(at)} · {formatTime(at)}</span>
                {/* The device clock is not trusted, so the time is editable. */}
                <input
                  type="datetime-local"
                  /* valueAsNumber reads the entered wall time AS UTC, which
                     shifts the record by the offset. Parse the string instead —
                     `new Date('YYYY-MM-DDTHH:mm')` is local time by spec. */
                  value={toLocalInput(at)}
                  onChange={(e) => { const d = new Date(e.target.value); if (!Number.isNaN(+d)) setAt(+d) }}
                  aria-label={t('log.time')}
                  style={{
                    display: 'block', marginTop: 'var(--space-1)', minHeight: 'var(--tap-min)',
                    background: 'var(--paper)', border: 'var(--hair) solid var(--line)',
                    color: 'var(--ink)', padding: '0 var(--space-2)', width: '100%',
                  }}
                />
              </div>
            }
          />

          <FieldRow
            label={t('fieldLog.logTrip')}
            value={
              <div>
                <select
                  value={newTripName !== null ? NEW_TRIP : tripId ?? ''}
                  onChange={(e) => {
                    const v = e.target.value
                    if (v === NEW_TRIP) { setNewTripName(''); return }
                    setNewTripName(null)
                    setTripId(v || undefined)
                  }}
                  aria-label={t('fieldLog.logTrip')}
                  style={{
                    display: 'block', width: '100%', minHeight: 'var(--tap-min)',
                    background: 'var(--paper)', border: 'var(--hair) solid var(--line)',
                    color: 'var(--ink)', padding: '0 var(--space-2)', font: 'var(--type-body)',
                  }}
                >
                  <option value="">{t('fieldLog.logNoTrip')}</option>
                  {trips.map((tr) => <option key={tr.id} value={tr.id}>{tr.name || t('fieldLog.tripUntitled')}</option>)}
                  <option value={NEW_TRIP}>{t('fieldLog.logNewTrip')}</option>
                </select>
                {newTripName !== null && (
                  <input
                    value={newTripName}
                    onChange={(e) => setNewTripName(e.target.value)}
                    placeholder={t('fieldLog.logNewTripName')}
                    aria-label={t('fieldLog.logNewTripName')}
                    style={{
                      display: 'block', width: '100%', marginTop: 'var(--space-1)', minHeight: 'var(--tap-min)',
                      background: 'var(--paper)', border: 'var(--hair) solid var(--line)',
                      color: 'var(--ink)', padding: '0 var(--space-2)', font: 'var(--type-body)',
                    }}
                  />
                )}
              </div>
            }
          />

          <FieldRow
            label={t('log.count')}
            value={
              <div style={{ display: 'flex', border: 'var(--hair) solid var(--line)', width: 'fit-content' }}>
                <button onClick={() => setCount((c) => Math.max(1, c - 1))} aria-label={t('log.decrease')}
                  style={{ minWidth: 'var(--tap-min)', color: 'var(--ink)' }}>−</button>
                <span className="t-money" style={{
                  minWidth: 56, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  borderInline: 'var(--hair) solid var(--line)',
                }}>{count}</span>
                <button onClick={() => setCount((c) => c + 1)} aria-label={t('log.increase')}
                  style={{ minWidth: 'var(--tap-min)', color: 'var(--ink)' }}>+</button>
              </div>
            }
          />
        </section>

        {problem && (
          <div style={{ background: 'var(--alert)', border: 'var(--hair) solid var(--warn)', padding: 'var(--space-3)' }}>
            <span className="t-body">{problem}</span>
          </div>
        )}
      </div>

      <div style={{ flex: 1 }} />

      <div style={{
        flex: 'none', position: 'sticky', bottom: 0, background: 'var(--panel)',
        borderTop: 'var(--hair) solid var(--line)',
        padding: 'var(--space-3) var(--gutter-sm) max(var(--space-4), calc(var(--space-2) + env(safe-area-inset-bottom)))',
      }}>
        <div className="column">
        <Button variant="primary" full disabled={saving} onClick={() => void save()}>
          {savedId ? t('log.retryPhotos') : species ? t('log.save') : t('log.saveToNeedsId')}
        </Button>
        {!species && <div style={{ textAlign: 'center', marginTop: 'var(--space-2)' }}><Meta>{t('log.resolveLater')}</Meta></div>}
        </div>
      </div>
    </div>
  )
}

function FieldRow({ label, value, action }: { label: string; value: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'flex-start', paddingBottom: 'var(--space-3)', borderBottom: 'var(--hair) solid var(--line)' }}>
      <div style={{ width: 76, flex: 'none', paddingTop: 2 }}><Meta>{label}</Meta></div>
      <div style={{ flex: 1, minWidth: 0 }}>{value}</div>
      {action}
    </div>
  )
}

function GeoValue({ geo }: { geo: ReturnType<typeof useGeo> }) {
  const { t } = useTranslation()
  const s = geo.state
  switch (s.kind) {
    case 'fixed':
      return (
        <div>
          <span className="t-money" style={{ fontSize: 14 }}>{s.lat.toFixed(4)}, {s.lng.toFixed(4)}</span>
          <div><Meta tone="ok">{t('log.fixed', { m: Math.round(s.accuracy) })}</Meta></div>
        </div>
      )
    case 'acquiring': return <Meta>{t('log.acquiring')}</Meta>
    case 'no_fix': return <Meta tone="warn">{t('log.noFix')}</Meta>
    case 'denied': return <Meta tone="warn">{t('log.denied')}</Meta>
    case 'unavailable': return <Meta tone="warn">{t('log.geoUnavailable')}</Meta>
    default: return <Meta>{t('log.noPosition')}</Meta>
  }
}
