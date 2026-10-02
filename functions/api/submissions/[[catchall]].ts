/**
 * /api/submissions/* — community pack uploads.
 *
 * Any signed-in user may submit; nothing here requires admin. Lifecycle:
 *   POST /api/submissions            declare { packId, fileCount, totalBytes }
 *   PUT  /api/submissions/:id/files  upload one file per request (?path=)
 *   POST /api/submissions/:id/complete  finish → server re-validates → pending
 *   GET  /api/submissions/mine       the caller's own submissions
 *   DELETE /api/submissions/:id      withdraw while not yet published
 *
 * Files stream straight into the PACKS bucket at packs/<packId>/<path>. The
 * bucket is never public on its own — a D1 `kind='pack'` publish flag is the
 * gate the catalogue merge and the /packs/* asset route both consult.
 */
import { readSession } from '../../lib/session'
import {
  PACK_ID_RE, sanitizePath, checkManifest, checkSpeciesNdjson,
  MAX_FILE_BYTES, MAX_TOTAL_BYTES, MAX_FILES, MAX_PENDING_PER_USER,
  type SubmissionMeta,
} from '../../lib/submissions'

interface Env {
  SESSION_SECRET?: string
  WORKOS_API_KEY?: string
  ADMIN_EMAILS?: string
  DB?: any
  PACKS?: { put: (key: string, body: any, opts?: any) => Promise<any>; get: (key: string) => Promise<any>; delete: (key: string) => Promise<any>; list: (opts?: any) => Promise<any> }
  ASSETS?: { fetch: (input: Request | string) => Promise<Response> }
}

const JSON_HEADERS = { 'Content-Type': 'application/json' }
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: JSON_HEADERS })

interface Row { id: string; kind: string; title: string; meta: string; published: number; sort: number; updated_at: number }

const meta = (r: Row): SubmissionMeta => {
  try { return JSON.parse(r.meta) as SubmissionMeta } catch { return { packId: '', submitter: { userId: '', email: '' }, status: 'uploading', fileCount: 0, totalBytes: 0, receivedFiles: 0, receivedBytes: 0 } }
}
const packPrefix = (m: SubmissionMeta) => `packs/${m.packId}`

async function getSubmission(env: Env, id: string): Promise<{ row: Row; meta: SubmissionMeta } | null> {
  const row = (await env.DB.prepare('SELECT * FROM admin_resources WHERE id = ? AND kind = ?')
    .bind(id, 'submission').first()) as Row | null
  return row ? { row, meta: meta(row) } : null
}

async function putMeta(env: Env, row: Row, m: SubmissionMeta) {
  await env.DB.prepare('UPDATE admin_resources SET meta = ?, updated_at = ? WHERE id = ?')
    .bind(JSON.stringify(m), Date.now(), row.id).run()
}

export const onRequest = async (context: any) => {
  const { request, env } = context as { request: Request; env: Env }
  const url = new URL(request.url)
  const pathname = url.pathname
  const method = request.method

  const session = await readSession(request, env as unknown as Record<string, unknown>)
  if (!session) return json({ error: 'Sign in required' }, 401)

  try {
    if (method === 'GET' && pathname === '/api/submissions/mine') {
      if (!env.DB) return json({ submissions: [] })
      const { results } = await env.DB.prepare(
        "SELECT * FROM admin_resources WHERE kind = 'submission' ORDER BY updated_at DESC",
      ).all()
      const mine = (results as Row[])
        .map((r) => ({ id: r.id, meta: meta(r), updatedAt: r.updated_at }))
        .filter((s) => s.meta.submitter.userId === session.userId)
        .map((s) => ({ id: s.id, packId: s.meta.packId, status: s.meta.status, issues: s.meta.issues ?? [], summary: s.meta.summary ?? null, updatedAt: s.updatedAt }))
      return json({ submissions: mine })
    }

    if (method === 'POST' && pathname === '/api/submissions') {
      if (!env.DB || !env.PACKS) return json({ error: 'Submissions are not configured on this deployment' }, 503)
      const body: any = await request.json().catch(() => ({}))
      const packId = String(body.packId ?? '').trim()
      const note = String(body.note ?? '').slice(0, 500)
      const fileCount = Number(body.fileCount)
      const totalBytes = Number(body.totalBytes)

      if (!PACK_ID_RE.test(packId)) return json({ error: 'packId must be lowercase letters, digits and dashes' }, 400)
      if (!Number.isInteger(fileCount) || fileCount < 2 || fileCount > MAX_FILES)
        return json({ error: `fileCount must be between 2 and ${MAX_FILES}` }, 400)
      if (!Number.isFinite(totalBytes) || totalBytes <= 0 || totalBytes > MAX_TOTAL_BYTES)
        return json({ error: `totalBytes must be between 1 and ${MAX_TOTAL_BYTES}` }, 400)

      // Id must be free: not a shipped pack, not a published community pack,
      // not already claimed by another live submission.
      if (env.ASSETS) {
        const taken = await env.ASSETS.fetch(new Request(`${url.origin}/packs/${packId}/pack.json`))
        if (taken.ok) return json({ error: 'That pack id already exists' }, 409)
      }
      const existing = await env.DB.prepare(
        "SELECT meta FROM admin_resources WHERE kind = 'pack' AND id = ? AND published = 1",
      ).bind(packId).first()
      if (existing) {
        // Resubmission is the update path: allowed only for the pack's own
        // author — new files overwrite the same prefix, approval republishes.
        let owned = false
        try { owned = (JSON.parse((existing as any).meta)?.submittedBy?.userId) === session.userId } catch { /* no */ }
        if (!owned) return json({ error: 'That pack id already exists' }, 409)
      }
      const claimed = await env.DB.prepare(
        "SELECT id, meta FROM admin_resources WHERE kind = 'submission'",
      ).all()
      for (const r of (claimed.results ?? []) as Row[]) {
        const m = meta(r)
        if (m.packId === packId && ['uploading', 'pending'].includes(m.status)) {
          return json({ error: 'That pack id is already being submitted' }, 409)
        }
      }
      const open = await env.DB.prepare(
        "SELECT COUNT(*) AS n FROM admin_resources WHERE kind = 'submission' AND json_extract(meta, '$.submitter.userId') = ? AND json_extract(meta, '$.status') IN ('uploading','pending')",
      ).bind(session.userId).first()
      if (((open as any)?.n ?? 0) >= MAX_PENDING_PER_USER) {
        return json({ error: `Too many open submissions (max ${MAX_PENDING_PER_USER})` }, 429)
      }

      const id = `sub_${crypto.randomUUID()}`
      const m: SubmissionMeta = {
        packId, note,
        submitter: { userId: session.userId, email: session.email },
        status: 'uploading', fileCount, totalBytes, receivedFiles: 0, receivedBytes: 0,
      }
      await env.DB.prepare(
        'INSERT INTO admin_resources (id, kind, title, meta, published, sort, updated_at) VALUES (?, ?, ?, ?, 0, 0, ?)',
      ).bind(id, 'submission', packId, JSON.stringify(m), Date.now()).run()
      return json({ ok: true, id }, 201)
    }

    const filesMatch = pathname.match(/^\/api\/submissions\/([^/]+)\/files$/)
    if (filesMatch && method === 'PUT') {
      if (!env.DB || !env.PACKS) return json({ error: 'Submissions are not configured' }, 503)
      const found = await getSubmission(env, decodeURIComponent(filesMatch[1]!))
      if (!found) return json({ error: 'Not found' }, 404)
      if (found.meta.submitter.userId !== session.userId) return json({ error: 'Not your submission' }, 403)
      if (found.meta.status !== 'uploading') return json({ error: `Submission is ${found.meta.status}` }, 409)

      const path = sanitizePath(url.searchParams.get('path') ?? '')
      if (!path) return json({ error: 'Unsupported path' }, 400)
      const len = Number(request.headers.get('Content-Length') ?? 0)
      if (!len || len > MAX_FILE_BYTES) return json({ error: 'File too large' }, 413)
      if (found.meta.receivedFiles >= found.meta.fileCount) return json({ error: 'File count exceeded' }, 400)
      if (found.meta.receivedBytes + len > found.meta.totalBytes * 1.05) return json({ error: 'Byte budget exceeded' }, 413)
      if (!request.body) return json({ error: 'Empty body' }, 400)

      await env.PACKS.put(`${packPrefix(found.meta)}/${path}`, request.body)
      found.meta.receivedFiles += 1
      found.meta.receivedBytes += len
      await putMeta(env, found.row, found.meta)
      return json({ ok: true, received: found.meta.receivedFiles })
    }

    const completeMatch = pathname.match(/^\/api\/submissions\/([^/]+)\/complete$/)
    if (completeMatch && method === 'POST') {
      if (!env.DB || !env.PACKS) return json({ error: 'Submissions are not configured' }, 503)
      const found = await getSubmission(env, decodeURIComponent(completeMatch[1]!))
      if (!found) return json({ error: 'Not found' }, 404)
      if (found.meta.submitter.userId !== session.userId) return json({ error: 'Not your submission' }, 403)
      if (found.meta.status !== 'uploading') return json({ error: `Submission is ${found.meta.status}` }, 409)

      const prefix = packPrefix(found.meta)
      const issues: { path: string; message: string }[] = []

      const manifestObj = await env.PACKS.get(`${prefix}/pack.json`)
      let manifest: any = null
      if (!manifestObj) {
        issues.push({ path: 'pack.json', message: 'missing' })
      } else {
        try { manifest = await manifestObj.json() } catch { issues.push({ path: 'pack.json', message: 'not valid JSON' }) }
      }
      if (manifest) {
        for (const m of checkManifest(manifest, found.meta.packId)) issues.push({ path: 'pack.json', message: m })
      }

      const ndjsonObj = await env.PACKS.get(`${prefix}/species.ndjson`)
      if (!ndjsonObj) {
        issues.push({ path: 'species.ndjson', message: 'missing' })
      } else {
        const text = await ndjsonObj.text()
        const check = checkSpeciesNdjson(text)
        if (!check.count) issues.push({ path: 'species.ndjson', message: 'no species records' })
        for (const msg of check.issues) issues.push({ path: 'species.ndjson', message: msg })
        if (manifest && Number.isInteger(manifest.speciesCount) && check.count !== manifest.speciesCount) {
          issues.push({ path: 'species.ndjson', message: `${check.count} records, manifest declares ${manifest.speciesCount}` })
        }
        if (manifest) {
          found.meta.summary = {
            name: manifest.name, region: manifest.region, taxonGroup: manifest.taxonGroup,
            version: manifest.version, speciesCount: manifest.speciesCount, sizeBytes: manifest.sizeBytes,
          }
        }
      }

      found.meta.issues = issues
      found.meta.status = issues.length ? 'uploading' : 'pending'
      await putMeta(env, found.row, found.meta)
      return issues.length
        ? json({ ok: false, issues }, 422)
        : json({ ok: true, status: 'pending' })
    }

    const delMatch = pathname.match(/^\/api\/submissions\/([^/]+)$/)
    if (delMatch && method === 'DELETE') {
      const found = await getSubmission(env, decodeURIComponent(delMatch[1]!))
      if (!found) return json({ error: 'Not found' }, 404)
      const mine = found.meta.submitter.userId === session.userId
      const admin = (env.ADMIN_EMAILS ?? '').split(',').map((e) => e.trim().toLowerCase()).includes(session.email.toLowerCase())
      if (!mine && !admin) return json({ error: 'Not your submission' }, 403)
      if (found.meta.status === 'published') return json({ error: 'Already published — unpublish via the admin console' }, 409)

      if (env.PACKS) {
        const listed = await env.PACKS.list({ prefix: `${packPrefix(found.meta)}/` })
        for (const o of (listed as any).objects ?? []) await env.PACKS.delete(o.key)
      }
      found.meta.status = 'withdrawn'
      await putMeta(env, found.row, found.meta)
      return json({ ok: true })
    }

    return json({ error: 'Not found' }, 404)
  } catch (err: any) {
    return json({ error: err.message || 'Submission error' }, 500)
  }
}
