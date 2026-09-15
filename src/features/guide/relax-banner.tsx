/**
 * Zero-match recovery banner.
 *
 * Explore and Identify both relax filters, so both must say so — a user who
 * sees results that contradict their answers with no explanation will not
 * trust the next answer either.
 */
import { useTranslation } from 'react-i18next'
import type { TraitSchema } from '../../data/pack-manifest'
import { Button } from '../../ui/primitives'
import { resolve } from '../../data/localized'
import type { Selection } from './filter-engine'

interface Props {
  schema: TraitSchema
  relaxedKey: string | null
  /** Suppressed when nothing was recovered — the empty state speaks instead. */
  resultCount: number
  selection: Selection
  onRestore: (next: Selection) => void
}

export function RelaxBanner({ schema, relaxedKey, resultCount, selection, onRestore }: Props) {
  const { t } = useTranslation()
  if (!relaxedKey || resultCount === 0) return null
  const trait = schema.traits.find((tr) => tr.key === relaxedKey)
  if (!trait) return null

  return (
    <div style={{
      margin: '0 var(--gutter-sm)', padding: 'var(--space-3)',
      background: 'var(--alert)', border: 'var(--hair) solid var(--warn)',
      display: 'flex', flexDirection: 'column', gap: 'var(--space-2)',
    }}>
      <span className="t-body">{t('explore.relaxed', { trait: resolve(trait.label) })}</span>
      <Button
        variant="inline"
        onClick={() => onRestore({ ...selection, [trait.key]: [] })}
        style={{ alignSelf: 'flex-start' }}
      >
        {t('explore.keepRelaxed', { trait: resolve(trait.label) })}
      </Button>
    </div>
  )
}
