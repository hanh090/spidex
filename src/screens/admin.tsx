/**
 * /admin — the resource console.
 *
 * Three panels, all backed by /api/admin/*: Overview (what is deployed —
 * packs read from the shipped assets themselves), Resources (the D1-backed
 * store: pack publish flags, checklists, datasets, audio collections), and
 * Users (the WorkOS directory, read-only).
 *
 * Gating is real, not cosmetic: the client decides what to SHOW from
 * /api/admin/me, but every endpoint re-verifies the signed session and the
 * ADMIN_EMAILS allowlist server-side. Hiding the screen is UX; the API is
 * the lock.
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { NavBar } from '../ui/nav-bar'
import { Badge, Button, EmptyState, Meta, Skeleton } from '../ui/primitives'
import { SignInModal } from './sign-in-modal'
import {
  fetchAdminOverview, fetchAdminResources, fetchAdminStatus, fetchAdminUsers,
  createAdminResource, updateAdminResource, deleteAdminResource, setPackPublished,
  fetchAdminSubmissions, reviewSubmission,
  type AdminOverview, type AdminResource, type AdminStatus, type AdminSubmission, type AdminUser,
} from '../features/admin/admin-api'
import { resolve } from '../data/localized'
import { formatBytes, formatNumber } from '../i18n/format'

type SectionKey = 'overview' | 'submissions' | 'resources' | 'users'

const RESOURCE_KINDS = ['pack', 'checklist', 'dataset', 'audio', 'note'] as const

export function Admin() {
  const { t } = useTranslation()
  const [status, setStatus] = useState<AdminStatus | null>(null)
  const [section, setSection] = useState<SectionKey>('overview')
  const [signInOpen, setSignInOpen] = useState(false)

  useEffect(() => {
    void fetchAdminStatus().then(setStatus)
  }, [])

  const body = () => {
    if (!status) {
      return (
        <div style={{ padding: 'var(--space-4) var(--gutter-sm)', display: 'grid', gap: 'var(--space-3)' }}>
          {[0, 1, 2].map((i) => <Skeleton key={i} height={72} />)}
        </div>
      )
    }
    if (!status.user) {
      return (
        <EmptyState
          title={t('admin.signInTitle')}
          fix={t('admin.signInFix')}
          action={<Button variant="primary" onClick={() => setSignInOpen(true)}>{t('account.signIn', 'Sign in')}</Button>}
        />
      )
    }
    if (!status.isAdmin) {
      return <EmptyState title={t('admin.deniedTitle')} fix={t('admin.deniedFix', { email: status.user.email })} />
    }
    return (
      <>
        <div style={{
          display: 'flex', borderBottom: 'var(--hair) solid var(--line)', background: 'var(--panel)', flex: 'none',
        }}>
          {(['overview', 'submissions', 'resources', 'users'] as const).map((s) => (
            <button
              key={s}
              onClick={() => setSection(s)}
              aria-pressed={section === s}
              style={{
                flex: 1, minHeight: 'var(--tap-min)',
                color: section === s ? 'var(--ink)' : 'var(--ink-muted)',
                borderBottom: `2px solid ${section === s ? 'var(--accent)' : 'transparent'}`,
                marginBottom: '-1.5px',
              }}
            >
              <span className="t-meta">{t(`admin.section.${s}`)}</span>
            </button>
          ))}
        </div>
        <div className="scroll-y column" style={{ flex: 1, minHeight: 0, padding: 'var(--space-4) var(--gutter-sm) var(--space-8)' }}>
          {!status.store && (
            <Alert>{t('admin.noStore')}</Alert>
          )}
          {section === 'overview' && <Overview />}
          {section === 'submissions' && <Submissions />}
          {section === 'resources' && <Resources />}
          {section === 'users' && <Users />}
        </div>
      </>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%' }}>
      <NavBar title={t('admin.title')} />
      {body()}
      <SignInModal open={signInOpen} onClose={() => { setSignInOpen(false); void fetchAdminStatus().then(setStatus) }} />
    </div>
  )
}

/* ---- panels --------------------------------------------------------------- */

function Overview() {
  const { t } = useTranslation()
  const [data, setData] = useState<AdminOverview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(() => {
    fetchAdminOverview().then(setData).catch((e) => setError((e as Error).message))
  }, [])
  useEffect(load, [load])

  const togglePublish = async (id: string, published: boolean) => {
    setBusy(id)
    try {
      await setPackPublished(id, published)
      load()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  if (error) return <Alert>{error}</Alert>
  if (!data) return <Skeleton height={120} />

  return (
    <div style={{ display: 'grid', gap: 'var(--space-3)' }}>
      {data.catalogueError && <Alert>{t('admin.catalogueError', { detail: data.catalogueError })}</Alert>}
      <Meta>{t('admin.packsListed', { count: data.packs.length, n: formatNumber(data.packs.length) })}</Meta>
      {data.packs.map((p) => (
        <article
          key={p.id}
          style={{
            border: 'var(--hair) solid var(--line)', borderRadius: 'var(--radius-card)',
            padding: 'var(--space-4)', background: 'var(--paper)',
            display: 'flex', flexDirection: 'column', gap: 'var(--space-2)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
            <span className="t-heading" style={{ fontSize: 17 }}>{p.name ? resolve(p.name) : p.id}</span>
            <span className="t-meta" style={{ color: 'var(--ink-muted)' }}>{p.id}</span>
            <span style={{ flex: 1 }} />
            {p.featured && <Badge tone="accent">{t('admin.featured')}</Badge>}
            {p.community && <Badge tone="muted">{t('admin.community')}</Badge>}
            {p.missing
              ? <Badge tone="warn">{t('admin.missing')}</Badge>
              : <Badge tone={p.published ? 'ok' : 'warn'}>{p.published ? t('admin.published') : t('admin.unpublished')}</Badge>}
          </div>
          {!p.missing && (
            <div className="t-meta" style={{ color: 'var(--ink-muted)' }}>
              {[p.region, p.taxonGroup,
                p.speciesCount != null && t('packs.speciesCount', { count: p.speciesCount, n: formatNumber(p.speciesCount) }),
                p.sizeBytes && formatBytes(p.sizeBytes.thumb),
                p.version != null && `v${formatNumber(p.version)}`,
              ].filter(Boolean).join(' · ')}
            </div>
          )}
          <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-1)' }}>
            <Button
              variant="secondary"
              disabled={busy === p.id}
              onClick={() => void togglePublish(p.id, !p.published)}
            >
              {p.published ? t('admin.unpublish') : t('admin.publish')}
            </Button>
          </div>
        </article>
      ))}
    </div>
  )
}

function Resources() {
  const { t } = useTranslation()
  const [rows, setRows] = useState<AdminResource[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [kind, setKind] = useState('')
  const [form, setForm] = useState({ id: '', kind: 'dataset', title: '', meta: '{}', published: true })
  const [adding, setAdding] = useState(false)

  const load = useCallback(() => {
    fetchAdminResources(kind || undefined)
      .then((r) => setRows(r.resources))
      .catch((e) => setError((e as Error).message))
  }, [kind])
  useEffect(load, [load])

  const add = async () => {
    setAdding(true)
    setError(null)
    try {
      let meta: Record<string, unknown> = {}
      if (form.meta.trim()) meta = JSON.parse(form.meta)
      await createAdminResource({
        id: form.id.trim() || undefined,
        kind: form.kind,
        title: form.title.trim(),
        meta,
        published: form.published,
      })
      setForm({ ...form, id: '', title: '', meta: '{}' })
      load()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setAdding(false)
    }
  }

  const toggle = async (r: AdminResource) => {
    try { await updateAdminResource(r.id, { published: !r.published }); load() }
    catch (e) { setError((e as Error).message) }
  }

  const remove = async (r: AdminResource) => {
    if (!confirm(t('admin.deleteConfirm', { title: r.title }))) return
    try { await deleteAdminResource(r.id); load() }
    catch (e) { setError((e as Error).message) }
  }

  return (
    <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
      {/* Add form */}
      <section style={{
        border: 'var(--hair) solid var(--line)', borderRadius: 'var(--radius-card)',
        padding: 'var(--space-4)', background: 'var(--paper)', display: 'grid', gap: 'var(--space-3)',
      }}>
        <Meta>{t('admin.addResource')}</Meta>
        <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
          <select
            value={form.kind}
            onChange={(e) => setForm({ ...form, kind: e.target.value })}
            aria-label={t('admin.fieldKind')}
            style={fieldStyle()}
          >
            {RESOURCE_KINDS.map((k) => <option key={k} value={k}>{t(`admin.kind.${k}`)}</option>)}
          </select>
          <input
            value={form.id}
            onChange={(e) => setForm({ ...form, id: e.target.value })}
            placeholder={t('admin.fieldId')}
            aria-label={t('admin.fieldId')}
            style={{ ...fieldStyle(), flex: 1, minWidth: 120 }}
          />
        </div>
        <input
          value={form.title}
          onChange={(e) => setForm({ ...form, title: e.target.value })}
          placeholder={t('admin.fieldTitle')}
          aria-label={t('admin.fieldTitle')}
          style={fieldStyle()}
        />
        <textarea
          value={form.meta}
          onChange={(e) => setForm({ ...form, meta: e.target.value })}
          placeholder={t('admin.fieldMeta')}
          aria-label={t('admin.fieldMeta')}
          rows={3}
          style={{ ...fieldStyle(), fontFamily: 'var(--font-mono)', fontSize: 12 }}
        />
        <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }} className="t-body">
          <input
            type="checkbox"
            checked={form.published}
            onChange={(e) => setForm({ ...form, published: e.target.checked })}
          />
          {t('admin.published')}
        </label>
        <Button variant="primary" disabled={adding || !form.title.trim()} onClick={() => void add()}>
          {adding ? t('admin.saving') : t('admin.add')}
        </Button>
      </section>

      {error && <Alert>{error}</Alert>}

      {/* Filter by kind */}
      <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
        <Chip label={t('admin.all')} active={!kind} onClick={() => setKind('')} />
        {RESOURCE_KINDS.map((k) => (
          <Chip key={k} label={t(`admin.kind.${k}`)} active={kind === k} onClick={() => setKind(kind === k ? '' : k)} />
        ))}
      </div>

      {rows === null
        ? <Skeleton height={80} />
        : rows.length === 0
          ? <p className="t-body" style={{ color: 'var(--ink-muted)', margin: 0 }}>{t('admin.noResources')}</p>
          : rows.map((r) => (
            <article
              key={r.id}
              style={{
                border: 'var(--hair) solid var(--line)', borderRadius: 'var(--radius-card)',
                padding: 'var(--space-3) var(--space-4)', background: 'var(--paper)',
                display: 'flex', alignItems: 'center', gap: 'var(--space-3)',
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="t-body" style={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{r.title}</div>
                <div className="t-meta" style={{ color: 'var(--ink-muted)' }}>
                  {t(`admin.kind.${r.kind}`, { defaultValue: r.kind })} · {r.id}
                </div>
              </div>
              <Badge tone={r.published ? 'ok' : 'muted'}>{r.published ? t('admin.published') : t('admin.unpublished')}</Badge>
              <Button variant="inline" onClick={() => void toggle(r)}>{r.published ? t('admin.unpublish') : t('admin.publish')}</Button>
              <Button variant="inline" onClick={() => void remove(r)}>{t('admin.delete')}</Button>
            </article>
          ))}
    </div>
  )
}

/**
 * Community pack review queue. Approve flips the pack live in the catalogue;
 * reject deletes the uploaded objects. Validation issues the server found at
 * complete-time are shown inline so the reviewer sees what the uploader saw.
 */
function Submissions() {
  const { t } = useTranslation()
  const [rows, setRows] = useState<AdminSubmission[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(() => {
    fetchAdminSubmissions()
      .then((r) => setRows(r.submissions))
      .catch((e) => setError((e as Error).message))
  }, [])
  useEffect(load, [load])

  const review = async (s: AdminSubmission, action: 'approve' | 'reject') => {
    if (action === 'reject' && !confirm(t('admin.rejectConfirm', { id: s.meta.packId ?? s.id }))) return
    setBusy(s.id)
    try {
      await reviewSubmission(s.id, action)
      load()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  if (error && !rows) return <Alert>{error}</Alert>
  if (!rows) return <Skeleton height={120} />

  const open = rows.filter((r) => r.meta.status === 'pending' || r.meta.status === 'uploading')
  const closed = rows.filter((r) => !open.includes(r))

  const renderRow = (s: AdminSubmission) => {
    const m = s.meta
    const reviewable = m.status === 'pending'
    return (
      <article
        key={s.id}
        style={{
          border: 'var(--hair) solid var(--line)', borderRadius: 'var(--radius-card)',
          padding: 'var(--space-4)', background: 'var(--paper)',
          display: 'flex', flexDirection: 'column', gap: 'var(--space-2)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
          <span className="t-heading" style={{ fontSize: 17 }}>{m.summary?.name?.en ?? m.packId ?? s.title}</span>
          <span className="t-meta" style={{ color: 'var(--ink-muted)' }}>{m.packId}</span>
          <span style={{ flex: 1 }} />
          <Badge tone={m.status === 'published' ? 'ok' : m.status === 'rejected' || m.status === 'withdrawn' ? 'warn' : 'accent'}>
            {t(`admin.submissionStatus.${m.status}`, { defaultValue: m.status })}
          </Badge>
        </div>
        <div className="t-meta" style={{ color: 'var(--ink-muted)' }}>
          {[
            m.submitter?.email,
            m.summary?.speciesCount != null && t('packs.speciesCount', { count: m.summary.speciesCount, n: formatNumber(m.summary.speciesCount) }),
            m.fileCount != null && `${formatNumber(m.receivedFiles ?? 0)}/${formatNumber(m.fileCount)} files`,
          ].filter(Boolean).join(' · ')}
        </div>
        {m.note && <p className="t-body" style={{ margin: 0, color: 'var(--ink-muted)' }}>{m.note}</p>}
        {!!m.issues?.length && (
          <div className="t-meta" style={{ color: 'var(--warn)' }}>
            {m.issues.slice(0, 4).map((i) => <div key={`${i.path}:${i.message}`}>{i.path}: {i.message}</div>)}
          </div>
        )}
        {reviewable && (
          <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-1)' }}>
            <Button variant="primary" disabled={busy === s.id} onClick={() => void review(s, 'approve')}>
              {t('admin.approve')}
            </Button>
            <Button variant="secondary" disabled={busy === s.id} onClick={() => void review(s, 'reject')}>
              {t('admin.reject')}
            </Button>
          </div>
        )}
      </article>
    )
  }

  return (
    <div style={{ display: 'grid', gap: 'var(--space-3)' }}>
      {error && <Alert>{error}</Alert>}
      <Meta>{t('admin.submissionsListed', { count: open.length, n: formatNumber(open.length) })}</Meta>
      {open.map(renderRow)}
      {!open.length && <p className="t-body" style={{ color: 'var(--ink-muted)', margin: 0 }}>{t('admin.noSubmissions')}</p>}
      {closed.length > 0 && (
        <>
          <div style={{ marginTop: 'var(--space-4)' }}><Meta>{t('admin.submissionsClosed')}</Meta></div>
          {closed.map(renderRow)}
        </>
      )}
    </div>
  )
}

function Users() {
  const { t } = useTranslation()
  const [users, setUsers] = useState<AdminUser[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchAdminUsers()
      .then((r) => { setUsers(r.users); if (r.error) setError(r.error) })
      .catch((e) => setError((e as Error).message))
  }, [])

  if (error && !users) return <Alert>{error}</Alert>
  if (!users) return <Skeleton height={120} />

  return (
    <div style={{ display: 'grid', gap: 'var(--space-2)' }}>
      {error && <Alert>{error}</Alert>}
      <Meta>{t('admin.userCount', { count: users.length, n: formatNumber(users.length) })}</Meta>
      {users.map((u) => (
        <div
          key={u.id}
          style={{
            borderBottom: 'var(--hair) solid var(--line)', padding: 'var(--space-3) 0',
            display: 'flex', alignItems: 'baseline', gap: 'var(--space-3)', flexWrap: 'wrap',
          }}
        >
          <span className="t-body" style={{ fontWeight: 600 }}>{u.email}</span>
          <span className="t-body" style={{ color: 'var(--ink-muted)' }}>
            {[u.firstName, u.lastName].filter(Boolean).join(' ')}
          </span>
          {u.emailVerified && <Badge tone="ok">{t('admin.verified')}</Badge>}
          <span className="t-meta" style={{ color: 'var(--ink-muted)', marginLeft: 'auto' }}>
            {u.createdAt ? new Date(u.createdAt).toLocaleDateString() : ''}
          </span>
        </div>
      ))}
    </div>
  )
}

/* ---- bits ----------------------------------------------------------------- */

function Alert({ children }: { children: ReactNode }) {
  return (
    <p
      role="alert"
      className="t-body"
      style={{
        background: 'var(--alert)', border: 'var(--hair) solid var(--warn)',
        borderRadius: 'var(--radius-tap)', padding: 'var(--space-3)', margin: '0 0 var(--space-3)',
      }}
    >
      {children}
    </p>
  )
}

function Chip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className="t-meta"
      style={{
        minHeight: 36, padding: '0 var(--space-3)',
        borderRadius: 'var(--radius-chip)',
        border: `var(--hair) solid ${active ? 'var(--accent)' : 'var(--line)'}`,
        color: active ? 'var(--accent)' : 'var(--ink-muted)',
        background: 'transparent',
      }}
    >
      {label}
    </button>
  )
}

function fieldStyle(): React.CSSProperties {
  return {
    minHeight: 'var(--tap-min)', padding: 'var(--space-2) var(--space-3)',
    border: 'var(--hair) solid var(--ink-muted)', borderRadius: 'var(--radius-tap)',
    background: 'var(--paper)', color: 'var(--ink)', font: 'var(--type-body)',
  }
}
