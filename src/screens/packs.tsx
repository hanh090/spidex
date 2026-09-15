/**
 * S12 Pack manager.
 *
 * Size and species count are shown from the MANIFEST before any download —
 * never from storage.estimate(), which is rounded and padded on iOS.
 *
 * Deleting a pack states how many sightings reference it first, and those
 * sightings are kept: they carry a species snapshot and stay readable.
 */
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { db, setActivePackId, getActivePackId, type StoredPack } from '../data/db'
import { downloadPack, deletePack, fetchManifest, packReferenceCount, type Progress } from '../data/pack-download'
import { previewUpdate } from '../data/pack-update'
import { packBaseUrl } from '../features/guide/use-pack'
import type { PackManifest } from '../data/pack-manifest'
import { Button, Meta, Badge } from '../ui/primitives'
import { NavBar } from '../ui/nav-bar'
import { resolve } from '../data/localized'
import { formatBytes, formatNumber } from '../i18n/format'

/** Packs bundled with the build. Includes national & regional scientific checklists. */
const CATALOGUE = [
  'butterfly-vn',
  'bird-vn',
  'butterfly-th',
  'bird-th',
  'butterfly-sg',
  'butterfly-min',
  'bird-min',
]

interface Listed {
  id: string
  manifest: PackManifest
  /** The manifest came from an installed pack, not from the network. */
  local: boolean
}

export function Packs() {
  const { t } = useTranslation()
  const [installed, setInstalled] = useState<StoredPack[]>([])
  const [listed, setListed] = useState<Listed[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [progress, setProgress] = useState<Record<string, Progress>>({})
  const [problem, setProblem] = useState<string | null>(null)


  /**
   * Installed packs are listed from their OWN stored manifest, so this screen
   * works with no network. Catalogue entries are then merged in on top when
   * they can be fetched — offline you can still see, scope and delete what you
   * already have, which was the whole point of downloading it.
   */
  const refresh = useCallback(async () => {
    const [packs, active] = await Promise.all([db.packs.toArray(), getActivePackId()])
    setInstalled(packs)
    setActiveId(active)

    const byId = new Map<string, Listed>(
      packs.map((p) => [p.id, { id: p.id, manifest: p.manifest, local: true }]),
    )

    for (const id of CATALOGUE) {
      const m = await fetchManifest(packBaseUrl(id))
      // A failed fetch is the normal offline case, not an error: an installed
      // entry already covers it, and one not installed simply cannot be
      // downloaded right now.
      if (m.ok) byId.set(id, { id, manifest: m.manifest, local: false })
    }
    setListed([...byId.values()])
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  const install = async (id: string, tier: 'thumb' | 'full', acknowledged = false) => {
    setProblem(null)
    const res = await downloadPack({
      baseUrl: packBaseUrl(id),
      tier,
      acknowledgedNoPersist: acknowledged,
      onProgress: (p) => setProgress((cur) => ({ ...cur, [id]: p })),
    })
    if (!res.ok) {
      if (res.error === 'persist-refused') {
        // Never silently proceed: the user decides knowing the pack may be reclaimed.
        if (confirm(t('packs.persistWarning'))) return install(id, tier, true)
        setProblem(t('packs.cancelled'))
      } else if (res.error === 'insufficient-headroom') {
        setProblem(t('packs.noHeadroom'))
      } else if (res.issues?.length) {
        setProblem(t('packs.invalid', { detail: `${res.issues[0]!.path}: ${res.issues[0]!.message}` }))
      } else {
        setProblem(res.error ?? 'error')
      }
    }
    setProgress((cur) => { const n = { ...cur }; delete n[id]; return n })
    await refresh()
  }

  /**
   * Updating is where a taxonomic split can orphan the log, so the user is
   * told how many of their sightings cannot be remapped BEFORE it commits.
   */
  const update = async (id: string) => {
    setProblem(null)
    const preview = await previewUpdate(id, packBaseUrl(id))
    if ('error' in preview) { setProblem(preview.error); return }
    const ok = confirm(t('packs.updateConfirm', {
      from: preview.fromVersion,
      to: preview.toVersion,
      affected: preview.affectedSightings,
      unmappable: preview.unmappable.length,
    }))
    if (!ok) return
    await install(id, 'thumb', true)
  }

  const remove = async (pack: StoredPack) => {
    const refs = await packReferenceCount(pack.id)
    if (!confirm(t('packs.deleteConfirm', { name: resolve(pack.manifest.name), count: refs }))) return
    await deletePack(pack.id)
    await refresh()
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%' }}>
      <NavBar title={t('packs.title')} />

      <div className="scroll-y" style={{ flex: 1, width: '100%', padding: 'var(--gutter-sm)', paddingBottom: 'max(var(--space-6), env(safe-area-inset-bottom))' }}>
        {problem && (
          <div style={{ background: 'var(--alert)', border: 'var(--hair) solid var(--warn)', padding: 'var(--space-3)', marginBottom: 'var(--space-4)' }}>
            <span className="t-body">{problem}</span>
          </div>
        )}

      {listed.map(({ id, manifest, local }) => {
        const localPack = installed.find((p) => p.id === id)
        const p = progress[id]
        return (
          <section key={id} style={{
            border: 'var(--hair) solid var(--line)', padding: 'var(--space-3)',
            marginBottom: 'var(--space-3)', background: activeId === id ? 'var(--panel)' : 'transparent',
          }}>
            <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'flex-start' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="t-heading">{resolve(manifest.name)}</div>
                <Meta>
                  {t('packs.speciesCount', { count: manifest.speciesCount, n: formatNumber(manifest.speciesCount) })} ·{' '}
                  {formatBytes(manifest.sizeBytes.thumb)} · v{formatNumber(manifest.version)}
                </Meta>
              </div>
              {localPack && activeId === id && <Badge tone="ok">{t('packs.active')}</Badge>}
            </div>

            {p && (
              <div style={{ marginTop: 'var(--space-2)' }}>
                <Meta tone="warn">{t(`packs.phase.${p.phase}`)} {p.total > 1 ? `${p.done}/${p.total}` : ''}</Meta>
              </div>
            )}

            <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-3)', flexWrap: 'wrap' }}>
              {!local && !localPack && (
                <Button variant="primary" onClick={() => void install(id, 'thumb')}>{t('packs.download')}</Button>
              )}
              {localPack && localPack.version < manifest.version && !local && (
                <Button variant="primary" onClick={() => void update(id)}>
                  {t('packs.update', { version: manifest.version })}
                </Button>
              )}
              {localPack && activeId !== id && (
                <Button variant="secondary" onClick={async () => { await setActivePackId(id); await refresh() }}>
                  {t('packs.setActive')}
                </Button>
              )}
              {localPack && <Button variant="inline" onClick={() => void remove(localPack)}>{t('packs.delete')}</Button>}
            </div>

            <div style={{ marginTop: 'var(--space-2)' }}>
              <Meta>{t('packs.fixtureNote')}</Meta>
            </div>
          </section>
        )
      })}
      </div>
    </div>
  )
}
