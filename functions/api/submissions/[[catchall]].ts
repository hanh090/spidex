/**
 * /api/submissions/* — community pack uploads.
 *
 * Any signed-in user may submit; nothing here requires admin. Lifecycle:
 *   POST /api/submissions            declare { packId, fileCount, totalBytes }
 *   PUT  /api/submissions/:id/files  upload one file per request (?path=)
 *   POST /api/submissions/:id/complete  finish → server re-validates → pending
 *   GET  /api/submissions/mine       the caller's own submissions
 *   DELETE /api/submissions/:id      withdraw while uploading/pending/rejected
 *
 * Files stream into the PACKS bucket at submissions/<submissionId>/<path>, a
 * staging area nothing serves. Approval (admin API) points a D1 `kind='pack'`
 * row at that prefix; withdraw only ever deletes this submission's own prefix.
 */
import { readSession } from '../../lib/session'
import {
  isValidPackId, sanitizePath, checkManifest, checkSpeciesNdjson, deletePrefix, isRealAsset,
  submissionPrefix,
  MAX_FILE_BYTES, MAX_TOTAL_BYTES, MAX_FILES, MAX_PENDING_PER_USER,
  type SubmissionMeta,
} from '../../lib/submissions'

interface Env {
  SESSION_SECRET?: string
  WORKOS_API_KEY?: string
  ADMIN_EMAILS?: string
  DB?: any
  PACKS?: { put: (key: string, body: any, opts?: any) => Promise<any>; get: (key: string) => Promise<any>; delete: (key: any) => Promise<any>; list: (opts?: any) => Promise<any> }
  ASSETS?: { fetch: (input: Request | string) => Promise<Response> }
}

const JSON_HEADERS = { 'Content-Type': 'application/json' }
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: JSON_HEADERS })

interface Row { id: string; kind: string; title: string; meta: string; published: number; sort: number; updated_at: number }

const meta = (r: Row): SubmissionMeta => {
  try { return JSON.parse(r.meta) as SubmissionMeta } catch { return { packId: '', submitter: { userId: '', email: '' }, status: 'uploading', fileCount: 0, totalBytes: 0, receivedFiles: 0, receivedBytes: 0 } }
}

async function getSubmission(env: Env, id: string): Promise<{ row: Row; meta: SubmissionMeta } | null> {
  const row = (await env.DB.prepare('SELECT * FROM admin_resources WHERE id = ? AND kind = ?')
    .bind(id, 'submission').first()) as Row | null
  return row ? { row, meta: meta(row) } : null
}

const changed = (res: any) => (res?.meta?.changes ?? 0) > 0

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
        "SELECT * FROM admin_resources WHERE kind = 'submission' AND json_extract(meta, '$.submitter.userId') = ? ORDER BY updated_at DESC",
      ).bind(session.userId).all()
      const mine = (results as Row[]).map((r) => {
        const m = meta(r)
        return { id: r.id, packId: m.packId, status: m.status, issues: m.issues ?? [], summary: m.summary ?? null, updatedAt: r.updated_at }
      })
      return json({ submissions: mine })
    }

    if (method === 'POST' && pathname === '/api/submissions') {
      if (!env.DB || !env.PACKS) return json({ error: 'Submissions are not configured on this deployment' }, 503)
      const body: any = await request.json().catch(() => ({}))
      const packId = String(body.packId ?? '').trim()
      const note = String(body.note ?? '').slice(0, 500)
      const fileCount = Number(body.fileCount)
      const totalBytes = Number(body.totalBytes)

      if (!isValidPackId(packId)) return json({ error: 'packId must be lowercase letters, digits and dashes, and not a reserved name' }, 400)
      if (!Number.isInteger(fileCount) || fileCount < 2 || fileCount > MAX_FILES)
        return json({ error: `fileCount must be between 2 and ${MAX_FILES}` }, 400)
      if (!Number.isFinite(totalBytes) || totalBytes <= 0 || totalBytes > MAX_TOTAL_BYTES)
        return json({ error: `totalBytes must be between 1 and ${MAX_TOTAL_BYTES}` }, 400)

      // Id must be free: not a shipped pack, and not any existing pack row
      // (published or unpublished) unless the caller is that pack's author —
      // resubmission is the update path.
      if (env.ASSETS) {
        const taken = await env.ASSETS.fetch(new Request(`${url.origin}/packs/${packId}/pack.json`))
        if (isRealAsset(taken)) return json({ error: 'That pack id already exists' }, 409)
      }
      const existing = await env.DB.prepare(
        "SELECT meta FROM admin_resources WHERE kind = 'pack' AND id = ?",
      ).bind(packId).first()
      if (existing) {
        let owned = false
        try {
          const em = JSON.parse((existing as any).meta)
          owned = !!em?.community && em?.submittedBy?.userId === session.userId
        } catch { /* not owned */ }
        if (!owned) return json({ error: 'That pack id already exists' }, 409)
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
      // Claim and insert in one statement so two concurrent claims of the same
      // id cannot both succeed.
      const claim = await env.DB.prepare(
        `INSERT INTO admin_resources (id, kind, title, meta, published, sort, updated_at)
         SELECT ?, 'submission', ?, ?, 0, 0, ?
         WHERE NOT EXISTS (
           SELECT 1 FROM admin_resources
           WHERE kind = 'submission' AND json_extract(meta, '$.packId') = ?
             AND json_extract(meta, '$.status') IN ('uploading','pending'))`,
      ).bind(id, packId, JSON.stringify(m), Date.now(), packId).run()
      if (!changed(claim)) return json({ error: 'That pack id is already being submitted' }, 409)
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
      if (!request.body) return json({ error: 'Empty body' }, 400)

      // Reserve the slot atomically before writing: the guards live in the
      // WHERE clause, so parallel uploads cannot all pass on a stale counter.
      const reserve = await env.DB.prepare(
        `UPDATE admin_resources SET updated_at = ?, meta = json_set(meta,
           '$.receivedFiles', json_extract(meta, '$.receivedFiles') + 1,
           '$.receivedBytes', json_extract(meta, '$.receivedBytes') + ?)
         WHERE id = ? AND kind = 'submission'
           AND json_extract(meta, '$.status') = 'uploading'
           AND json_extract(meta, '$.receivedFiles') < json_extract(meta, '$.fileCount')
           AND json_extract(meta, '$.receivedBytes') + ? <= json_extract(meta, '$.totalBytes') * 1.05`,
      ).bind(Date.now(), len, found.row.id, len).run()
      if (!changed(reserve)) return json({ error: 'File count or byte budget exceeded' }, 413)

      try {
        await env.PACKS.put(`${submissionPrefix(found.row.id)}/${path}`, request.body)
      } catch (err) {
        // Give the slot back so a retry of the same file does not double count.
        await env.DB.prepare(
          `UPDATE admin_resources SET meta = json_set(meta,
             '$.receivedFiles', json_extract(meta, '$.receivedFiles') - 1,
             '$.receivedBytes', json_extract(meta, '$.receivedBytes') - ?)
           WHERE id = ?`,
        ).bind(len, found.row.id).run().catch(() => undefined)
        throw err
      }
      return json({ ok: true, received: found.meta.receivedFiles + 1 })
    }

    const completeMatch = pathname.match(/^\/api\/submissions\/([^/]+)\/complete$/)
    if (completeMatch && method === 'POST') {
      if (!env.DB || !env.PACKS) return json({ error: 'Submissions are not configured' }, 503)
      const found = await getSubmission(env, decodeURIComponent(completeMatch[1]!))
      if (!found) return json({ error: 'Not found' }, 404)
      if (found.meta.submitter.userId !== session.userId) return json({ error: 'Not your submission' }, 403)
      if (found.meta.status !== 'uploading') return json({ error: `Submission is ${found.meta.status}` }, 409)

      const prefix = submissionPrefix(found.row.id)
      const issues: { path: string; message: string }[] = []
      let summary: SubmissionMeta['summary'] | undefined

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
          summary = {
            name: manifest.name, region: manifest.region, taxonGroup: manifest.taxonGroup,
            version: manifest.version, speciesCount: manifest.speciesCount, sizeBytes: manifest.sizeBytes,
          }
        }
      }

      // Targeted json_set (not a whole-meta overwrite) so counters written by
      // in-flight uploads are never clobbered.
      await env.DB.prepare(
        `UPDATE admin_resources SET updated_at = ?, meta = json_set(meta,
           '$.issues', json(?), '$.summary', json(?), '$.status', ?)
         WHERE id = ? AND json_extract(meta, '$.status') = 'uploading'`,
      ).bind(Date.now(), JSON.stringify(issues), JSON.stringify(summary ?? null), issues.length ? 'uploading' : 'pending', found.row.id).run()
      return issues.length
        ? json({ ok: false, issues }, 422)
        : json({ ok: true, status: 'pending' })
    }

    const delMatch = pathname.match(/^\/api\/submissions\/([^/]+)$/)
    if (delMatch && method === 'DELETE') {
      if (!env.DB) return json({ error: 'Submissions are not configured' }, 503)
      const found = await getSubmission(env, decodeURIComponent(delMatch[1]!))
      if (!found) return json({ error: 'Not found' }, 404)
      const mine = found.meta.submitter.userId === session.userId
      const admin = (env.ADMIN_EMAILS ?? '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean).includes(session.email.toLowerCase())
      if (!mine && !admin) return json({ error: 'Not your submission' }, 403)

      // Flip the status first and only from a withdrawable state: if approval
      // wins the race the update matches nothing and nothing is deleted. A
      // second DELETE on an already-withdrawn row re-runs the (idempotent)
      // cleanup of the same staging prefix.
      const flip = await env.DB.prepare(
        `UPDATE admin_resources SET updated_at = ?, meta = json_set(meta, '$.status', 'withdrawn')
         WHERE id = ? AND kind = 'submission'
           AND json_extract(meta, '$.status') IN ('uploading','pending','rejected','withdrawn')`,
      ).bind(Date.now(), found.row.id).run()
      if (!changed(flip)) return json({ error: `Submission is ${found.meta.status} — unpublish via the admin console` }, 409)

      // Only this submission's staging prefix; a published pack's files live
      // under a different prefix and are never reachable from here.
      if (env.PACKS) await deletePrefix(env.PACKS, submissionPrefix(found.row.id))
      return json({ ok: true })
    }

    return json({ error: 'Not found' }, 404)
  } catch (err) {
    console.error('submissions error', err)
    return json({ error: 'Submission error' }, 500)
  }
}
