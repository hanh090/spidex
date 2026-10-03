/**
 * Sighting detail, and the Needs-ID resolve flow.
 *
 * Resolving reuses Explore's search and the same species records — it does not
 * reimplement a picker. Photos and notes carry over untouched; that is the
 * whole point of logging unknown in the first place.
 */
import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { db, type Photo, type Sighting } from '../data/db'
import { photosFor } from '../features/log/photo-store'
import { deleteSighting, resolveSpecies, updateSighting } from '../features/log/sighting-repo'
import { useActivePack } from '../features/guide/use-pack'
import { Plate } from '../features/guide/species-grid'
import { search } from '../data/search-index'
import { resolve } from '../data/localized'
import { Button, Meta, Badge } from '../ui/primitives'
import { NavBar } from '../ui/nav-bar'
import { formatDate, formatTime } from '../i18n/format'

export function SightingDetail() {
  const { id } = useParams()
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { species: all, baseUrl } = useActivePack()

  const [sighting, setSighting] = useState<Sighting | null>(null)
  const [photos, setPhotos] = useState<Photo[]>([])
  const [picking, setPicking] = useState(false)
  const [query, setQuery] = useState('')

  useEffect(() => {
    if (!id) return
    let cancelled = false
    void (async () => {
      const [s, ph] = await Promise.all([db.sightings.get(id), photosFor(id)])
      if (cancelled) return
      setSighting(s ?? null)
      setPhotos(ph)
    })()
    return () => { cancelled = true }
  }, [id])

  const candidates = useMemo(() => {
    if (!query.trim()) return all.slice(0, 24)
    const rank = new Map(search(all, query).map((h, i) => [h.id, i]))
    return all.filter((s) => rank.has(s.id)).sort((a, b) => rank.get(a.id)! - rank.get(b.id)!)
  }, [all, query])

  if (!sighting) return null


  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100%', width: '100%' }}>
      <NavBar title={sighting.speciesSnapshot?.commonName ?? t('sightings.unidentified')} />

      <div className="column" style={{ padding: 'var(--space-3) var(--gutter-sm) 0', display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        {photos.length > 0 && (
          <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
            {photos.map((p) => <PhotoThumb key={p.id} photo={p} />)}
          </div>
        )}

        {sighting.speciesSnapshot && (
          <div>
            <div className="t-sci">{sighting.speciesSnapshot.sciName}</div>
          </div>
        )}

        {sighting.notes && <p className="t-body" style={{ margin: 0 }}>{sighting.notes}</p>}

        <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap', alignItems: 'center' }}>
          <Meta>{formatDate(sighting.at + sighting.tzOffsetMinutes * 60_000, 'UTC')} · {formatTime(sighting.at, sighting.tzOffsetMinutes)}</Meta>
          {sighting.clockConfidence === 'suspect' && <Badge tone="warn">{t('sightings.clockSuspect')}</Badge>}
          {sighting.lat != null && (
            <Meta>{sighting.lat.toFixed(4)}, {sighting.lng!.toFixed(4)}</Meta>
          )}
        </div>

        {!sighting.speciesId && !picking && (
          <Button variant="primary" full onClick={() => setPicking(true)}>{t('sightings.resolve')}</Button>
        )}

        {picking && (
          <section>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('explore.searchPlaceholder')}
              aria-label={t('explore.searchPlaceholder')}
              style={{
                width: '100%', minHeight: 'var(--tap-min)', padding: '0 var(--space-3)',
                background: 'var(--paper)', border: 'var(--hair) solid var(--line)',
                font: 'var(--type-body)', color: 'var(--ink)', marginBottom: 'var(--space-3)',
              }}
            />
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(92px, 1fr))', gap: 'var(--space-2)' }}>
              {candidates.map((sp) => (
                <button key={sp.uid} onClick={async () => {
                  await resolveSpecies(sighting.id, sp)
                  navigate('/sightings', { replace: true })
                }} style={{ textAlign: 'left', color: 'var(--ink)' }}>
                  <Plate sp={sp} baseUrl={baseUrl} />
                  <div className="t-name" style={{ marginTop: 4 }}>{resolve(sp.commonNames)}</div>
                </button>
              ))}
            </div>
          </section>
        )}
      </div>

      <div style={{ flex: 1 }} />

      <div className="column" style={{ flex: 'none', padding: 'var(--space-6) var(--gutter-sm) max(var(--space-4), calc(var(--space-2) + env(safe-area-inset-bottom)))', display: 'flex', gap: 'var(--space-2)' }}>
        <Button variant="secondary" onClick={async () => {
          await updateSighting(sighting.id, { count: sighting.count + 1 })
          setSighting({ ...sighting, count: sighting.count + 1 })
        }}>{t('sightings.addOne', { count: sighting.count })}</Button>
        <Button variant="inline" onClick={async () => {
          // One mis-tap in the field would otherwise destroy untouched originals.
          if (!confirm(t('sightings.deleteConfirm'))) return
          await deleteSighting(sighting.id)
          navigate('/sightings', { replace: true })
        }}>{t('sightings.delete')}</Button>
      </div>
    </div>
  )
}

function PhotoThumb({ photo }: { photo: Photo }) {
  const [url, setUrl] = useState<string>()
  useEffect(() => {
    const u = URL.createObjectURL(photo.derived)
    setUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [photo])
  return url
    ? <img src={url} alt="" style={{ width: 96, height: 96, objectFit: 'cover', border: 'var(--hair) solid var(--line)' }} />
    : null
}
