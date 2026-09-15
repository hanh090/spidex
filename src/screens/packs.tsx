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
import { Button } from '../ui/primitives'
import { NavBar } from '../ui/nav-bar'
import { PackCard } from '../features/guide/pack-card'
import { CATALOGUE } from '../data/pack-catalogue'
import { fetchPackPreview, type PackPreview } from '../data/pack-preview'
import { resolve } from '../data/localized'
import { formatNumber } from '../i18n/format'

interface Listed {
  id: string
  manifest: PackManifest
  /** The manifest came from an installed pack, not from the network. */
  local: boolean
  /** A few real plates, so a pack is judged on what it looks like. */
  preview: PackPreview[]
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
      packs.map((p) => [p.id, { id: p.id, manifest: p.manifest, local: true, preview: [] }]),
    )

    for (const id of CATALOGUE) {
      const m = await fetchManifest(packBaseUrl(id))
      // A failed fetch is the normal offline case, not an error: an installed
      // entry already covers it, and one not installed simply cannot be
      // downloaded right now.
      if (m.ok) byId.set(id, { id, manifest: m.manifest, local: false, preview: [] })
    }

    // Plates are decorative and best-effort; a pack lists with or without them.
    const withPreviews = await Promise.all(
      [...byId.values()].map(async (entry) => ({
        ...entry,
        preview: await fetchPackPreview(packBaseUrl(entry.id), 3),
      })),
    )
    setListed(withPreviews)
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

  const installedList = listed.filter((l) => installed.some((p) => p.id === l.id))
  const availableList = listed.filter((l) => !installed.some((p) => p.id === l.id))

  const renderCard = (entry: Listed) => {
    const localPack = installed.find((p) => p.id === entry.id)
    const isActive = activeId === entry.id
    const p = progress[entry.id]
    const outdated = localPack && localPack.version < entry.manifest.version && !entry.local
    const name = resolve(entry.manifest.name)

    return (
      <PackCard
        key={entry.id}
        manifest={entry.manifest}
        preview={entry.preview}
        current={isActive}
        headingLevel="h3"
        status={
          p ? { label: t('packs.downloading'), tone: 'warn' }
          : isActive ? { label: t('packs.active'), tone: 'ok' }
          : outdated ? { label: t('packs.updateAvailable'), tone: 'accent' }
          : undefined
        }
        progress={p ? { done: p.done, total: p.total, label: t(`packs.phase.${p.phase}`) } : null}
        actions={
          <>
            {!entry.local && !localPack && (
              <Button
                variant="primary"
                full
                onClick={() => void install(entry.id, 'thumb')}
                aria-label={t('packs.downloadNamed', { name })}
              >
                {t('packs.download')}
              </Button>
            )}
            {outdated && (
              <Button
                variant="primary"
                full
                onClick={() => void update(entry.id)}
                aria-label={t('packs.updateNamed', { name, version: entry.manifest.version })}
              >
                {t('packs.update', { version: entry.manifest.version })}
              </Button>
            )}
            {localPack && !isActive && (
              <Button
                variant="secondary"
                full
                onClick={async () => { await setActivePackId(entry.id); await refresh() }}
                aria-label={t('packs.setActiveNamed', { name })}
              >
                {t('packs.setActive')}
              </Button>
            )}
            {/* A bordered control, not a bare link: Remove is frequently the
                only action on an installed pack, and a lone text link on an
                otherwise complete card reads as an afterthought. */}
            {localPack && (
              <Button
                variant="secondary"
                full
                onClick={() => void remove(localPack)}
                aria-label={t('packs.removeNamed', { name })}
              >
                {t('packs.delete')}
              </Button>
            )}
          </>
        }
      />
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%' }}>
      <NavBar title={t('packs.title')} />

      <div
        className="scroll-y"
        style={{
          flex: 1, width: '100%',
          padding: 'var(--space-4) var(--gutter-sm)',
          paddingBottom: 'max(var(--space-8), env(safe-area-inset-bottom))',
        }}
      >
        <div style={{ maxWidth: 600, margin: '0 auto' }}>
          {/* The screen's own heading. NavBar carries a title but it is chrome,
              not an outline entry, so heading navigation had nothing to land on. */}
          <h1 className="t-title" style={{ margin: '0 0 var(--space-2)' }}>{t('packs.title')}</h1>
          <p className="t-body" style={{ color: 'var(--ink-muted)', margin: '0 0 var(--space-6)', textWrap: 'pretty' }}>
            {t('packs.lede')}
          </p>

          {problem && (
            <p
              role="alert"
              className="t-body"
              style={{
                background: 'var(--alert)', border: 'var(--hair) solid var(--warn)',
                borderRadius: 'var(--radius-tap)', padding: 'var(--space-3)',
                margin: '0 0 var(--space-4)',
              }}
            >
              {problem}
            </p>
          )}

          {installedList.length > 0 && (
            <section style={{ marginBottom: 'var(--space-8)' }}>
              <h2 className="t-meta" style={{ color: 'var(--ink-muted)', margin: '0 0 var(--space-3)' }}>
                {t('packs.onThisDevice', { count: installedList.length, n: formatNumber(installedList.length) })}
              </h2>
              <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
                {installedList.map(renderCard)}
              </div>
            </section>
          )}

          {availableList.length > 0 && (
            <section>
              <h2 className="t-meta" style={{ color: 'var(--ink-muted)', margin: '0 0 var(--space-3)' }}>
                {t('packs.available')}
              </h2>
              <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
                {availableList.map(renderCard)}
              </div>
            </section>
          )}

          {listed.length === 0 && (
            <p className="t-body" style={{ color: 'var(--ink-muted)' }}>{t('packs.noneListed')}</p>
          )}
        </div>
      </div>
    </div>
  )
}
