/**
 * S04 Compare — the screen most competing guides lack.
 *
 * Rows where the species differ are emphasised in the accent colour; rows
 * where they agree are muted. That contrast is the whole value: it points at
 * what to actually look for in the field.
 */
import { useMemo } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useActivePack } from '../features/guide/use-pack'
import { Plate } from '../features/guide/species-grid'
import { EmptyState, Meta } from '../ui/primitives'
import { NavBar } from '../ui/nav-bar'
import { resolve } from '../data/localized'

export function Compare() {
  const { t } = useTranslation()
  const [params] = useSearchParams()
  const { pack, species: all, baseUrl } = useActivePack()

  const ids = (params.get('ids') ?? '').split(',').filter(Boolean).slice(0, 3)
  const chosen = useMemo(() => ids.map((uid) => all.find((s) => s.uid === uid)).filter(Boolean), [ids, all])
  const schema = pack?.manifest.traitSchema


  const topNav = (
      <NavBar title={t('compare.title')} />
  )

  if (!schema || chosen.length < 2) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100%', width: '100%' }}>
        {topNav}
        <div style={{ flex: 1, padding: 'var(--space-4) var(--gutter-sm)' }}>
          <EmptyState title={t('compare.empty')} fix={t('compare.emptyFix')} />
        </div>
      </div>
    )
  }

  const cols = `72px repeat(${chosen.length}, minmax(0, 1fr))`

  // A row differs when the species do not all present the same value set.
  const rows = schema.traits.map((trait) => {
    const cells = chosen.map((sp) => {
      const raw = sp!.traits[trait.key]
      const vals = raw == null ? [] : Array.isArray(raw) ? raw : [raw]
      return vals
        .map((v) => resolve(trait.options.find((o) => o.v === v)?.label) || v)
        .join(', ') || '—'
    })
    return { key: trait.key, label: resolve(trait.label), cells, differs: new Set(cells).size > 1 }
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100%', width: '100%' }}>
      {topNav}

      <div style={{ padding: 'var(--space-3) var(--gutter-sm) max(var(--space-6), calc(var(--space-4) + env(safe-area-inset-bottom)))' }}>
        <div style={{ display: 'grid', gridTemplateColumns: cols, gap: 'var(--space-2)' }}>
          <div />
          {chosen.map((sp) => (
            <Link key={sp!.uid} to={`/species/${sp!.uid}`} style={{ color: 'var(--ink)' }}>
              <Plate sp={sp!} baseUrl={baseUrl} />
              <div className="t-name" style={{ marginTop: 4 }}>{resolve(sp!.commonNames)}</div>
              <div className="t-sci">{sp!.sciName}</div>
              {sp!.images[0] && (
                <div style={{ marginTop: 2 }}>
                  <Meta>{sp!.images[0]!.credit} · {sp!.images[0]!.license}</Meta>
                </div>
              )}
            </Link>
          ))}
        </div>

        <div style={{ marginTop: 'var(--space-4)', paddingBottom: 'var(--space-2)', borderBottom: 'var(--hair) solid var(--line)' }}>
          <span style={{ width: 9, height: 9, background: 'var(--accent)', display: 'inline-block' }} aria-hidden />
          <span style={{ marginLeft: 6 }}><Meta>{t('compare.legend')}</Meta></span>
        </div>

        {rows.map((row) => (
          <div key={row.key} style={{
            display: 'grid', gridTemplateColumns: cols, gap: 'var(--space-2)',
            padding: 'var(--space-3) 0', borderBottom: 'var(--hair) solid var(--line)', alignItems: 'start',
          }}>
            <div><Meta>{row.label}</Meta></div>
            {row.cells.map((c, i) => (
              <div key={i} className="t-body" style={{
                color: row.differs ? 'var(--accent)' : 'var(--ink-muted)',
                fontWeight: row.differs ? 600 : 400,
              }}>{c}</div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
