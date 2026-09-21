/**
 * The filter rail.
 *
 * Replaces the collapsed filter bar, which could only be operated by opening a
 * modal sheet — every filter decision, including undoing one, cost a round
 * trip. Here each selected value is its own chip and removes itself on tap, so
 * the common case (drop one wrong guess, keep the rest) never opens anything.
 * The sheet is still there, reached by the leading Filters chip, for picking a
 * value you have not chosen yet.
 *
 * The rail scrolls horizontally and never wraps: a wrapping rail changes the
 * height of the screen as you filter, which moves the results out from under
 * the thumb.
 */
import { useTranslation } from 'react-i18next'
import type { TraitSchema } from '../../data/pack-manifest'
import { resolve } from '../../data/localized'
import { toggle, type Selection } from './filter-engine'
import { IconFilter, IconClose } from '../../ui/icons'
import { formatNumber } from '../../i18n/format'

export interface FilterTag {
  key: string
  label: string
  /** Colour traits carry their swatch into the chip, so the chip is the value. */
  swatch?: string
  remove: () => void
}

/** One tag per selected value, each independently removable. */
export function selectionTags(
  schema: TraitSchema | undefined,
  selection: Selection,
  onChange: (next: Selection) => void,
): FilterTag[] {
  if (!schema) return []
  return schema.traits.flatMap((trait) =>
    (selection[trait.key] ?? []).map((v) => {
      const opt = trait.options.find((o) => o.v === v)
      return {
        key: `${trait.key}:${v}`,
        label: resolve(opt?.label) || v,
        swatch: opt?.hex,
        remove: () => onChange(toggle(schema, selection, trait.key, v)),
      }
    }),
  )
}

interface Props {
  tags: FilterTag[]
  /** Trait names offered as shortcuts into the sheet when nothing is selected. */
  hints: string[]
  onOpenSheet: () => void
  onClearAll: () => void
}

export function FilterChips({ tags, hints, onOpenSheet, onClearAll }: Props) {
  const { t } = useTranslation()
  const active = tags.length

  return (
    <div
      role="group"
      aria-label={t('explore.filters')}
      className="scroll-x"
      style={{
        display: 'flex', gap: 'var(--space-2)', alignItems: 'center',
        padding: 'var(--space-3) var(--gutter-sm)',
        overflowX: 'auto', overflowY: 'hidden',
      }}
    >
      <button
        onClick={onOpenSheet}
        style={{
          ...chip,
          background: active ? 'var(--ink)' : 'var(--paper)',
          color: active ? 'var(--paper)' : 'var(--ink)',
          borderColor: active ? 'var(--ink)' : 'var(--ink-muted)',
        }}
      >
        <IconFilter size={15} />
        {t('explore.filters')}
        {active > 0 && (
          <span
            className="t-unit"
            style={{
              background: 'var(--accent)', color: 'var(--paper)',
              borderRadius: 'var(--radius-chip)', padding: '2px 7px', letterSpacing: 0,
            }}
          >
            {formatNumber(active)}
          </span>
        )}
      </button>

      {tags.map((tag) => (
        <button
          key={tag.key}
          onClick={tag.remove}
          aria-label={t('explore.removeFilter', { name: tag.label })}
          style={{
            ...chip,
            background: 'var(--panel)',
            color: 'var(--ink)',
            borderColor: 'var(--line)',
            paddingLeft: tag.swatch ? 'var(--space-2)' : 'var(--space-3)',
          }}
        >
          {tag.swatch && (
            <span
              aria-hidden
              style={{
                width: 12, height: 12, borderRadius: '50%', flex: 'none',
                background: tag.swatch, border: 'var(--hair) solid var(--line)',
              }}
            />
          )}
          {tag.label}
          <IconClose size={11} />
        </button>
      ))}

      {/* Nothing selected: name the traits, so the rail teaches what can be filtered. */}
      {active === 0 && hints.map((h) => (
        <button
          key={h}
          onClick={onOpenSheet}
          style={{ ...chip, background: 'var(--paper)', color: 'var(--ink-muted)', borderColor: 'var(--line)' }}
        >
          {h}
        </button>
      ))}

      {active > 1 && (
        <button
          onClick={onClearAll}
          style={{ ...chip, background: 'transparent', color: 'var(--accent)', borderColor: 'transparent' }}
        >
          {t('explore.clearAll')}
        </button>
      )}
    </div>
  )
}

const chip: React.CSSProperties = {
  flex: 'none',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 'var(--space-2)',
  height: 'var(--tap-min)',
  minHeight: 'var(--tap-min)',
  padding: '0 var(--space-3)',
  borderRadius: 'var(--radius-chip)',
  border: 'var(--hair) solid',
  font: 'var(--type-label)',
  fontSize: 14,
  whiteSpace: 'nowrap',
}
