/**
 * S02 Explore.
 *
 * Search sits at the top; filters sit directly under it as a horizontal rail
 * of chips, each selected value its own removable chip. Undoing one filter
 * decision costs a single tap and opens nothing — that was the workflow this
 * screen previously routed through a modal sheet.
 *
 * The sheet remains, reached from the leading Filters chip, for choosing a
 * value that is not yet on the rail. Results stay visible behind it, and zero
 * matches never dead-end: the least selective filter is relaxed and named.
 */
import { useMemo, useState } from 'react'
import { useScreenState } from '../app/use-screen-state'
import { useTranslation } from 'react-i18next'
import { EmptyState, Skeleton } from '../ui/primitives'
import { Sheet } from '../ui/sheet'
import { SpeciesGrid } from '../features/guide/species-grid'
import { PackOnboarding } from '../features/guide/pack-onboarding'
import { FilterChips, selectionTags } from '../features/guide/filter-chips'
import { TraitControl } from '../features/guide/trait-renderers'
import { useActivePack } from '../features/guide/use-pack'
import { clearAll, countSelected, toggle, type Selection } from '../features/guide/filter-engine'
import { filterWithRelax } from '../features/guide/filter-relax'
import { RelaxBanner } from '../features/guide/relax-banner'
import { search } from '../data/search-index'
import { resolve } from '../data/localized'
import { formatNumber } from '../i18n/format'

export function Explore() {
  const { t } = useTranslation()
  const { pack, species, baseUrl, loading } = useActivePack()

  /*
   * Filters and search survive leaving the screen. Narrowing 1,429 species to
   * a dozen candidates is the expensive half of the task, and tapping one of
   * those candidates is exactly when you want the rest still there on return.
   * Keyed by pack: a selection names trait keys from one pack's schema.
   */
  const scope = `explore:${pack?.id ?? 'none'}`
  const [selection, setSelection] = useScreenState<Selection>(`${scope}:selection`, {})
  const [query, setQuery] = useScreenState(`${scope}:query`, '')
  // The sheet is a transient overlay, not a place — it should not reopen itself.
  const [sheetOpen, setSheetOpen] = useState(false)

  const schema = pack?.manifest.traitSchema

  const { results, relaxedKey } = useMemo(() => {
    if (!schema) return { results: species, relaxedKey: null as string | null }
    // Search first, then traits — a typed name is a stronger signal than a chip.
    const base = query.trim()
      ? (() => {
          const rank = new Map(search(species, query).map((h, i) => [h.id, i]))
          return species.filter((s) => rank.has(s.id)).sort((a, b) => rank.get(a.id)! - rank.get(b.id)!)
        })()
      : species
    const r = filterWithRelax(schema, selection, base)
    return { results: r.results, relaxedKey: r.relaxedKey }
  }, [schema, species, selection, query])

  const tags = useMemo(
    () => selectionTags(schema, selection, setSelection),
    [schema, selection],
  )

  if (loading) {
    return (
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
        gap: 'var(--space-4) var(--space-3)', padding: 'var(--gutter-sm)',
      }}>
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i}>
            <Skeleton height={112} />
            <div style={{ height: 8 }} />
            <Skeleton height={14} width="80%" />
          </div>
        ))}
      </div>
    )
  }

  if (!pack || !schema) return <PackOnboarding />

  const active = countSelected(selection)
  const hints = schema.traits.slice(0, 3).map((tr) => resolve(tr.label))

  return (
    <div style={{ height: '100%', width: '100%', display: 'flex', flexDirection: 'column', position: 'relative' }}>

      <div style={{ flex: 'none', background: 'var(--panel)', borderBottom: 'var(--hair) solid var(--line)' }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 'var(--space-3)',
          height: 48, margin: 'var(--space-3) var(--gutter-sm) 0',
          background: 'var(--paper)', border: 'var(--hair) solid var(--ink)',
          borderRadius: 'var(--radius-tap)', padding: '0 var(--space-4)',
        }}>
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
            <circle cx="7.5" cy="7.5" r="5.5" /><path d="M12 12L16.5 16.5" />
          </svg>
          <input
            id="explore-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('explore.searchPlaceholder')}
            aria-label={t('explore.searchPlaceholder')}
            /* 16px is the floor: iOS Safari zooms the viewport on focus below it. */
            style={{
              border: 0, background: 'transparent', outline: 'none',
              fontSize: 16, fontWeight: 500, width: '100%', minWidth: 0, color: 'var(--ink)',
            }}
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              aria-label={t('explore.clearSearch')}
              style={{ minHeight: 0, color: 'var(--ink-muted)', flex: 'none' }}
            >
              ✕
            </button>
          )}
        </div>

        <FilterChips
          tags={tags}
          hints={hints}
          onOpenSheet={() => setSheetOpen(true)}
          onClearAll={() => setSelection(clearAll())}
        />
      </div>

      <div className="scroll-y" style={{ flex: 1, minHeight: 0 }}>
        <div style={{
          display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
          gap: 'var(--space-3)', padding: 'var(--space-3) var(--gutter-sm) 0',
        }}>
          <span className="t-meta" style={{ color: 'var(--ink-muted)' }}>{t('explore.results')}</span>
          <span className="t-unit" style={{ color: 'var(--ink-muted)' }}>
            {t('explore.shown', {
              shown: formatNumber(results.length), total: formatNumber(species.length),
            })}
          </span>
        </div>

        <RelaxBanner
          schema={schema}
          relaxedKey={relaxedKey}
          resultCount={results.length}
          selection={selection}
          onRestore={setSelection}
        />

        {results.length === 0
          ? <EmptyState title={t('explore.noMatch')} fix={t('explore.noMatchFix')} />
          : <SpeciesGrid species={results} baseUrl={baseUrl} />}
      </div>

      <Sheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        title={t('explore.filters')}
        status={
          <span className="t-unit" style={{ color: 'var(--accent)' }}>
            {t('explore.shown', {
              shown: formatNumber(results.length), total: formatNumber(species.length),
            })}
          </span>
        }
        footer={
          <>
            <button
              onClick={() => setSelection(clearAll())}
              disabled={active === 0}
              style={{
                height: 48, minHeight: 48, flex: 'none', padding: '0 var(--space-4)',
                display: 'grid', placeItems: 'center', whiteSpace: 'nowrap',
                font: 'var(--type-action)', borderRadius: 'var(--radius-tap)',
                border: `var(--hair) solid ${active ? 'var(--ink)' : 'var(--line)'}`,
                color: active ? 'var(--ink)' : 'var(--ink-muted)',
                cursor: active ? 'pointer' : 'default',
              }}
            >
              {t('explore.reset')}
            </button>
            <button
              onClick={() => setSheetOpen(false)}
              style={{
                flex: 1, height: 48, minHeight: 48, display: 'grid', placeItems: 'center',
                background: 'var(--accent)', color: 'var(--paper)',
                font: 'var(--type-action)', borderRadius: 'var(--radius-tap)',
                padding: '0 var(--space-3)',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}
            >
              {t('explore.show', { count: results.length, n: formatNumber(results.length) })}
            </button>
          </>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
          {schema.traits.map((trait) => (
            <div key={trait.key}>
              <div className="t-meta" style={{ color: 'var(--ink-muted)', marginBottom: 'var(--space-2)' }}>
                {resolve(trait.label)}
              </div>
              <TraitControl
                trait={trait}
                selected={selection[trait.key] ?? []}
                onToggle={(v) => setSelection(toggle(schema, selection, trait.key, v))}
                packBaseUrl={baseUrl}
              />
            </div>
          ))}
        </div>
      </Sheet>
    </div>
  )
}
