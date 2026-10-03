/**
 * Favourites — the target list. A species hearted on its page appears here;
 * the "seen" tick comes from the sighting log, so it works offline.
 */
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { listFavourites, removeFavourite, type FavouriteView } from '../features/log/favourites-repo'
import { resolve } from '../data/localized'
import { Badge, EmptyState, Meta } from '../ui/primitives'
import { NavBar } from '../ui/nav-bar'
import { IconCheck, IconChevron, IconClose } from '../ui/icons'
import { formatDate } from '../i18n/format'

function nameOf(v: FavouriteView): { common: string; sci: string } {
  const sci = v.species?.sciName ?? v.sciName ?? v.favourite.speciesId
  const common = v.species ? resolve(v.species.commonNames) : v.commonName ?? sci
  return { common, sci }
}

export function Favourites() {
  const { t } = useTranslation()
  const [rows, setRows] = useState<FavouriteView[] | null>(null)

  const refresh = useCallback(async () => setRows(await listFavourites()), [])
  useEffect(() => { void refresh() }, [refresh])

  if (!rows) return null
  const seen = rows.filter((r) => r.seen).length

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100%', width: '100%' }}>
      <NavBar title={t('fieldLog.favourites')} fallback="/sightings" />

      {rows.length === 0
        ? <EmptyState title={t('fieldLog.favEmpty')} fix={t('fieldLog.favEmptyFix')} />
        : (
          <div className="column" style={{ padding: '0 var(--gutter-sm) var(--space-6)' }}>
            <div style={{ padding: 'var(--space-4) 0 var(--space-2)' }}>
              <Meta>{t('fieldLog.favSummary', { seen, total: rows.length })}</Meta>
            </div>
            {rows.map((v) => {
              const { common, sci } = nameOf(v)
              return (
                <div key={v.favourite.id} style={{
                  display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
                  borderBottom: 'var(--hair) solid var(--line)',
                }}>
                  <Link
                    to={`/species/${v.favourite.id}`}
                    style={{
                      flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 'var(--space-3)',
                      minHeight: 'var(--tap-min)', padding: 'var(--space-2) 0', color: 'var(--ink)',
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="t-name" style={{ overflowWrap: 'anywhere' }}>{common}</div>
                      <div className="t-sci" style={{ overflowWrap: 'anywhere' }}>{sci}</div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)', alignItems: 'center', marginTop: 4 }}>
                        {v.seen
                          ? <Badge tone="ok"><span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><IconCheck size={13} />{t('fieldLog.favSeen')}</span></Badge>
                          : <Badge>{t('fieldLog.favNotSeen')}</Badge>}
                        {v.lastSeen != null && <Meta>{t('fieldLog.favLastSeen', { date: formatDate(v.lastSeen) })}</Meta>}
                      </div>
                    </div>
                    <IconChevron />
                  </Link>
                  <button
                    onClick={() => void removeFavourite(v.favourite.id).then(refresh)}
                    aria-label={t('fieldLog.favRemove', { name: common })}
                    style={{
                      flex: 'none', minWidth: 'var(--tap-min)', minHeight: 'var(--tap-min)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ink-muted)',
                    }}
                  >
                    <IconClose size={20} />
                  </button>
                </div>
              )
            })}
          </div>
        )}
    </div>
  )
}
