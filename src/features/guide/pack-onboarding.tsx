/**
 * First run: no pack is mounted, so there is nothing to explore yet.
 *
 * This is the only screen that has to sell something, and what it sells is the
 * one claim that matters in the field — the guide keeps working when the
 * signal does not. So it leads with the specimens rather than with prose: a
 * band of real plates pulled from the packs on offer, the combined species
 * count, and two cards that show you what is inside before you spend 200MB.
 *
 * Every string comes from the interface bundle or the pack's own manifest.
 * Nothing about a pack — its name, count or region — is written in this file,
 * because a pack name written here would be written in one language and stay
 * that way in all three.
 *
 * The plate band is decorative: it is aria-hidden, it never blocks the cards,
 * and it is suppressed entirely in the Sun theme, where glare legibility beats
 * ornament.
 */
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { Button, Meta } from '../../ui/primitives'
import { FEATURED } from '../../data/pack-catalogue'
import { downloadPack, fetchManifest, type Progress } from '../../data/pack-download'
import { fetchPackPreview, type PackPreview } from '../../data/pack-preview'
import { setActivePackId } from '../../data/db'
import type { PackManifest } from '../../data/pack-manifest'
import { packBaseUrl } from './use-pack'
import { resolve } from '../../data/localized'
import { formatBytes, formatNumber } from '../../i18n/format'

/** Plates shown behind the headline. Four at phone width, no more. */
const HERO_PLATES = 3

interface Offer {
  id: string
  manifest: PackManifest
  preview: PackPreview[]
}

export function PackOnboarding() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [offers, setOffers] = useState<Offer[]>([])
  const [installing, setInstalling] = useState<string | null>(null)
  const [progress, setProgress] = useState<Progress | null>(null)
  const [problem, setProblem] = useState<string | null>(null)

  // Manifests come from the bundled packs, so this works with no network.
  // Previews are best-effort and never gate the cards.
  useEffect(() => {
    const ac = new AbortController()
    let cancelled = false
    void (async () => {
      const found = await Promise.all(
        FEATURED.map(async (id) => {
          const res = await fetchManifest(packBaseUrl(id))
          if (!res.ok) return null
          const preview = await fetchPackPreview(packBaseUrl(id), 3, ac.signal)
          return { id, manifest: res.manifest, preview }
        }),
      )
      if (!cancelled) setOffers(found.filter(Boolean) as Offer[])
    })()
    return () => { cancelled = true; ac.abort() }
  }, [])

  const install = async (id: string) => {
    setInstalling(id)
    setProblem(null)
    setProgress({ phase: 'manifest', done: 0, total: 0 })
    try {
      const res = await downloadPack({
        baseUrl: packBaseUrl(id),
        tier: 'thumb',
        acknowledgedNoPersist: true,
        onProgress: setProgress,
      })
      if (res.ok) {
        await setActivePackId(id)
        window.location.reload()
        return
      }
      setProblem(res.error ?? t('packs.invalid', { detail: res.issues?.[0]?.path ?? '' }))
    } catch (e) {
      setProblem((e as Error).message)
    }
    setInstalling(null)
    setProgress(null)
  }

  const totalSpecies = offers.reduce((n, o) => n + o.manifest.speciesCount, 0)

  /*
   * Interleave the packs so the band is not one taxon then the other, and cap
   * it: past four, each plate is a 90px sliver at phone width and reads as
   * texture rather than as a specimen.
   */
  const plates = offers
    .flatMap((o) => o.preview.map((p, i) => ({ p, i })))
    .sort((a, b) => a.i - b.i)
    .map(({ p }) => p)
    .slice(0, HERO_PLATES)

  return (
    <div className="scroll-y" style={{ height: '100%', width: '100%' }}>
      <div style={{ maxWidth: 600, margin: '0 auto', paddingBottom: 'var(--space-8)' }}>

        <Hero plates={plates} totalSpecies={totalSpecies} packCount={offers.length} />

        <div style={{ padding: '0 var(--gutter-sm)' }}>
          {installing && progress && (
            <InstallStatus phase={progress.phase} done={progress.done} total={progress.total} />
          )}

          {problem && (
            <p
              role="alert"
              className="t-body"
              style={{
                background: 'var(--alert)', border: 'var(--hair) solid var(--warn)',
                borderRadius: 'var(--radius-tap)', padding: 'var(--space-3)',
                margin: '0 0 var(--space-4)',
              }}
            >
              {problem}
            </p>
          )}

          <div style={{ marginBottom: 'var(--space-3)' }}>
            <Meta>{t('onboarding.choose')}</Meta>
          </div>

          <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
            {offers.map((offer, i) => (
              <PackCard
                key={offer.id}
                offer={offer}
                primary={i === 0}
                busy={installing !== null}
                installing={installing === offer.id}
                onInstall={() => void install(offer.id)}
              />
            ))}
          </div>

          <div style={{ marginTop: 'var(--space-6)', textAlign: 'center' }}>
            <Button variant="inline" onClick={() => navigate('/library')}>
              {t('onboarding.browseAll')}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * The plate band plus the claim.
 *
 * The plates sit behind a wash that ends in solid --paper, so the type below
 * always lands on flat ground no matter what colour the specimens are.
 */
function Hero({ plates, totalSpecies, packCount }: {
  plates: PackPreview[]
  totalSpecies: number
  packCount: number
}) {
  const { t } = useTranslation()
  return (
    <header style={{ position: 'relative', marginBottom: 'var(--space-6)' }}>
      <div
        className="hero-plates"
        aria-hidden
        style={{
          position: 'absolute', inset: '0 0 auto 0', height: 260, overflow: 'hidden',
          display: 'grid', gridTemplateColumns: `repeat(${Math.max(2, plates.length)}, 1fr)`,
          background: 'var(--panel)',
        }}
      >
        {plates.map((p) => (
          <img
            key={p.url}
            src={p.url}
            alt=""
            loading="eager"
            decoding="async"
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          />
        ))}
        {/* Wash to flat ground. Two stops: the plates stay readable at the top. */}
        <div style={{
          position: 'absolute', inset: 0,
          background: 'linear-gradient(to bottom, color-mix(in srgb, var(--paper) 35%, transparent) 0%, color-mix(in srgb, var(--paper) 78%, transparent) 55%, var(--paper) 100%)',
        }} />
      </div>

      <div style={{
        position: 'relative',
        padding: 'var(--space-8) var(--gutter-sm) 0',
        display: 'flex', flexDirection: 'column', gap: 'var(--space-4)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
          <img src="/icons/icon.svg" alt="" width={44} height={44} style={{ display: 'block', flex: 'none' }} />
          <div style={{ minWidth: 0 }}>
            <div className="t-heading">{t('app.name')}</div>
            <Meta>{t('app.tagline')}</Meta>
          </div>
        </div>

        <h1 className="t-display" style={{ margin: 0, textWrap: 'balance' }}>
          {t('onboarding.headline')}
        </h1>

        <p className="t-body" style={{ color: 'var(--ink-muted)', margin: 0, maxWidth: '42ch', textWrap: 'pretty' }}>
          {t('onboarding.lede')}
        </p>

        {/* Real figures, summed from the manifests actually on offer. */}
        {totalSpecies > 0 && (
          <dl style={{
            display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2) var(--space-6)',
            margin: 0, paddingTop: 'var(--space-2)',
            borderTop: 'var(--hair) solid var(--line)',
          }}>
            <Stat value={formatNumber(totalSpecies)} label={t('onboarding.statSpecies')} />
            <Stat value={formatNumber(packCount)} label={t('onboarding.statChecklists')} />
            <Stat value={t('onboarding.statOfflineValue')} label={t('onboarding.statOffline')} />
          </dl>
        )}
      </div>
    </header>
  )
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <dt className="t-meta" style={{ color: 'var(--ink-muted)', order: 2 }}>{label}</dt>
      <dd className="t-money" style={{ margin: 0, order: 1 }}>{value}</dd>
    </div>
  )
}

function PackCard({ offer, primary, busy, installing, onInstall }: {
  offer: Offer
  primary: boolean
  busy: boolean
  installing: boolean
  onInstall: () => void
}) {
  const { t } = useTranslation()
  const { manifest, preview } = offer
  const size = manifest.sizeBytes?.thumb

  return (
    <article style={{
      border: 'var(--hair) solid var(--line)', background: 'var(--panel)',
      borderRadius: 'var(--radius-tap)', overflow: 'hidden',
      display: 'flex', flexDirection: 'column',
    }}>
      {/* What you are actually getting, before you spend the bandwidth. */}
      {preview.length > 0 && (
        <div aria-hidden style={{ display: 'grid', gridTemplateColumns: `repeat(${preview.length}, 1fr)`, gap: 'var(--hair)' }}>
          {preview.map((p) => (
            <img
              key={p.url}
              src={p.url}
              alt=""
              loading="lazy"
              decoding="async"
              style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', display: 'block', background: 'var(--paper)' }}
            />
          ))}
        </div>
      )}

      <div style={{ padding: 'var(--space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
        <h2 className="t-heading" style={{ margin: 0 }}>{resolve(manifest.name)}</h2>
        <Meta>
          {/* `count` picks the plural; `n` carries Intl-formatted digits. */}
          {t('packs.speciesCount', { count: manifest.speciesCount, n: formatNumber(manifest.speciesCount) })}
          {' · '}{manifest.region}
          {size ? ` · ${formatBytes(size)}` : ''}
        </Meta>
        <Button
          variant={primary ? 'primary' : 'secondary'}
          full
          disabled={busy}
          onClick={onInstall}
          style={{ marginTop: 'var(--space-2)' }}
        >
          {installing ? t('onboarding.installing') : t('onboarding.install')}
        </Button>
      </div>
    </article>
  )
}

function InstallStatus({ phase, done, total }: { phase: Progress['phase']; done: number; total: number }) {
  const { t } = useTranslation()
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : null
  return (
    <div
      role="status"
      style={{
        border: 'var(--hair) solid var(--accent)', background: 'var(--panel)',
        borderRadius: 'var(--radius-tap)', padding: 'var(--space-4)',
        marginBottom: 'var(--space-4)',
      }}
    >
      <div className="t-heading" style={{ color: 'var(--accent)', marginBottom: 'var(--space-2)' }}>
        {t(`packs.phase.${phase}`)}
      </div>
      {pct !== null && (
        <>
          <div
            role="progressbar"
            aria-valuenow={pct}
            aria-valuemin={0}
            aria-valuemax={100}
            style={{ height: 6, background: 'var(--line)', overflow: 'hidden' }}
          >
            <div style={{
              width: `${pct}%`, height: '100%', background: 'var(--accent)',
              transition: 'width var(--move-push) var(--ease)',
            }} />
          </div>
          <div className="t-unit" style={{ marginTop: 'var(--space-1)', color: 'var(--ink-muted)' }}>
            {formatNumber(done)} / {formatNumber(total)}
          </div>
        </>
      )}
      <div style={{ marginTop: 'var(--space-2)' }}>
        <Meta>{t('onboarding.installNote')}</Meta>
      </div>
    </div>
  )
}
