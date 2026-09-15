/**
 * S03 Species detail.
 *
 * Aspects and detail sections come from the pack's traitSchema — this file
 * does not know what a butterfly is. Dorsal/ventral for Lepidoptera and
 * call/flight for birds are the same code path with different declarations.
 *
 * Every image shows its credit and licence. No exception, no truncation that
 * hides it.
 */
import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { db } from '../data/db'
import { useSpecies, useActivePack } from '../features/guide/use-pack'
import { Plate } from '../features/guide/species-grid'
import { Button, Meta, Badge } from '../ui/primitives'
import { NavBar } from '../ui/nav-bar'
import { resolve, resolveAll } from '../data/localized'

export function SpeciesDetail() {
  const { id } = useParams()
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { species: sp, similar, loading } = useSpecies(id)
  const { pack, baseUrl } = useActivePack()
  const [aspect, setAspect] = useState<string | null>(null)

  const schema = pack?.manifest.traitSchema

  if (loading || !sp || !schema) return null

  // Only aspects that actually exist are offered — never an empty tab.
  const order = [...schema.aspects.required, ...schema.aspects.optional]
  const available = order.filter((a) => sp.images.some((im) => im.aspect === a))
  const shown = aspect && available.includes(aspect) ? aspect : available[0]
  const image = sp.images.find((im) => im.aspect === shown) ?? sp.images[0]


  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100%', width: '100%' }}>

      <NavBar
        title={resolve(sp.commonNames)}
        action={<FavouriteToggle packId={sp.packId} speciesId={sp.id} />}
      />

      {/* Gallery */}
      <div style={{
        flex: 'none', width: '100%', aspectRatio: '4 / 3', maxHeight: '42vh', background: 'var(--panel)',
        borderBlock: 'var(--hair) solid var(--line)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
      }}>
        {image
          ? <img src={`${baseUrl}/${image.thumbUrl}`} alt={`${resolve(sp.commonNames)} — ${shown}`}
              style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
          : <Meta>{t('species.imageMissing')}</Meta>}
      </div>

      {available.length > 1 && (
        <div style={{ flex: 'none', display: 'flex', borderBottom: 'var(--hair) solid var(--line)' }}>
          {available.map((a) => (
            <button
              key={a}
              onClick={() => setAspect(a)}
              aria-pressed={a === shown}
              style={{
                flex: 1, minHeight: 'var(--tap-min)',
                color: a === shown ? 'var(--ink)' : 'var(--ink-muted)',
                borderBottom: `2px solid ${a === shown ? 'var(--accent)' : 'transparent'}`,
                marginBottom: '-1.5px',
              }}
            >
              <span className="t-meta">{t(`aspect.${a}`, { defaultValue: a })}</span>
            </button>
          ))}
        </div>
      )}

      {/*
        Names first. Attribution is not optional and is never truncated, but it
        sat ABOVE the species name in 10px uppercase mono, which made the
        licence string the loudest block on the page. It now follows the name
        it belongs to, at the weight of a caption.
      */}
      <div style={{ flex: 'none', padding: 'var(--space-4) var(--gutter-sm) 0' }}>
        <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'flex-start' }}>
          <h1 className="t-title" style={{ margin: 0, flex: 1, textWrap: 'pretty' }}>{resolve(sp.commonNames)}</h1>
          {sp.sensitivity >= 2 && <Badge tone="warn">{t('species.sensitive')}</Badge>}
        </div>
        <div className="t-sci" style={{ marginTop: 'var(--space-1)' }}>
          {sp.sciName} <span style={{ fontStyle: 'normal' }}>· {sp.family}</span>
        </div>
        {sp.status && (
          <div style={{ marginTop: 'var(--space-2)' }}>
            <Badge tone="muted">{resolve(sp.status)}</Badge>
          </div>
        )}
      </div>

      {/* Attribution is not optional — it captions the plate above. */}
      {image && <CreditLine credit={image.credit} license={image.license} />}

      {sp.keyFeatures.length > 0 && (
        <Block label={t('species.keyFeatures')}>
          <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            {resolveAll(sp.keyFeatures).map((f, i) => (
              <li key={i} className="t-body" style={{ display: 'flex', gap: 'var(--space-2)' }}>
                <span style={{ color: 'var(--accent)', flex: 'none' }} aria-hidden>—</span>
                <span>{f}</span>
              </li>
            ))}
          </ul>
        </Block>
      )}

      {similar.length > 0 && (
        <Block
          label={t('species.confusedWith')}
          action={<Link className="t-meta" style={{ color: 'var(--accent)' }} to={`/compare?ids=${[sp.uid, ...similar.slice(0, 2).map((s) => s.uid)].join(',')}`}>{t('species.compare')}</Link>}
        >
          <div style={{ display: 'flex', gap: 'var(--space-2)', overflowX: 'auto' }}>
            {similar.map((s) => (
              <Link key={s.uid} to={`/species/${s.uid}`} style={{ color: 'var(--ink)', flex: 'none', width: 84 }}>
                <Plate sp={s} baseUrl={baseUrl} />
                <div className="t-meta" style={{ marginTop: 4 }}>{resolve(s.commonNames)}</div>
              </Link>
            ))}
          </div>
        </Block>
      )}

      {sp.months.length > 0 && sp.months.length < 12 && (
        <Block label={t('species.seasonality')}>
          <Seasonality months={sp.months} />
        </Block>
      )}

      {sp.habitat && <Block label={t('species.habitat')}><span className="t-body">{resolve(sp.habitat)}</span></Block>}

      {/* Taxon-conditional sections, declared by the pack. */}
      {schema.sections.map((section) => {
        const value = sp.taxonFields[section.key]
        if (!value) return null
        return (
          <Block key={section.key} label={resolve(section.label)}>
            <span className="t-body">{resolve(value)}</span>
          </Block>
        )
      })}

      <div style={{ flex: 1 }} />

      <div style={{
        flex: 'none', width: '100%', position: 'sticky', bottom: 0, zIndex: 10,
        background: 'var(--panel)', borderTop: 'var(--hair) solid var(--line)',
        padding: 'var(--space-3) var(--gutter-sm) max(var(--space-4), calc(var(--space-2) + env(safe-area-inset-bottom)))',
      }}>
        <Button variant="primary" full onClick={() => navigate(`/log?speciesId=${sp.uid}`)}>
          {t('species.iSawThis')}
        </Button>
      </div>
    </div>
  )
}

function Block({ label, action, children }: { label: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section style={{ flex: 'none', padding: 'var(--space-4) var(--gutter-sm) 0' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 'var(--space-2)' }}>
        <Meta>{label}</Meta>
        {action}
      </div>
      {children}
    </section>
  )
}

function Seasonality({ months }: { months: number[] }) {
  const set = new Set(months)
  const initials = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D']
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gap: 2 }}>
        {initials.map((_, i) => (
          <div key={i} style={{ height: 18, background: set.has(i + 1) ? 'var(--accent)' : 'var(--panel)' }} />
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gap: 2, marginTop: 3 }}>
        {initials.map((m, i) => (
          <span key={i} className="t-unit" style={{ color: 'var(--ink-muted)', textAlign: 'center' }}>{m}</span>
        ))}
      </div>
    </div>
  )
}

function FavouriteToggle({ packId, speciesId }: { packId: string; speciesId: string }) {
  const { t } = useTranslation()
  const key = `${packId}:${speciesId}`
  const [on, setOn] = useState<boolean | null>(null)

  // An effect, not a render-body call: React Router reuses this component when
  // navigating species → species, so the query must re-run on `key` and the
  // stale value must not survive. Cancellation stops a late resolve setting
  // state on an unmounted component under StrictMode's double-invoke.
  useEffect(() => {
    let cancelled = false
    setOn(null)
    void db.favourites.get(key).then((r) => { if (!cancelled) setOn(!!r) })
    return () => { cancelled = true }
  }, [key])

  return (
    <button
      onClick={async () => {
        if (on) { await db.favourites.delete(key); setOn(false) }
        else { await db.favourites.put({ id: key, packId, speciesId, addedAt: Date.now() }); setOn(true) }
      }}
      aria-pressed={!!on}
      aria-label={t('species.favourite')}
      style={{ marginLeft: 'auto', minWidth: 'var(--tap-min)', color: on ? 'var(--accent)' : 'var(--ink-muted)' }}
    >
      <span className="t-meta">{on ? t('species.saved') : t('species.save')}</span>
    </button>
  )
}

/**
 * Image attribution. Required on every image, never truncated, never hidden
 * behind a tap — and never louder than the species it captions.
 */
function CreditLine({ credit, license }: { credit: string; license: string }) {
  return (
    <div style={{ flex: 'none', padding: 'var(--space-2) var(--gutter-sm) 0' }}>
      <span className="t-meta" style={{ color: 'var(--ink-muted)', textWrap: 'pretty' }}>
        {credit} · {license}
      </span>
    </div>
  )
}
