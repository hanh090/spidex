/**
 * A pack, presented the way a store presents a product.
 *
 * One component for both places a pack is offered — first run and the library
 * — because they were drifting apart: the library showed a version number the
 * onboarding did not, the onboarding showed plates the library did not, and a
 * blanket "fixture content" note was printed over every pack in the library
 * whether or not it was true.
 *
 * What a user actually decides on is: what does it look like, how much of my
 * phone does it take, and is it already here. So the card leads with plates,
 * states the three figures as figures, and puts status where the eye lands
 * before the buttons.
 */
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { PackManifest } from '../../data/pack-manifest'
import type { PackPreview } from '../../data/pack-preview'
import { resolve } from '../../data/localized'
import { formatBytes, formatNumber } from '../../i18n/format'

export interface PackCardProps {
  manifest: PackManifest
  preview: PackPreview[]
  /** Rendered under the stats — the download / use / remove controls. */
  actions: ReactNode
  /** Shown as a pill over the plates: "In use", "Downloading…". */
  status?: { label: string; tone: 'ok' | 'warn' | 'accent' }
  /** Heading level, so each screen keeps a correct outline. */
  headingLevel?: 'h2' | 'h3'
  /** Progress bar under the plates while installing. */
  progress?: { done: number; total: number; label: string } | null
  /** Marks the pack currently mounted; the card sits on panel rather than paper. */
  current?: boolean
}

export function PackCard({
  manifest, preview, actions, status, headingLevel: H = 'h3', progress, current,
}: PackCardProps) {
  const { t } = useTranslation()
  const name = resolve(manifest.name)

  return (
    <article
      style={{
        border: `var(--hair) solid ${current ? 'var(--ink)' : 'var(--line)'}`,
        background: current ? 'var(--panel)' : 'var(--paper)',
        borderRadius: 'var(--radius-tap)', overflow: 'hidden',
        display: 'flex', flexDirection: 'column',
      }}
    >
      {preview.length > 0 && (
        <div style={{ position: 'relative' }}>
          <div
            aria-hidden
            style={{
              display: 'grid',
              gridTemplateColumns: `repeat(${preview.length}, 1fr)`,
              gap: 'var(--hair)',
              background: 'var(--line)',
            }}
          >
            {preview.map((p) => (
              <img
                key={p.url}
                src={p.url}
                alt=""
                loading="lazy"
                decoding="async"
                style={{
                  width: '100%', aspectRatio: '1', objectFit: 'cover',
                  display: 'block', background: 'var(--panel)',
                }}
              />
            ))}
          </div>
          {status && (
            <span
              style={{
                position: 'absolute', top: 'var(--space-2)', right: 'var(--space-2)',
                font: 'var(--type-label)', fontWeight: 600,
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
      )}

      {progress && (
        <div style={{ padding: 'var(--space-3) var(--space-4) 0' }}>
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

      <div style={{ padding: 'var(--space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        <div>
          <H className="t-heading" style={{ margin: 0, textWrap: 'balance' }}>{name}</H>
          <div className="t-meta" style={{ color: 'var(--ink-muted)', marginTop: 2 }}>
            {manifest.region} · v{formatNumber(manifest.version)}
          </div>
        </div>

        {/* The three figures a download decision actually turns on. */}
        <dl style={{
          display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
          gap: 'var(--space-2)', margin: 0,
          borderTop: 'var(--hair) solid var(--line)',
          borderBottom: 'var(--hair) solid var(--line)',
          padding: 'var(--space-3) 0',
        }}>
          <Figure
            value={formatNumber(manifest.speciesCount)}
            label={t('packs.figureSpecies')}
          />
          <Figure
            value={formatBytes(manifest.sizeBytes.thumb)}
            label={t('packs.figureSize')}
          />
          {/* A licence is an identifier, not a quantity — it does not get the
              figure size, and it must be allowed to break. */}
          <Figure value={manifest.license} label={t('packs.figureLicence')} size={13} />
        </dl>

        {/* Provenance from the pack's own plates, rather than a blanket claim
            printed over every pack whether or not it was true. */}
        {preview[0]?.credit && (
          <p className="t-meta" style={{ color: 'var(--ink-muted)', margin: 0, textWrap: 'pretty' }}>
            {preview[0].credit}
          </p>
        )}

        <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', alignItems: 'center' }}>
          {actions}
        </div>
      </div>
    </article>
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
