/**
 * Trait control renderers, selected by `render` on the pack's trait schema.
 *
 * Adding a taxon means adding a renderer here — never a branch on taxonGroup
 * inside a screen. `referent-image` exists because bird size is judged against
 * a familiar bird, not a millimetre range.
 *
 * Two densities. `compact` packs the controls into the filter sheet, where
 * several traits share one scroll. `large` is the Identify stepper, where one
 * trait IS the screen: the options become the primary target, sized for a wet
 * gloved thumb rather than tucked under a heading.
 */
import type { Trait, TraitOption } from '../../../data/pack-manifest'
import { resolve } from '../../../data/localized'

export type TraitDensity = 'compact' | 'large'

interface Props {
  trait: Trait
  selected: string[]
  onToggle: (value: string) => void
  packBaseUrl: string
  density?: TraitDensity
}

export function TraitControl({ trait, selected, onToggle, packBaseUrl, density = 'compact' }: Props) {
  switch (trait.render) {
    case 'swatch':
      return <SwatchRow trait={trait} selected={selected} onToggle={onToggle} density={density} />
    case 'referent-image':
      return <ReferentRow trait={trait} selected={selected} onToggle={onToggle} packBaseUrl={packBaseUrl} density={density} />
    default:
      return <ChipRow trait={trait} selected={selected} onToggle={onToggle} density={density} />
  }
}

const rowStyle: React.CSSProperties = {
  display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)',
}

/** One option per row at phone width; two columns once there is room. */
const gridStyle: React.CSSProperties = {
  display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
  gap: 'var(--space-3)',
}

function label(o: TraitOption): string {
  return resolve(o.label) || o.v
}

type RowProps = Omit<Props, 'packBaseUrl'> & { density: TraitDensity }

function ChipRow({ trait, selected, onToggle, density }: RowProps) {
  const large = density === 'large'
  return (
    <div
      style={large ? gridStyle : rowStyle}
      role="group"
      aria-label={resolve(trait.label)}
    >
      {trait.options.map((o) => {
        const on = selected.includes(o.v)
        return (
          <button
            key={o.v}
            onClick={() => onToggle(o.v)}
            aria-pressed={on}
            style={{
              minHeight: large ? 'var(--tap-primary)' : 'var(--tap-min)',
              padding: large ? 'var(--space-3) var(--space-4)' : '0 var(--space-3)',
              font: 'var(--type-action)',
              fontSize: large ? 16 : 14,
              borderRadius: large ? 'var(--radius-tap)' : 'var(--radius-chip)',
              background: on ? 'var(--accent)' : 'var(--paper)',
              color: on ? 'var(--paper)' : 'var(--ink)',
              border: `var(--hair) solid ${on ? 'var(--accent)' : 'var(--line)'}`,
            }}
          >
            {label(o)}
          </button>
        )
      })}
    </div>
  )
}

function SwatchRow({ trait, selected, onToggle, density }: RowProps) {
  const large = density === 'large'
  const box = large ? 72 : 'var(--tap-min)'
  return (
    <div style={large ? gridStyle : rowStyle} role="group" aria-label={resolve(trait.label)}>
      {trait.options.map((o) => {
        const on = selected.includes(o.v)
        return (
          <button
            key={o.v}
            onClick={() => onToggle(o.v)}
            aria-pressed={on}
            aria-label={label(o)}
            title={large ? undefined : label(o)}
            style={{
              display: 'flex', flexDirection: large ? 'column' : 'row',
              alignItems: 'center', justifyContent: 'center', gap: 'var(--space-2)',
              /* A swatch IS its size — let the row wrap rather than shrink it
                 into an unreadable stripe. */
              flex: 'none',
              width: large ? undefined : 'var(--tap-min)',
              minHeight: large ? 'auto' : 'var(--tap-min)',
              padding: large ? 'var(--space-2)' : 0,
              background: large ? (on ? 'var(--panel)' : 'transparent') : (o.hex ?? 'var(--panel)'),
              border: large
                ? `var(--hair) solid ${on ? 'var(--accent)' : 'var(--line)'}`
                : (on ? '3px solid var(--accent)' : 'var(--hair) solid var(--line)'),
              borderRadius: large ? 'var(--radius-tap)' : 'var(--radius)',
              outline: !large && on ? 'var(--hair) solid var(--paper)' : 'none',
              outlineOffset: '-5px',
              color: 'var(--ink)',
            }}
          >
            {/* Large: the swatch is a sample beside its name, not a bare square. */}
            {large && (
              <span
                aria-hidden
                style={{
                  width: box, height: box, borderRadius: 'var(--radius-tap)',
                  background: o.hex ?? 'var(--panel)',
                  border: 'var(--hair) solid var(--line)', flex: 'none',
                }}
              />
            )}
            {large && <span className="t-body">{label(o)}</span>}
          </button>
        )
      })}
    </div>
  )
}

function ReferentRow({ trait, selected, onToggle, packBaseUrl, density }: Props & { density: TraitDensity }) {
  const large = density === 'large'
  return (
    <div style={large ? gridStyle : rowStyle} role="group" aria-label={resolve(trait.label)}>
      {trait.options.map((o) => {
        const on = selected.includes(o.v)
        return (
          <button
            key={o.v}
            onClick={() => onToggle(o.v)}
            aria-pressed={on}
            style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center',
              gap: large ? 'var(--space-2)' : 2,
              minHeight: 'var(--tap-min)',
              padding: large ? 'var(--space-3)' : 'var(--space-1) var(--space-2)',
              background: on ? 'var(--panel)' : 'transparent',
              border: `var(--hair) solid ${on ? 'var(--accent)' : 'var(--line)'}`,
              borderRadius: large ? 'var(--radius-tap)' : 'var(--radius)',
              color: 'var(--ink)',
            }}
          >
            {o.img && (
              <img
                src={`${packBaseUrl}/${o.img}`}
                alt=""
                width={large ? 96 : 34}
                height={large ? 72 : 26}
                style={{ display: 'block', objectFit: 'contain' }}
              />
            )}
            <span
              className={large ? 't-body' : 't-meta'}
              style={{ color: on ? 'var(--ink)' : 'var(--ink-muted)' }}
            >
              {label(o)}
            </span>
          </button>
        )
      })}
    </div>
  )
}
