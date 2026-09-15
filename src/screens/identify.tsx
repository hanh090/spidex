/**
 * S05 Identify — the same filter engine as Explore, sequenced.
 *
 * Every step is skippable and the live count is always visible: in the field
 * the animal leaves, so the user must be able to bail out at any point with
 * whatever they have. This screen holds no filtering logic of its own.
 *
 * The step is a real stepper: it states where you are, it can go back, and the
 * options sit in the middle of the screen rather than pinned under the header
 * with the rest of the screen left empty. Going back one step is the most
 * common correction in a key — you realise the bird was larger than you
 * thought — and it previously had no control at all.
 */
import { useMemo } from 'react'
import { useScreenState } from '../app/use-screen-state'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { useActivePack } from '../features/guide/use-pack'
import { TraitControl } from '../features/guide/trait-renderers'
import { SpeciesGrid } from '../features/guide/species-grid'
import { clearAll, toggle, type Selection } from '../features/guide/filter-engine'
import { filterWithRelax } from '../features/guide/filter-relax'
import { RelaxBanner } from '../features/guide/relax-banner'
import { Button, EmptyState } from '../ui/primitives'
import { IconChevron } from '../ui/icons'
import { resolve } from '../data/localized'
import { formatNumber } from '../i18n/format'

export function Identify() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { pack, species, baseUrl, loading } = useActivePack()

  /*
   * The key survives leaving the screen. Half-identifying a bird, tapping
   * Explore to check a similar species, and returning to step 1 with every
   * answer discarded is the worst thing this screen can do — in the field the
   * animal is already gone.
   */
  const scope = `identify:${pack?.id ?? 'none'}`
  const [selection, setSelection] = useScreenState<Selection>(`${scope}:selection`, {})
  const [step, setStep] = useScreenState(`${scope}:step`, 0)
  const [showResults, setShowResults] = useScreenState(`${scope}:showResults`, false)

  const schema = pack?.manifest.traitSchema
  const { results, relaxedKey } = useMemo(() => {
    if (!schema) return { results: species, relaxedKey: null as string | null }
    const r = filterWithRelax(schema, selection, species)
    return { results: r.results, relaxedKey: r.relaxedKey }
  }, [schema, selection, species])

  if (loading) return null
  if (!pack || !schema) return <EmptyState title={t('identify.empty')} fix={t('identify.emptyFix')} />

  const traits = schema.traits
  const done = step >= traits.length

  const restart = () => { setSelection(clearAll()); setStep(0); setShowResults(false) }

  if (showResults || done) {
    return (
      <div style={{ height: '100%', width: '100%', display: 'flex', flexDirection: 'column' }}>
        <div style={{
          flex: 'none', padding: 'var(--space-3) var(--gutter-sm)',
          display: 'flex', alignItems: 'baseline', gap: 'var(--space-3)',
        }}>
          <h1 className="t-heading" style={{ margin: 0, flex: 1 }}>
            {t('identify.results', { count: results.length, n: formatNumber(results.length) })}
          </h1>
          <Button variant="inline" onClick={restart}>{t('identify.startOver')}</Button>
        </div>
        <div className="scroll-y" style={{ flex: 1, minHeight: 0, width: '100%' }}>
          <RelaxBanner
            schema={schema}
            relaxedKey={relaxedKey}
            resultCount={results.length}
            selection={selection}
            onRestore={setSelection}
          />
          <SpeciesGrid species={results} baseUrl={baseUrl} />
        </div>
        {results.length >= 2 && results.length <= 6 && (
          <div style={{ flex: 'none', width: '100%', padding: 'var(--space-3) var(--gutter-sm) var(--space-4)' }}>
            <Button variant="primary" full
              onClick={() => navigate(`/compare?ids=${results.slice(0, 3).map((s) => s.uid).join(',')}`)}>
              {t('identify.compareTop')}
            </Button>
          </div>
        )}
      </div>
    )
  }

  const trait = traits[step]!

  return (
    <div style={{ height: '100%', width: '100%', display: 'flex', flexDirection: 'column' }}>

      {/* Where you are, and the way back out. */}
      <div style={{ flex: 'none', padding: 'var(--space-3) var(--gutter-sm) 0' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
          <button
            onClick={() => setStep((s) => s - 1)}
            disabled={step === 0}
            aria-label={t('identify.previousStep')}
            style={{
              width: 40, height: 40, minHeight: 40, flex: 'none',
              display: 'grid', placeItems: 'center', borderRadius: 'var(--radius-chip)',
              border: `var(--hair) solid ${step === 0 ? 'var(--line)' : 'var(--ink)'}`,
              color: step === 0 ? 'var(--ink-muted)' : 'var(--ink)',
              cursor: step === 0 ? 'default' : 'pointer',
            }}
          >
            <span style={{ transform: 'rotate(180deg)', display: 'flex' }}><IconChevron size={18} /></span>
          </button>

          <span className="t-meta" style={{ color: 'var(--ink-muted)' }}>
            {t('identify.step', { n: step + 1, total: traits.length })}
          </span>

          <Button variant="inline" onClick={() => setShowResults(true)} style={{ marginLeft: 'auto' }}>
            {t('identify.skipAll')}
          </Button>
        </div>

        <StepProgress current={step} total={traits.length} label={t('identify.step', { n: step + 1, total: traits.length })} />
      </div>

      {/*
        Centred, not top-pinned. The options are the whole content of this
        screen; pinning them under the header left ~450px of dead space with
        the action stranded at the bottom edge.
      */}
      <div
        className="scroll-y"
        style={{
          flex: 1, minHeight: 0, padding: 'var(--space-4) var(--gutter-sm)',
          display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 'var(--space-6)',
        }}
      >
        <div>
          <h1 className="t-title" style={{ margin: '0 0 var(--space-4)' }}>{resolve(trait.label)}</h1>
          <TraitControl
            trait={trait}
            selected={selection[trait.key] ?? []}
            onToggle={(v) => setSelection(toggle(schema, selection, trait.key, v))}
            packBaseUrl={baseUrl}
            density="large"
          />
        </div>
      </div>

      <div style={{
        flex: 'none', padding: 'var(--space-3) var(--gutter-sm)',
        paddingBottom: 'max(var(--space-4), env(safe-area-inset-bottom))',
        display: 'flex', flexDirection: 'column', gap: 'var(--space-2)',
      }}>
        {/* Says what it does. On a middle step that is "next", not "see matches". */}
        <Button variant="primary" full onClick={() => setStep((s) => s + 1)}>
          {step === traits.length - 1
            ? t('identify.seeMatches', { count: results.length, n: formatNumber(results.length) })
            : t('identify.nextStep', { n: formatNumber(results.length) })}
        </Button>
        <Button variant="inline" onClick={() => setStep((s) => s + 1)}>{t('identify.skipStep')}</Button>
      </div>
    </div>
  )
}

/** One segment per step. Filled behind you, outlined ahead. */
function StepProgress({ current, total, label }: { current: number; total: number; label: string }) {
  return (
    <div
      role="progressbar"
      aria-valuenow={current + 1}
      aria-valuemin={1}
      aria-valuemax={total}
      aria-label={label}
      style={{ display: 'flex', gap: 'var(--space-1)', marginTop: 'var(--space-3)' }}
    >
      {Array.from({ length: total }, (_, i) => (
        <span
          key={i}
          style={{
            flex: 1, height: 4,
            background: i <= current ? 'var(--accent)' : 'var(--line)',
            transition: 'background var(--move-push) var(--ease)',
          }}
        />
      ))}
    </div>
  )
}
