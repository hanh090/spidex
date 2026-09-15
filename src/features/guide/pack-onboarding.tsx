/**
 * First run: no pack is mounted, so there is nothing to explore yet.
 *
 * Every string on this screen comes from either the interface bundle or the
 * pack's own manifest. Nothing about a pack — its name, its species count,
 * its region — is written into this file, because a pack name written here
 * would be written in one language and stay that way in all three.
 */
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { Button, Meta } from '../../ui/primitives'
import { FEATURED } from '../../data/pack-catalogue'
import { downloadPack, fetchManifest, type Progress } from '../../data/pack-download'
import { setActivePackId } from '../../data/db'
import type { PackManifest } from '../../data/pack-manifest'
import { packBaseUrl } from './use-pack'
import { resolve } from '../../data/localized'
import { formatNumber } from '../../i18n/format'

export function PackOnboarding() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [offered, setOffered] = useState<{ id: string; manifest: PackManifest }[]>([])
  const [installing, setInstalling] = useState<string | null>(null)
  const [progress, setProgress] = useState<Progress | null>(null)
  const [problem, setProblem] = useState<string | null>(null)

  // Manifests are read from the bundled packs, so this works with no network.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const results = await Promise.all(
        FEATURED.map(async (id) => {
          const res = await fetchManifest(packBaseUrl(id))
          return res.ok ? { id, manifest: res.manifest } : null
        }),
      )
      if (!cancelled) setOffered(results.filter(Boolean) as { id: string; manifest: PackManifest }[])
    })()
    return () => { cancelled = true }
  }, [])

  const install = async (id: string) => {
    setInstalling(id)
    setProblem(null)
    setProgress({ phase: 'manifest', done: 0, total: 0 })
    try {
      const res = await downloadPack({
        baseUrl: packBaseUrl(id),
        tier: 'thumb',
        acknowledgedNoPersist: true,
        onProgress: setProgress,
      })
      if (res.ok) {
        await setActivePackId(id)
        window.location.reload()
        return
      }
      setProblem(res.error ?? t('packs.invalid', { detail: res.issues?.[0]?.path ?? '' }))
    } catch (e) {
      setProblem((e as Error).message)
    }
    setInstalling(null)
    setProgress(null)
  }

  return (
    <div
      className="scroll-y"
      style={{
        height: '100%', width: '100%', maxWidth: 600, margin: '0 auto',
        padding: 'var(--space-6) var(--gutter-sm) var(--space-8)',
      }}
    >
      <h1 className="t-title" style={{ margin: '0 0 var(--space-2)' }}>{t('onboarding.title')}</h1>
      <p className="t-body" style={{ color: 'var(--ink-muted)', margin: '0 0 var(--space-6)', textWrap: 'pretty' }}>
        {t('onboarding.lede')}
      </p>

      {installing && progress && (
        <div
          role="status"
          style={{
            border: 'var(--hair) solid var(--accent)', background: 'var(--panel)',
            borderRadius: 'var(--radius-tap)', padding: 'var(--space-4)',
            marginBottom: 'var(--space-4)',
          }}
        >
          <div className="t-heading" style={{ color: 'var(--accent)', marginBottom: 'var(--space-1)' }}>
            {t(`packs.phase.${progress.phase}`)}
          </div>
          {progress.total > 0 && (
            <ProgressBar done={progress.done} total={progress.total} />
          )}
          <div style={{ marginTop: 'var(--space-2)' }}>
            <Meta>{t('onboarding.installNote')}</Meta>
          </div>
        </div>
      )}

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

      <div style={{ display: 'grid', gap: 'var(--space-3)' }}>
        {offered.map(({ id, manifest }, i) => (
          <article
            key={id}
            style={{
              border: 'var(--hair) solid var(--line)', background: 'var(--panel)',
              borderRadius: 'var(--radius-tap)', padding: 'var(--space-4)',
              display: 'flex', flexDirection: 'column', gap: 'var(--space-2)',
            }}
          >
            <h2 className="t-heading" style={{ margin: 0 }}>{resolve(manifest.name)}</h2>
            <Meta>
              {/* `count` selects the plural form; `n` carries the Intl-formatted
                  digits, so 1429 reads as 1,429 in en and 1.429 in de. */}
              {t('packs.speciesCount', { count: manifest.speciesCount, n: formatNumber(manifest.speciesCount) })}
              {' · '}{manifest.region}{' · '}{manifest.license}
            </Meta>
            <Button
              variant={i === 0 ? 'primary' : 'secondary'}
              full
              disabled={installing !== null}
              onClick={() => void install(id)}
            >
              {installing === id ? t('onboarding.installing') : t('onboarding.install')}
            </Button>
          </article>
        ))}
      </div>

      <div style={{ marginTop: 'var(--space-6)', textAlign: 'center' }}>
        <Button variant="inline" onClick={() => navigate('/library')}>{t('explore.getPack')}</Button>
      </div>
    </div>
  )
}

/** Determinate where the phase reports a total, so a long image pull is legible. */
function ProgressBar({ done, total }: { done: number; total: number }) {
  const pct = Math.min(100, Math.round((done / Math.max(1, total)) * 100))
  return (
    <>
      <div
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        style={{ height: 6, background: 'var(--line)', overflow: 'hidden' }}
      >
        <div style={{ width: `${pct}%`, height: '100%', background: 'var(--accent)', transition: 'width var(--move-push) var(--ease)' }} />
      </div>
      <div className="t-unit" style={{ marginTop: 'var(--space-1)', color: 'var(--ink-muted)' }}>
        {formatNumber(done)} / {formatNumber(total)}
      </div>
    </>
  )
}
