/**
 * /contribute — publish a species pack.
 *
 * An author picks a pack directory (pack.json + species.ndjson + img/…), the
 * manifest and records are validated client-side with the real zod contract,
 * then files stream up one PUT each. The pack lands in review; an admin
 * approval flips it live for everyone. The author's own submissions are
 * listed at the bottom with their status.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { NavBar } from '../ui/nav-bar'
import { Badge, Button, EmptyState, Meta, Skeleton } from '../ui/primitives'
import { SignInModal } from './sign-in-modal'
import { useAuth } from '../features/auth/auth-context'
import { parseManifest, parseSpeciesNdjson, type ValidationIssue } from '../data/pack-manifest'
import {
  createSubmission, completeSubmission, fetchMySubmissions, uploadPackFiles,
  withdrawSubmission, type Submission,
} from '../features/contribute/submissions-api'
import { formatBytes } from '../i18n/format'

/** Same allowlist the server enforces — anything else never reaches the wire. */
const UPLOADABLE = /\.(json|ndjson|webp|svg|jpe?g|png|gif|avif|mp3|ogg|opus|wav|m4a|woff2?)$/i
const TOP_LEVEL = /^(pack\.json|species\.ndjson|img\/|audio\/|fonts\/)/

interface PickedFile { path: string; file: File }

type Phase =
  | { step: 'idle' }
  | { step: 'ready'; packId: string; name: string; files: PickedFile[]; bytes: number; species: number }
  | { step: 'uploading'; packId: string; done: number; total: number }
  | { step: 'done'; packId: string; status: string }
  | { step: 'error'; message: string; issues?: ValidationIssue[] }

export function Contribute() {
  const { t } = useTranslation()
  const { user, loading } = useAuth()
  const [signInOpen, setSignInOpen] = useState(false)
  const [phase, setPhase] = useState<Phase>({ step: 'idle' })
  const [note, setNote] = useState('')
  const [mine, setMine] = useState<Submission[] | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const loadMine = useCallback(() => {
    if (user) void fetchMySubmissions().then((r) => setMine(r.submissions)).catch(() => setMine([]))
  }, [user])
  useEffect(loadMine, [loadMine])

  /**
   * webkitdirectory gives paths like `my-pack/img/a.webp` — the leading
   * directory is the pack folder, everything under it is pack-relative.
   */
  const onPick = async (list: FileList | null) => {
    if (!list?.length) return
    const files: PickedFile[] = []
    for (const f of Array.from(list)) {
      const rel = (f.webkitRelativePath || f.name).split('/').slice(1).join('/')
      if (!rel || !TOP_LEVEL.test(rel) || !UPLOADABLE.test(rel)) continue
      files.push({ path: rel, file: f })
    }
    const manifestFile = files.find((f) => f.path === 'pack.json')
    const ndjsonFile = files.find((f) => f.path === 'species.ndjson')
    if (!manifestFile || !ndjsonFile) {
      setPhase({ step: 'error', message: t('contribute.missingFiles') })
      return
    }
    let manifestJson: unknown
    try {
      manifestJson = JSON.parse(await manifestFile.file.text())
    } catch {
      setPhase({ step: 'error', message: t('contribute.invalidManifest') })
      return
    }
    const m = parseManifest(manifestJson)
    if (!m.ok) { setPhase({ step: 'error', message: t('contribute.invalidManifest'), issues: m.issues }); return }
    const sp = parseSpeciesNdjson(await ndjsonFile.file.text(), m.value.traitSchema)
    if (!sp.ok) { setPhase({ step: 'error', message: t('contribute.invalidSpecies'), issues: sp.issues }); return }
    setPhase({
      step: 'ready',
      packId: m.value.id,
      name: m.value.name.en,
      files,
      bytes: files.reduce((s, f) => s + f.file.size, 0),
      species: sp.value.length,
    })
  }

  const submit = async (ready: Extract<Phase, { step: 'ready' }>) => {
    try {
      const { id } = await createSubmission({
        packId: ready.packId,
        note,
        fileCount: ready.files.length,
        totalBytes: ready.bytes,
      })
      setPhase({ step: 'uploading', packId: ready.packId, done: 0, total: ready.files.length })
      await uploadPackFiles(id, ready.files, (done, total) =>
        setPhase({ step: 'uploading', packId: ready.packId, done, total }))
      try {
        const res = await completeSubmission(id)
        setPhase({ step: 'done', packId: ready.packId, status: res.status })
      } catch (e) {
        const err = e as Error & { issues?: ValidationIssue[] }
        setPhase({ step: 'error', message: err.message, issues: err.issues })
      }
      loadMine()
    } catch (e) {
      setPhase({ step: 'error', message: (e as Error).message })
    }
  }

  const body = () => {
    if (loading) return <div style={{ padding: 'var(--space-4) var(--gutter-sm)' }}><Skeleton height={120} /></div>
    if (!user) {
      return (
        <EmptyState
          title={t('contribute.signInTitle')}
          fix={t('contribute.signInFix')}
          action={<Button variant="primary" onClick={() => setSignInOpen(true)}>{t('account.signIn', 'Sign in')}</Button>}
        />
      )
    }
    return (
      <div className="scroll-y column" style={{ flex: 1, padding: 'var(--space-4) var(--gutter-sm) var(--space-8)', display: 'grid', gap: 'var(--space-4)', alignContent: 'start' }}>
        <h1 className="t-title" style={{ margin: 0 }}>{t('contribute.title')}</h1>
        <p className="t-body" style={{ color: 'var(--ink-muted)', margin: 0, textWrap: 'pretty' }}>
          {t('contribute.lede')}
        </p>

        {phase.step === 'error' && (
          <div role="alert" className="t-body" style={{
            background: 'var(--alert)', border: 'var(--hair) solid var(--warn)',
            borderRadius: 'var(--radius-tap)', padding: 'var(--space-3)', margin: 0,
          }}>
            {phase.message}
            {phase.issues?.slice(0, 5).map((i) => (
              <div key={`${i.path}:${i.message}`} className="t-meta" style={{ marginTop: 4 }}>
                {i.path}: {i.message}
              </div>
            ))}
          </div>
        )}

        {phase.step === 'ready' && (
          <section style={{
            border: 'var(--hair) solid var(--line)', borderRadius: 'var(--radius-card)',
            padding: 'var(--space-4)', background: 'var(--paper)', display: 'grid', gap: 'var(--space-3)',
          }}>
            <span className="t-heading" style={{ fontSize: 17 }}>{phase.name}</span>
            <Meta>{phase.packId} · {phase.species} species · {phase.files.length} files · {formatBytes(phase.bytes)}</Meta>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t('contribute.notePlaceholder')}
              aria-label={t('contribute.notePlaceholder')}
              style={{
                minHeight: 'var(--tap-min)', padding: 'var(--space-2) var(--space-3)',
                border: 'var(--hair) solid var(--ink-muted)', borderRadius: 'var(--radius-tap)',
                background: 'var(--paper)', color: 'var(--ink)', font: 'var(--type-body)',
              }}
            />
            <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
              <Button variant="primary" full onClick={() => void submit(phase)}>{t('contribute.submit')}</Button>
              <Button variant="secondary" onClick={() => setPhase({ step: 'idle' })}>{t('contribute.cancel')}</Button>
            </div>
          </section>
        )}

        {phase.step === 'uploading' && (
          <section style={{
            border: 'var(--hair) solid var(--line)', borderRadius: 'var(--radius-card)',
            padding: 'var(--space-4)', background: 'var(--paper)', display: 'grid', gap: 'var(--space-2)',
          }}>
            <Meta>{t('contribute.uploading', { done: phase.done, total: phase.total })}</Meta>
            <div style={{ height: 4, background: 'var(--line)', borderRadius: 2, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${(phase.done / Math.max(phase.total, 1)) * 100}%`, background: 'var(--accent)', transition: 'width .2s' }} />
            </div>
          </section>
        )}

        {phase.step === 'done' && (
          <section style={{
            border: 'var(--hair) solid var(--ok)', borderRadius: 'var(--radius-card)',
            padding: 'var(--space-4)', background: 'var(--paper)', display: 'grid', gap: 'var(--space-2)',
          }}>
            <span className="t-body" style={{ fontWeight: 600 }}>{t('contribute.doneTitle')}</span>
            <span className="t-body" style={{ color: 'var(--ink-muted)' }}>{t('contribute.doneFix', { packId: phase.packId })}</span>
            <Button variant="secondary" onClick={() => setPhase({ step: 'idle' })}>{t('contribute.another')}</Button>
          </section>
        )}

        {(phase.step === 'idle' || phase.step === 'error') && (
          <Button variant="primary" onClick={() => inputRef.current?.click()}>
            {t('contribute.pick')}
          </Button>
        )}
        <input
          ref={inputRef}
          type="file"
          multiple
          style={{ display: 'none' }}
          aria-hidden="true"
          tabIndex={-1}
          {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
          onChange={(e) => { void onPick(e.target.files); e.target.value = '' }}
        />

        {mine !== null && mine.length > 0 && (
          <section style={{ display: 'grid', gap: 'var(--space-2)', marginTop: 'var(--space-4)' }}>
            <Meta>{t('contribute.mine')}</Meta>
            {mine.map((s) => (
              <article key={s.id} style={{
                border: 'var(--hair) solid var(--line)', borderRadius: 'var(--radius-card)',
                padding: 'var(--space-3) var(--space-4)', background: 'var(--paper)',
                display: 'flex', alignItems: 'center', gap: 'var(--space-3)',
              }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="t-body" style={{ fontWeight: 600 }}>{s.summary?.name?.en ?? s.packId}</div>
                  <div className="t-meta" style={{ color: 'var(--ink-muted)' }}>{s.packId}</div>
                </div>
                <Badge tone={s.status === 'published' ? 'ok' : s.status === 'rejected' ? 'warn' : 'muted'}>
                  {t(`contribute.status.${s.status}`, { defaultValue: s.status })}
                </Badge>
                {(s.status === 'uploading' || s.status === 'pending') && (
                  <Button variant="inline" onClick={() => { void withdrawSubmission(s.id).then(loadMine) }}>
                    {t('contribute.withdraw')}
                  </Button>
                )}
              </article>
            ))}
          </section>
        )}
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%' }}>
      <NavBar title={t('contribute.title')} />
      {body()}
      <SignInModal open={signInOpen} onClose={() => setSignInOpen(false)} />
    </div>
  )
}
