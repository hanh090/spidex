/**
 * A pack, presented the way a store presents a product.
 *
 * One component for both places a pack is offered — first run and the library
 * — because they were drifting apart: the library showed a version the
 * onboarding did not, the onboarding showed plates the library did not, and a
 * blanket "fixture content" note was printed over every pack whether or not it
 * was true.
 *
 * The card's ground is the pack's own plates, blurred and enlarged, with three
 * species riding on it as overlapping avatars. Two reasons, neither cosmetic:
 *
 *   - Seven packs in a list were seven identical rectangles. Taking the ground
 *     colour from each pack's contents makes them distinguishable at a glance,
 *     and the colour means something rather than being assigned.
 *   - Overlapping avatars read as "a collection of things"; three tiles in a
 *     row read as three things. A pack is the former.
 *
 * The previous strip gave three plates equal billing across a full-width row,
 * which made the card ~330px tall — two packs per screen. This is ~195px.
 */
import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { PackManifest } from '../../data/pack-manifest'
import type { PackPreview } from '../../data/pack-preview'
import { resolve } from '../../data/localized'
import { formatBytes, formatNumber } from '../../i18n/format'

export interface PackCardProps {
  manifest: PackManifest
  preview: PackPreview[]
  /** The download / use / remove controls. */
  actions: ReactNode
  /** Pill beside the name: "In use", "Update". */
  status?: { label: string; tone: 'ok' | 'warn' | 'accent' }
  /** Heading level, so each screen keeps a correct outline. */
  headingLevel?: 'h2' | 'h3'
  /** Progress bar while installing. */
  progress?: { done: number; total: number; label: string } | null
}

export function PackCard({
  manifest, preview, actions, status, headingLevel: H = 'h3', progress,
}: PackCardProps) {
  const { t } = useTranslation()
  const name = resolve(manifest.name)

  /*
   * A plate URL can 404 — a catalogue entry whose images were never shipped
   * resolves to the SPA shell, which an <img> renders as a broken icon. The
   * card drops any plate that fails rather than advertising a pack with three
   * broken thumbnails, and falls back to no ground at all.
   */
  const [broken, setBroken] = useState<ReadonlySet<string>>(() => new Set())
  const usable = preview.filter((p) => !broken.has(p.url))
  const markBroken = (url: string) =>
    setBroken((prev) => (prev.has(url) ? prev : new Set(prev).add(url)))

  const ground = usable[0]?.url
  /*
   * Every plate we could find is a shared fallback drawing. Saying so is the
   * honest version of the blanket "fixture content" note this replaced: that
   * one was printed over every pack, including packs whose plates are real.
   */
  const placeholderPlates = usable.length > 0 && usable.every((p) => p.archetype)

  return (
    <article
      style={{
        position: 'relative', isolation: 'isolate',
        /*
         * One edge weight for every card. An ink border on the mounted pack
         * put a near-black rectangle around the one card that already says
         * "In use" in a filled pill — two signals for one state, and the
         * heavier of the two fighting a soft blurred ground.
         */
        border: 'var(--hair) solid var(--line)',
        borderRadius: 'var(--radius-card)', overflow: 'hidden',
        background: 'var(--paper)',
      }}
    >
      {ground && <BlurredGround src={ground} onError={() => markBroken(ground)} />}

      <div style={{ padding: 'var(--space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
          {usable.length > 0 && <AvatarStack preview={usable} onError={markBroken} />}
          <div style={{ minWidth: 0, flex: 1 }}>
            <H className="t-heading" style={{ margin: 0, textWrap: 'balance' }}>{name}</H>
            <div className="t-meta" style={{ color: 'var(--ink-muted)', marginTop: 2 }}>
              {manifest.region} · v{formatNumber(manifest.version)}
            </div>
          </div>
          {status && (
            <span
              style={{
                flex: 'none', font: 'var(--type-label)', fontWeight: 600,
                padding: '4px 10px', borderRadius: 'var(--radius-chip)',
                background: status.tone === 'ok' ? 'var(--ok)'
                  : status.tone === 'warn' ? 'var(--warn)' : 'var(--accent)',
                color: 'var(--paper)',
              }}
            >
              {status.label}
            </span>
          )}
        </div>

        {progress && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-3)', marginBottom: 6 }}>
              <span className="t-meta">{progress.label}</span>
              {progress.total > 1 && (
                <span className="t-unit" style={{ color: 'var(--ink-muted)' }}>
                  {formatNumber(progress.done)} / {formatNumber(progress.total)}
                </span>
              )}
            </div>
            <div
              role="progressbar"
              aria-label={progress.label}
              aria-valuenow={progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : undefined}
              aria-valuemin={0}
              aria-valuemax={100}
              style={{ height: 4, background: 'var(--line)', overflow: 'hidden' }}
            >
              <div style={{
                width: progress.total > 0 ? `${(progress.done / progress.total) * 100}%` : '100%',
                height: '100%', background: 'var(--accent)',
                transition: 'width var(--move-push) var(--ease)',
              }} />
            </div>
          </div>
        )}

        {/* The three figures a download decision actually turns on. */}
        {/* No rules above and below. The card edge already encloses this
            group; a second and third line inside it divides a card that is
            only four elements tall into four boxed compartments. */}
        <dl style={{ display: 'flex', gap: 'var(--space-6)', margin: 0 }}>
          {/* Two figures, not three. The pack licence is catalogue metadata, not
              something a download decision turns on — the attribution that
              matters legally is per-image and lives on the species page. */}
          <Figure value={formatNumber(manifest.speciesCount)} label={t('packs.figureSpecies')} />
          <Figure value={formatBytes(manifest.sizeBytes.thumb)} label={t('packs.figureSize')} />
        </dl>

        {placeholderPlates && (
          <p className="t-meta" style={{ color: 'var(--ink-muted)', margin: 0, textWrap: 'pretty' }}>
            {t('packs.placeholderPlates')}
          </p>
        )}

        <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', alignItems: 'center' }}>
          {actions}
        </div>
      </div>
    </article>
  )
}

/**
 * The pack's own plate as the card's ground.
 *
 * Scaled well past the frame because the plates are specimens on near-white
 * mounts: at natural size the blur returns mostly mount, and every card comes
 * out the same pale colour. Zooming in puts the animal's own colour across the
 * card, which is the entire point.
 *
 * The veil ends at solid --paper, so type below it always lands on flat
 * ground — and because it is a token, the card works in all four themes
 * without a second definition.
 */
function BlurredGround({ src, onError }: { src: string; onError: () => void }) {
  return (
    <div className="pack-ground" aria-hidden style={{ position: 'absolute', inset: 0, zIndex: -1, overflow: 'hidden' }}>
      <img
        src={src}
        alt=""
        aria-hidden
        loading="lazy"
        decoding="async"
        onError={onError}
        style={{
          width: '100%', height: '100%', objectFit: 'cover',
          filter: 'blur(22px) saturate(1.8)', transform: 'scale(2.2)',
        }}
      />
      <div style={{
        position: 'absolute', inset: 0,
        background: 'linear-gradient(to bottom, color-mix(in srgb, var(--paper) 42%, transparent), color-mix(in srgb, var(--paper) 92%, transparent) 62%, var(--paper))',
      }} />
    </div>
  )
}

/** Overlapping plates — "here is what is inside", not "here are three things". */
function AvatarStack({ preview, onError }: { preview: PackPreview[]; onError: (url: string) => void }) {
  return (
    <span aria-hidden style={{ display: 'flex', flex: 'none' }}>
      {preview.slice(0, 3).map((p, i) => (
        <img
          key={p.url}
          src={p.url}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => onError(p.url)}
          style={{
            width: 52, height: 52, borderRadius: '50%', objectFit: 'cover',
            border: '2.5px solid var(--paper)', background: 'var(--panel)',
            marginLeft: i === 0 ? 0 : -16,
            boxShadow: '0 2px 7px rgba(0,0,0,0.2)',
          }}
        />
      ))}
    </span>
  )
}

function Figure({ value, label, size = 16 }: { value: string; label: string; size?: number }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
      {/* dd before dt in the DOM would read wrong; order is visual only. */}
      <dt className="t-meta" style={{ color: 'var(--ink-muted)', order: 2 }}>{label}</dt>
      <dd
        className="t-money"
        style={{ margin: 0, order: 1, fontSize: size, lineHeight: 1.25, overflowWrap: 'anywhere' }}
      >
        {value}
      </dd>
    </div>
  )
}
