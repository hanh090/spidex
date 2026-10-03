/**
 * Admin "Media" panel — pick a pack, search its species, edit one species'
 * images (credit, licence, aspect, order, upload) and save.
 *
 * Saving writes an override of the pack's species data and bumps the pack
 * version server-side, so clients see "update available". The server is the
 * authority on validity (credit + licence required, no NoDerivatives, aspects
 * from the pack's schema); this screen only blocks the obvious blanks early.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Badge, Button, Meta, Skeleton } from '../ui/primitives'
import { Alert, Chip, fieldStyle } from './admin-parts'
import {
  fetchMediaPacks, fetchMediaSpecies, saveMediaImages, uploadMediaImage,
  type MediaFilter, type MediaFlags, type MediaImage, type MediaPack, type MediaSpecies,
} from '../features/admin/admin-api'
import { resolve } from '../data/localized'
import { formatNumber } from '../i18n/format'

const FILTERS: MediaFilter[] = ['all', 'nc', 'nd', 'archetype']
const MAX_UPLOAD = 8 * 1024 * 1024
const EXT_BY_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif',
}

/** Relative pack paths resolve under /packs/<id>/; absolute http(s) urls pass through. */
const previewUrl = (packId: string, url: string) => (/^https?:\/\//i.test(url) ? url : `/packs/${packId}/${url}`)

const card: React.CSSProperties = {
  border: 'var(--hair) solid var(--line)', borderRadius: 'var(--radius-card)',
  padding: 'var(--space-4)', background: 'var(--paper)',
}

export function MediaPanel() {
  const { t } = useTranslation()
  const [packs, setPacks] = useState<MediaPack[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [packId, setPackId] = useState<string | null>(null)

  const load = useCallback(() => {
    fetchMediaPacks().then((r) => setPacks(r.packs)).catch((e) => setError((e as Error).message))
  }, [])
  useEffect(load, [load])

  if (error && !packs) return <Alert>{error}</Alert>
  if (!packs) return <Skeleton height={120} />
  const pack = packs.find((p) => p.id === packId)

  if (pack) {
    return <PackSpecies pack={pack} onBack={() => { setPackId(null); load() }} />
  }

  return (
    <div style={{ display: 'grid', gap: 'var(--space-3)' }}>
      <Meta>{t('admin.media.pickPack')}</Meta>
      {packs.map((p) => (
        <button
          key={p.id}
          disabled={p.missing}
          onClick={() => setPackId(p.id)}
          style={{ ...card, textAlign: 'left', display: 'grid', gap: 'var(--space-2)', color: 'var(--ink)' }}
        >
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
            <span className="t-heading" style={{ fontSize: 17 }}>{p.name ? resolve(p.name) : p.id}</span>
            <span className="t-meta" style={{ color: 'var(--ink-muted)' }}>{p.id}</span>
            <span style={{ flex: 1 }} />
            {p.community && <Badge tone="muted">{t('admin.community')}</Badge>}
            {p.missing && <Badge tone="warn">{t('admin.missing')}</Badge>}
          </div>
          {!p.missing && (
            <>
              <div className="t-meta" style={{ color: 'var(--ink-muted)' }}>
                {[
                  p.speciesCount != null && t('packs.speciesCount', { count: p.speciesCount, n: formatNumber(p.speciesCount) }),
                  p.version != null && `v${formatNumber(p.version)}`,
                  p.counts && t('admin.media.imageCount', { count: p.counts.images, n: formatNumber(p.counts.images) }),
                ].filter(Boolean).join(' · ')}
              </div>
              <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                {!!p.counts?.nd && <Badge tone="warn">{t('admin.media.flag.nd')} {formatNumber(p.counts.nd)}</Badge>}
                {!!p.counts?.nc && <Badge tone="accent">{t('admin.media.flag.nc')} {formatNumber(p.counts.nc)}</Badge>}
                {!!p.counts?.archetype && <Badge tone="muted">{t('admin.media.flag.archetype')} {formatNumber(p.counts.archetype)}</Badge>}
              </div>
              <div className="t-meta" style={{ color: 'var(--ink-muted)' }}>
                {Object.entries(p.licenses ?? {}).map(([l, n]) => `${l} ${formatNumber(n)}`).join(' · ')}
              </div>
            </>
          )}
        </button>
      ))}
    </div>
  )
}

function FlagBadges({ flags }: { flags?: MediaFlags }) {
  const { t } = useTranslation()
  if (!flags) return null
  return (
    <>
      {flags.nd && <Badge tone="warn">{t('admin.media.flag.nd')}</Badge>}
      {flags.nc && <Badge tone="accent">{t('admin.media.flag.nc')}</Badge>}
      {flags.archetype && <Badge tone="muted">{t('admin.media.flag.archetype')}</Badge>}
    </>
  )
}

function PackSpecies({ pack, onBack }: { pack: MediaPack; onBack: () => void }) {
  const { t } = useTranslation()
  const [q, setQ] = useState('')
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<MediaFilter>('all')
  const [rows, setRows] = useState<MediaSpecies[] | null>(null)
  const [total, setTotal] = useState(0)
  const [cursor, setCursor] = useState<string | null>(null)
  const [aspects, setAspects] = useState<{ required: string[]; optional: string[] }>({ required: [], optional: [] })
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<MediaSpecies | null>(null)
  const [version, setVersion] = useState(pack.version)
  const reqId = useRef(0)

  // Debounce typing so a 1,500-species pack is not re-fetched per keystroke.
  useEffect(() => {
    const h = setTimeout(() => setQuery(q.trim()), 300)
    return () => clearTimeout(h)
  }, [q])

  const load = useCallback((after: string | null) => {
    const id = ++reqId.current
    fetchMediaSpecies(pack.id, { q: query, filter, cursor: after })
      .then((page) => {
        if (id !== reqId.current) return // a newer search superseded this one
        setRows((prev) => (after && prev ? [...prev, ...page.species] : page.species))
        setTotal(page.total)
        setCursor(page.nextCursor)
        setAspects(page.aspects)
        setError(null)
      })
      .catch((e) => { if (id === reqId.current) setError((e as Error).message) })
  }, [pack.id, query, filter])

  useEffect(() => { setRows(null); load(null) }, [load])

  if (editing) {
    return (
      <SpeciesEditor
        packId={pack.id}
        species={editing}
        aspects={aspects}
        onCancel={() => setEditing(null)}
        onSaved={(sp, v) => {
          setRows((prev) => prev?.map((r) => (r.id === sp.id ? sp : r)) ?? prev)
          setVersion(v)
          setEditing(null)
        }}
      />
    )
  }

  return (
    <div style={{ display: 'grid', gap: 'var(--space-3)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
        <Button variant="inline" onClick={onBack}>{t('admin.media.back')}</Button>
        <span className="t-heading" style={{ fontSize: 17 }}>{pack.name ? resolve(pack.name) : pack.id}</span>
        {version != null && <span className="t-meta" style={{ color: 'var(--ink-muted)' }}>v{formatNumber(version)}</span>}
      </div>
      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={t('admin.media.search')}
        aria-label={t('admin.media.search')}
        style={fieldStyle()}
      />
      <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
        {FILTERS.map((f) => (
          <Chip key={f} label={t(`admin.media.filter.${f}`)} active={filter === f} onClick={() => setFilter(f)} />
        ))}
      </div>
      {error && <Alert>{error}</Alert>}
      {rows === null
        ? <Skeleton height={80} />
        : (
          <>
            <Meta>{t('admin.media.matches', { count: total, n: formatNumber(total) })}</Meta>
            {rows.map((sp) => (
              <button
                key={sp.id}
                onClick={() => setEditing(sp)}
                style={{
                  ...card, padding: 'var(--space-3)', textAlign: 'left', color: 'var(--ink)',
                  display: 'flex', alignItems: 'center', gap: 'var(--space-3)',
                }}
              >
                <Thumb packId={pack.id} url={sp.images[0]?.thumbUrl} size={56} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="t-body" style={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{sp.name || sp.sciName}</div>
                  <div className="t-meta" style={{ color: 'var(--ink-muted)', fontStyle: 'italic', overflowWrap: 'anywhere' }}>{sp.sciName}</div>
                  <div style={{ display: 'flex', gap: 'var(--space-1)', flexWrap: 'wrap', marginTop: 'var(--space-1)' }}>
                    <FlagBadges flags={sp.flags} />
                  </div>
                </div>
              </button>
            ))}
            {!rows.length && <p className="t-body" style={{ color: 'var(--ink-muted)', margin: 0 }}>{t('admin.media.none')}</p>}
            {cursor && <Button variant="secondary" onClick={() => load(cursor)}>{t('admin.media.more')}</Button>}
          </>
        )}
    </div>
  )
}

function Thumb({ packId, url, size }: { packId: string; url?: string; size: number }) {
  return (
    <div style={{
      width: size, height: size, flex: 'none', borderRadius: 'var(--radius-tap)',
      background: 'var(--line)', overflow: 'hidden',
    }}>
      {url && <img src={previewUrl(packId, url)} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
    </div>
  )
}

function SpeciesEditor({ packId, species, aspects, onCancel, onSaved }: {
  packId: string
  species: MediaSpecies
  aspects: { required: string[]; optional: string[] }
  onCancel: () => void
  onSaved: (sp: MediaSpecies, version: number) => void
}) {
  const { t } = useTranslation()
  const [images, setImages] = useState<MediaImage[]>(species.images)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const allAspects = [...aspects.required, ...aspects.optional]

  const patch = (i: number, p: Partial<MediaImage>) =>
    setImages((prev) => prev.map((im, j) => (j === i ? { ...im, ...p, flags: undefined } : im)))
  const move = (i: number, d: -1 | 1) =>
    setImages((prev) => {
      const j = i + d
      if (j < 0 || j >= prev.length) return prev
      const next = [...prev]
      ;[next[i], next[j]] = [next[j]!, next[i]!]
      return next
    })
  const remove = (i: number) => setImages((prev) => prev.filter((_, j) => j !== i))

  const upload = async (file: File) => {
    setError(null)
    const ext = EXT_BY_TYPE[file.type]
    if (!ext) return setError(t('admin.media.badType'))
    if (file.size > MAX_UPLOAD) return setError(t('admin.media.tooLarge'))
    setBusy(true)
    try {
      // Unique name per upload, so it never collides with (or replaces) an existing file.
      const slug = species.id.toLowerCase().replace(/[^a-z0-9-]+/g, '-').slice(0, 80)
      const { url } = await uploadMediaImage(packId, file, `img/${slug}-${Date.now().toString(36)}.${ext}`)
      setImages((prev) => {
        const used = new Set(prev.map((im) => im.id))
        let n = prev.length + 1
        while (used.has(`${species.id}-${n}`)) n++
        return [...prev, {
          id: `${species.id}-${n}`,
          aspect: allAspects.find((a) => !prev.some((im) => im.aspect === a)) ?? allAspects[0] ?? '',
          credit: '', license: '', thumbUrl: url, fullUrl: url,
        }]
      })
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const missing = images.some((im) => !im.credit.trim() || !im.license.trim())
  const save = async () => {
    setBusy(true)
    setError(null)
    try {
      const r = await saveMediaImages(packId, species.id, images)
      const flagged = r.images.map((im) => ({ ...im, flags: undefined }))
      // Reload this species' flags from the server so badges reflect the saved licences.
      const fresh = await fetchMediaSpecies(packId, { q: species.id }).then((p) => p.species.find((s) => s.id === species.id))
      onSaved(fresh ?? { ...species, images: flagged }, r.version)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ display: 'grid', gap: 'var(--space-3)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
        <Button variant="inline" onClick={onCancel}>{t('admin.media.back')}</Button>
        <span className="t-heading" style={{ fontSize: 17 }}>{species.name || species.sciName}</span>
        <span className="t-meta" style={{ color: 'var(--ink-muted)', fontStyle: 'italic' }}>{species.sciName}</span>
      </div>
      <Meta>{t('admin.media.requiredAspects', { aspects: aspects.required.join(', ') })}</Meta>
      {error && <Alert>{error}</Alert>}

      {images.map((im, i) => (
        <section key={im.id} style={{ ...card, display: 'grid', gap: 'var(--space-3)' }}>
          <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'flex-start' }}>
            <Thumb packId={packId} url={im.thumbUrl} size={96} />
            <div style={{ flex: 1, minWidth: 0, display: 'grid', gap: 'var(--space-2)' }}>
              <div style={{ display: 'flex', gap: 'var(--space-1)', flexWrap: 'wrap', alignItems: 'center' }}>
                <span className="t-meta" style={{ color: 'var(--ink-muted)', overflowWrap: 'anywhere' }}>{im.id}</span>
                <FlagBadges flags={im.flags} />
              </div>
              <div className="t-meta" style={{ color: 'var(--ink-muted)', overflowWrap: 'anywhere' }}>{im.thumbUrl}</div>
            </div>
          </div>
          <select
            value={im.aspect}
            onChange={(e) => patch(i, { aspect: e.target.value })}
            aria-label={t('admin.media.aspect')}
            style={fieldStyle()}
          >
            {!allAspects.includes(im.aspect) && <option value={im.aspect}>{im.aspect}</option>}
            {allAspects.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
          <input
            value={im.credit}
            onChange={(e) => patch(i, { credit: e.target.value })}
            placeholder={t('admin.media.credit')}
            aria-label={t('admin.media.credit')}
            style={fieldStyle()}
          />
          <input
            value={im.license}
            onChange={(e) => patch(i, { license: e.target.value })}
            placeholder={t('admin.media.license')}
            aria-label={t('admin.media.license')}
            style={fieldStyle()}
          />
          <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
            <Button variant="inline" disabled={i === 0} onClick={() => move(i, -1)} aria-label={t('admin.media.moveUp')}>↑</Button>
            <Button variant="inline" disabled={i === images.length - 1} onClick={() => move(i, 1)} aria-label={t('admin.media.moveDown')}>↓</Button>
            <span style={{ flex: 1 }} />
            <Button variant="inline" disabled={images.length < 2} onClick={() => remove(i)}>{t('admin.media.remove')}</Button>
          </div>
        </section>
      ))}

      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif,image/avif"
        hidden
        onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f) }}
      />
      <Button variant="secondary" disabled={busy} onClick={() => fileRef.current?.click()}>{t('admin.media.upload')}</Button>
      {missing && <Meta tone="warn">{t('admin.media.needAttribution')}</Meta>}
      <Button variant="primary" disabled={busy || missing || !images.length} onClick={() => void save()}>
        {busy ? t('admin.saving') : t('admin.media.save')}
      </Button>
    </div>
  )
}
