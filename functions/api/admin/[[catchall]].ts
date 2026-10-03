/**
 * Cloudflare Pages Functions handler for /api/admin/*
 *
 * Every route except `me` requires a signed session whose email is on the
 * ADMIN_EMAILS allowlist. `me` answers for any visitor so the /admin screen
 * can tell "not signed in" from "signed in but not staff" from "staff".
 *
 * Resource rows live in D1 (binding `DB`, table `admin_resources`). With no
 * DB bound the API still answers `me` and `overview` — reads come from the
 * deployed assets themselves — and mutations return 503 `store:false`.
 */
import { WorkOS } from '@workos-inc/node'
import { isAdmin, readSession, type SessionPayload } from '../../lib/session'
import { deletePrefix, isRealAsset, servingPrefix, submissionPrefix } from '../../lib/submissions'
import { bundledPackIds } from '../../lib/bundled-packs'
import { rejectCrossOrigin } from '../../lib/origin'
import {
  parseBody, parseOptionalBody, publishSchema, resourceCreateSchema, resourcePatchSchema,
} from '../../lib/validate'
import { handleMedia, type MediaBackend } from '../../lib/media-admin'

interface Env {
  WORKOS_API_KEY: string
  WORKOS_CLIENT_ID: string
  SESSION_SECRET?: string
  ADMIN_EMAILS?: string
  DB?: any
  PACKS?: any
  ASSETS?: { fetch: (input: Request | string) => Promise<Response> }
}

/** How long a superseded pack version stays in R2 so in-flight downloads finish. */
const SUPERSEDED_GRACE_MS = 24 * 60 * 60 * 1000

const JSON_HEADERS ={ 'Content-Type': 'application/json' }
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: JSON_HEADERS })

/** D1 stores booleans as integers; the API boundary speaks booleans. */
interface ResourceRow {
  id: string
  kind: string
  title: string
  meta: string
  published: number
  sort: number
  updated_at: number
}

function rowToResource(r: ResourceRow) {
  let meta: unknown = {}
  try { meta = JSON.parse(r.meta) } catch { /* keep {} */ }
  return { id: r.id, kind: r.kind, title: r.title, meta, published: !!r.published, sort: r.sort, updatedAt: r.updated_at }
}

export const onRequest = async (context: any) => {
  const { request, env } = context as { request: Request; env: Env }
  const url = new URL(request.url)
  const pathname = url.pathname
  const method = request.method

  const crossOrigin = rejectCrossOrigin(request)
  if (crossOrigin) return crossOrigin

  const session = await readSession(request, env as unknown as Record<string, unknown>)
  const admin = isAdmin(session, env as unknown as Record<string, unknown>)

  // Status is public-by-design: it discloses only whether the caller is staff.
  if (method === 'GET' && pathname === '/api/admin/me') {
    return json({ user: session, isAdmin: admin, store: !!env.DB })
  }

  if (!session) return json({ error: 'Sign in required' }, 401)
  if (!admin) return json({ error: 'Not an administrator' }, 403)

  try {
    if (method === 'GET' && pathname === '/api/admin/overview') {
      return json(await overview(request, env))
    }

    if (pathname === '/api/admin/resources' && method === 'GET') {
      if (!env.DB) return json({ error: 'Admin store not configured', configured: false }, 503)
      const kind = url.searchParams.get('kind')
      const stmt = kind
        ? env.DB.prepare('SELECT * FROM admin_resources WHERE kind = ? ORDER BY sort, id').bind(kind)
        : env.DB.prepare('SELECT * FROM admin_resources ORDER BY kind, sort, id')
      const { results } = await stmt.all()
      return json({ resources: (results as ResourceRow[]).map(rowToResource) })
    }

    if (pathname === '/api/admin/resources' && method === 'POST') {
      if (!env.DB) return json({ error: 'Admin store not configured', configured: false }, 503)
      const parsed = await parseBody(request, resourceCreateSchema)
      if (!parsed.ok) return parsed.response
      const { kind, title } = parsed.data
      const id = parsed.data.id ?? crypto.randomUUID()
      const meta = JSON.stringify(parsed.data.meta ?? {})
      const published = parsed.data.published === false ? 0 : 1
      const sort = parsed.data.sort ?? 0
      await env.DB.prepare(
        'INSERT INTO admin_resources (id, kind, title, meta, published, sort, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ).bind(id, kind, title, meta, published, sort, Date.now()).run()
      await audit(env, session, 'resource.create', `${kind}:${id}`)
      return json({ ok: true, id }, 201)
    }

    const resourceMatch = pathname.match(/^\/api\/admin\/resources\/([^/]+)$/)
    if (resourceMatch && method === 'PATCH') {
      if (!env.DB) return json({ error: 'Admin store not configured', configured: false }, 503)
      const id = decodeURIComponent(resourceMatch[1]!)
      const parsed = await parseBody(request, resourcePatchSchema)
      if (!parsed.ok) return parsed.response
      const body = parsed.data
      const sets: string[] = ['updated_at = ?']
      const vals: unknown[] = [Date.now()]
      if (body.title !== undefined) { sets.push('title = ?'); vals.push(body.title) }
      if (body.meta !== undefined) { sets.push('meta = ?'); vals.push(JSON.stringify(body.meta)) }
      if (body.published !== undefined) { sets.push('published = ?'); vals.push(body.published ? 1 : 0) }
      if (body.sort !== undefined) { sets.push('sort = ?'); vals.push(body.sort) }
      vals.push(id)
      const res = await env.DB.prepare(`UPDATE admin_resources SET ${sets.join(', ')} WHERE id = ?`).bind(...vals).run()
      if (!res.meta?.changes) return json({ error: 'Not found' }, 404)
      await audit(env, session, 'resource.update', id)
      return json({ ok: true })
    }

    if (resourceMatch && method === 'DELETE') {
      if (!env.DB) return json({ error: 'Admin store not configured', configured: false }, 503)
      const id = decodeURIComponent(resourceMatch[1]!)
      const res = await env.DB.prepare('DELETE FROM admin_resources WHERE id = ?').bind(id).run()
      if (!res.meta?.changes) return json({ error: 'Not found' }, 404)
      await audit(env, session, 'resource.delete', id)
      return json({ ok: true })
    }

    // Upsert a pack's publish flag: row id IS the pack id, kind is 'pack'.
    const publishMatch = pathname.match(/^\/api\/admin\/packs\/([^/]+)\/publish$/)
    if (publishMatch && method === 'POST') {
      if (!env.DB) return json({ error: 'Admin store not configured', configured: false }, 503)
      const packId = decodeURIComponent(publishMatch[1]!)
      const parsed = await parseOptionalBody(request, publishSchema)
      if (!parsed.ok) return parsed.response
      const published = parsed.data.published === false ? 0 : 1
      await env.DB.prepare(
        `INSERT INTO admin_resources (id, kind, title, meta, published, sort, updated_at)
         VALUES (?, 'pack', ?, '{}', ?, 0, ?)
         ON CONFLICT(id) DO UPDATE SET published = excluded.published, updated_at = excluded.updated_at`,
      ).bind(packId, packId, published, Date.now()).run()
      await audit(env, session, published ? 'pack.publish' : 'pack.unpublish', packId)
      return json({ ok: true, published: !!published })
    }

    // Community pack review: submissions are admin_resources rows of
    // kind='submission'. Approving writes a kind='pack' row whose meta.prefix
    // points at the submission's staging prefix; the catalogue merge and the
    // /packs/* asset route both serve through that row, so no files move.
    if (method === 'GET' && pathname === '/api/admin/submissions') {
      if (!env.DB) return json({ error: 'Admin store not configured', configured: false }, 503)
      const { results } = await env.DB.prepare(
        "SELECT * FROM admin_resources WHERE kind = 'submission' ORDER BY updated_at DESC",
      ).all()
      return json({ submissions: (results as ResourceRow[]).map(rowToResource) })
    }

    const reviewMatch = pathname.match(/^\/api\/admin\/submissions\/([^/]+)\/(approve|reject)$/)
    if (reviewMatch && method === 'POST') {
      if (!env.DB) return json({ error: 'Admin store not configured', configured: false }, 503)
      const subId = decodeURIComponent(reviewMatch[1]!)
      const action = reviewMatch[2]
      // Approval points a pack row at objects in R2; without the bucket it
      // would publish a pack that cannot be served.
      if (action === 'approve' && !env.PACKS) return json({ error: 'Pack storage not configured', configured: false }, 503)
      const row = (await env.DB.prepare(
        "SELECT * FROM admin_resources WHERE id = ? AND kind = 'submission'",
      ).bind(subId).first()) as ResourceRow | null
      if (!row) return json({ error: 'Not found' }, 404)
      let sm: any = {}
      try { sm = JSON.parse(row.meta) } catch { /* keep {} */ }
      // Approve only a validated (pending) submission; reject may also drop a
      // stalled upload.
      const allowed = action === 'approve' ? ['pending'] : ['pending', 'uploading']
      if (!allowed.includes(sm.status)) {
        return json({ error: `Submission is ${sm.status}` }, 409)
      }
      const reviewedAt = Date.now()

      if (action === 'approve') {
        // An id that already has a pack row may only be re-approved for the
        // community pack's own author (the update path).
        const prev = (await env.DB.prepare(
          "SELECT meta FROM admin_resources WHERE id = ? AND kind = 'pack'",
        ).bind(sm.packId).first()) as { meta: string } | null
        let prevMeta: any = null
        if (prev) {
          try { prevMeta = JSON.parse(prev.meta) } catch { prevMeta = {} }
          if (!prevMeta?.community || prevMeta?.submittedBy?.userId !== sm.submitter?.userId) {
            return json({ error: 'That pack id already exists' }, 409)
          }
        }

        // Atomic claim: only one concurrent approval can flip pending→published.
        const claim = await env.DB.prepare(
          `UPDATE admin_resources SET updated_at = ?, meta = json_set(meta,
             '$.status', 'published', '$.reviewedBy', ?, '$.reviewedAt', ?)
           WHERE id = ? AND kind = 'submission' AND json_extract(meta, '$.status') = 'pending'`,
        ).bind(reviewedAt, session.email, reviewedAt, subId).run()
        if (!claim.meta?.changes) return json({ error: 'Submission is no longer pending' }, 409)

        const prefix = submissionPrefix(subId)
        // Superseded versions are not deleted at once: clients mid-download
        // still read them. The pack row remembers each old prefix with a
        // timestamp; entries older than the grace period are swept on the
        // pack's next approval.
        const oldPrefix = prevMeta ? (typeof prevMeta.prefix === 'string' && prevMeta.prefix ? prevMeta.prefix : `packs/${sm.packId}`) : null
        const carried: { prefix: string; at: number }[] = Array.isArray(prevMeta?.supersededPrefixes)
          ? prevMeta.supersededPrefixes.filter((e: any) => typeof e?.prefix === 'string' && Number.isFinite(e?.at))
          : []
        const due = carried.filter((e) => reviewedAt - e.at >= SUPERSEDED_GRACE_MS && e.prefix !== prefix)
        const supersededPrefixes = carried.filter((e) => !due.includes(e) && e.prefix !== prefix)
        if (oldPrefix && oldPrefix !== prefix && !supersededPrefixes.some((e) => e.prefix === oldPrefix)) {
          supersededPrefixes.push({ prefix: oldPrefix, at: reviewedAt })
        }
        try {
          await env.DB.prepare(
            `INSERT INTO admin_resources (id, kind, title, meta, published, sort, updated_at)
             VALUES (?, 'pack', ?, ?, 1, 0, ?)
             ON CONFLICT(id) DO UPDATE SET published = 1, meta = excluded.meta, updated_at = excluded.updated_at`,
          ).bind(
            sm.packId, sm.packId,
            JSON.stringify({ community: true, submissionId: subId, prefix, submittedBy: sm.submitter, summary: sm.summary ?? {}, supersededPrefixes }),
            reviewedAt,
          ).run()
        } catch (err) {
          // Leave the submission reviewable instead of "published" with no pack.
          await env.DB.prepare(
            "UPDATE admin_resources SET meta = json_set(meta, '$.status', 'pending') WHERE id = ?",
          ).bind(subId).run().catch(() => undefined)
          throw err
        }

        for (const e of due) {
          await deletePrefix(env.PACKS, e.prefix).catch((err: unknown) => console.error('old prefix cleanup failed', err))
        }
        await audit(env, session, 'submission.approve', `${subId}:${sm.packId}`)
        return json({ ok: true, packId: sm.packId })
      }

      // Reject: flip status (only from a reviewable state), then drop this
      // submission's own staging prefix — never a published pack's files.
      const reject = await env.DB.prepare(
        `UPDATE admin_resources SET updated_at = ?, meta = json_set(meta,
           '$.status', 'rejected', '$.reviewedBy', ?, '$.reviewedAt', ?)
         WHERE id = ? AND kind = 'submission' AND json_extract(meta, '$.status') IN ('pending','uploading')`,
      ).bind(reviewedAt, session.email, reviewedAt, subId).run()
      if (!reject.meta?.changes) return json({ error: 'Submission is no longer reviewable' }, 409)
      if (env.PACKS) await deletePrefix(env.PACKS, submissionPrefix(subId))
      await audit(env, session, 'submission.reject', `${subId}:${sm.packId}`)
      return json({ ok: true })
    }

    // Pack image management: edits land in R2 (overrides/ for bundled packs).
    if (pathname.startsWith('/api/admin/media/')) {
      if (!env.PACKS) return json({ error: 'Pack storage not configured', configured: false }, 503)
      const result = await handleMedia(mediaBackend(env, request.url), {
        method,
        path: pathname.slice('/api/admin/media'.length),
        query: url.searchParams,
        contentType: request.headers.get('Content-Type'),
        contentLength: Number(request.headers.get('Content-Length')) || null,
        json: () => request.json(),
        bytes: async () => new Uint8Array(await request.arrayBuffer()),
      })
      if (result.audit) await audit(env, session, result.audit.action, result.audit.detail)
      return json(result.body, result.status)
    }

    if (method === 'GET' && pathname === '/api/admin/users') {
      const workos = new WorkOS(env.WORKOS_API_KEY, { clientId: env.WORKOS_CLIENT_ID })
      const list = await workos.userManagement.listUsers({ limit: 100 })
      const users = list.data.map((u: any) => ({
        id: u.id, email: u.email, firstName: u.firstName, lastName: u.lastName,
        emailVerified: u.emailVerified, createdAt: u.createdAt,
      }))
      return json({ users })
    }

    return json({ error: 'Not found' }, 404)
  } catch (err) {
    console.error('admin error', err)
    return json({ error: 'Admin internal error' }, 500)
  }
}

/** Production storage for the media API: ASSETS for shipped files, R2 for edits, D1 for community packs. */
function mediaBackend(env: Env, requestUrl: string): MediaBackend {
  const assetText = async (path: string) => {
    const res = await env.ASSETS?.fetch(new Request(new URL(path, requestUrl)))
    return res && isRealAsset(res) ? res : null
  }
  return {
    bundledIds: async () => [...(await bundledPackIds(env, requestUrl))],
    communityPacks: async () => {
      if (!env.DB) return []
      const { results } = await env.DB.prepare(
        "SELECT id, meta FROM admin_resources WHERE kind = 'pack' AND published = 1",
      ).all()
      const out: { id: string; prefix: string }[] = []
      for (const r of results as { id: string; meta: string }[]) {
        try {
          const meta = JSON.parse(r.meta)
          if (meta?.community) out.push({ id: r.id, prefix: servingPrefix(r.id, meta) })
        } catch { /* malformed meta: not editable */ }
      }
      return out
    },
    readStatic: async (id, file) => (await assetText(`/packs/${id}/${file}`))?.text() ?? null,
    staticExists: async (id, rel) => !!(await assetText(`/packs/${id}/${rel}`)),
    getObject: async (key) => (await env.PACKS.get(key))?.text() ?? null,
    hasObject: async (key) => !!(await env.PACKS.head(key)),
    putObject: async (key, body, type) => { await env.PACKS.put(key, body, { httpMetadata: { contentType: type } }) },
  }
}

async function audit(env: Env, session: SessionPayload, action: string, detail: string) {
  if (!env.DB) return
  try {
    await env.DB.prepare(
      'INSERT INTO admin_audit (id, actor, action, detail, at) VALUES (?, ?, ?, ?, ?)',
    ).bind(crypto.randomUUID(), session.email, action, detail, Date.now()).run()
  } catch { /* audit must never break the action it records */ }
}

/**
 * Resource inventory. The pack list is read from the deployed assets — the
 * same files the app downloads — and merged with the admin store's publish
 * flags, so the overview is true even before D1 exists.
 */
async function overview(request: Request, env: Env) {
  const packs: unknown[] = []
  let catalogueError: string | null = null

  if (env.ASSETS) {
    try {
      const origin = new URL(request.url).origin
      const indexRes = await env.ASSETS.fetch(new Request(`${origin}/packs/index.json`))
      if (isRealAsset(indexRes)) {
        const index: any = await indexRes.json()
        const hidden = new Set<string>()
        const communityRows: { id: string; meta: any }[] = []
        if (env.DB) {
          const { results } = await env.DB.prepare(
            "SELECT id, published, meta FROM admin_resources WHERE kind = 'pack'",
          ).all()
          for (const r of results as { id: string; published: number; meta: string }[]) {
            if (!r.published) { hidden.add(r.id); continue }
            if (!(index.packs ?? []).includes(r.id)) {
              try {
                const meta = JSON.parse(r.meta)
                if (meta?.community && env.PACKS) communityRows.push({ id: r.id, meta })
              } catch { /* malformed meta */ }
            }
          }
        }
        for (const id of index.packs ?? []) {
          try {
            const mres = await env.ASSETS.fetch(new Request(`${origin}/packs/${id}/pack.json`))
            if (!isRealAsset(mres)) { packs.push({ id, missing: true }); continue }
            const m: any = await mres.json()
            packs.push({
              id: m.id,
              name: m.name,
              region: m.region,
              taxonGroup: m.taxonGroup,
              version: m.version,
              speciesCount: m.speciesCount,
              sizeBytes: m.sizeBytes,
              featured: (index.featured ?? []).includes(id),
              published: !hidden.has(id),
            })
          } catch {
            packs.push({ id, missing: true })
          }
        }
        // Community packs live in R2, not the deployed assets — their
        // manifest summary was captured at approval time and rides in meta.
        for (const c of communityRows) {
          packs.push({ id: c.id, community: true, published: true, ...(c.meta.summary ?? {}) })
        }
      } else {
        catalogueError = `index.json ${indexRes.status}`
      }
    } catch (e) {
      console.error('overview catalogue failed', e)
      catalogueError = 'catalogue unavailable'
    }
  } else {
    catalogueError = 'assets binding unavailable'
  }

  return { packs, catalogueError, store: !!env.DB, generatedAt: Date.now() }
}
