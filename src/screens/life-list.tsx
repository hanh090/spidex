/**
 * S10 Life list — every species ever logged, derived from the sightings
 * themselves so it works offline, for guests, and after a pack is removed.
 */
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  buildLifeList, groupLifeList,
  type LifeListEntry, type LifeListGroup, type LifeListSort,
} from '../features/log/life-list'
import { EmptyState, Meta } from '../ui/primitives'
import { NavBar } from '../ui/nav-bar'
import { IconChevron } from '../ui/icons'
import { formatDate, formatNumber } from '../i18n/format'

const SORTS: { id: LifeListSort; key: string }[] = [
  { id: 'date', key: 'fieldLog.sortDate' },
  { id: 'name', key: 'fieldLog.sortName' },
  { id: 'count', key: 'fieldLog.sortCount' },
]
const GROUPS: { id: LifeListGroup; key: string }[] = [
  { id: 'none', key: 'fieldLog.groupNone' },
  { id: 'pack', key: 'fieldLog.groupPack' },
  { id: 'family', key: 'fieldLog.groupFamily' },
]

export function LifeList() {
  const { t } = useTranslation()
  const [entries, setEntries] = useState<LifeListEntry[] | null>(null)
  const [sort, setSort] = useState<LifeListSort>('date')
  const [group, setGroup] = useState<LifeListGroup>('none')

  useEffect(() => {
    let cancelled = false
    void buildLifeList().then((rows) => { if (!cancelled) setEntries(rows) })
    return () => { cancelled = true }
  }, [])

  const sections = useMemo(() => groupLifeList(entries ?? [], group, sort), [entries, group, sort])

  if (!entries) return null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100%', width: '100%' }}>
      <NavBar title={t('fieldLog.lifeList')} fallback="/sightings" />

      {entries.length === 0
        ? <EmptyState title={t('sightings.lifeEmpty')} fix={t('sightings.lifeEmptyFix')} />
        : (
          <div className="column" style={{ padding: '0 var(--gutter-sm) var(--space-6)' }}>
            <div style={{ padding: 'var(--space-4) 0 var(--space-2)' }}>
              <Meta>{t('sightings.lifeCount', { count: entries.length })}</Meta>
            </div>

            <Segmented label={t('fieldLog.sortLabel')} options={SORTS} value={sort} onChange={setSort} />
            <Segmented label={t('fieldLog.groupLabel')} options={GROUPS} value={group} onChange={setGroup} />

            {sections.map((sec) => (
              <section key={sec.label ?? '_'}>
                {group !== 'none' && (
                  <h2 className="t-heading" style={{ margin: 0, padding: 'var(--space-4) 0 var(--space-2)', overflowWrap: 'anywhere' }}>
                    {sec.label ?? t('fieldLog.groupUnknown')}
                    <span style={{ marginLeft: 'var(--space-2)' }}><Meta>{formatNumber(sec.entries.length)}</Meta></span>
                  </h2>
                )}
                {sec.entries.map((e) => <Entry key={e.uid} e={e} />)}
              </section>
            ))}
          </div>
        )}
    </div>
  )
}

function Entry({ e }: { e: LifeListEntry }) {
  const { t } = useTranslation()
  const date = formatDate(e.firstSeen)
  const inner = (
    <>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="t-name" style={{ overflowWrap: 'anywhere' }}>{e.commonName}</div>
        <div className="t-sci" style={{ overflowWrap: 'anywhere' }}>{e.sciName}</div>
        <div style={{ marginTop: 2 }}>
          <Meta>{e.firstPlace ? t('fieldLog.lifeSeenAt', { date, place: e.firstPlace }) : t('fieldLog.lifeSeenOn', { date })}</Meta>
        </div>
        {!e.inGuide && <div><Meta tone="warn">{t('fieldLog.lifePackGone')}</Meta></div>}
      </div>
      <div style={{ flex: 'none', textAlign: 'right', maxWidth: '35%' }}>
        <Meta>{t('fieldLog.lifeTimes', { count: e.count })}</Meta>
      </div>
      {e.inGuide && <IconChevron />}
    </>
  )
  const style: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 'var(--space-3)',
    minHeight: 'var(--tap-min)', padding: 'var(--space-2) 0',
    borderBottom: 'var(--hair) solid var(--line)', color: 'var(--ink)',
  }
  return e.inGuide
    ? <Link to={`/species/${e.uid}`} style={style}>{inner}</Link>
    : <div style={style}>{inner}</div>
}

function Segmented<T extends string>({ label, options, value, onChange }: {
  label: string
  options: { id: T; key: string }[]
  value: T
  onChange: (v: T) => void
}) {
  const { t } = useTranslation()
  return (
    <div role="group" aria-label={label} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 'var(--space-1) var(--space-2)' }}>
      <span style={{ minWidth: 72 }}><Meta>{label}</Meta></span>
      {options.map((o) => (
        <button key={o.id} onClick={() => onChange(o.id)} aria-pressed={value === o.id}
          style={{
            minHeight: 'var(--tap-min)', padding: '0 var(--space-2)',
            color: value === o.id ? 'var(--ink)' : 'var(--ink-muted)',
            borderBottom: `2px solid ${value === o.id ? 'var(--accent)' : 'transparent'}`,
          }}>
          <span className="t-meta">{t(o.key)}</span>
        </button>
      ))}
    </div>
  )
}
