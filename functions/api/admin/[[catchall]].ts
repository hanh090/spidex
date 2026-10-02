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

interface Env {
  WORKOS_API_KEY: string
  WORKOS_CLIENT_ID: string
  SESSION_SECRET?: string
  ADMIN_EMAILS?: string
  DB?: any
  PACKS?: any
  ASSETS?: { fetch: (input: Request | string) => Promise<Response> }
}

const JSON_HEADERS = { 'Content-Type': 'application/json' }
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
      const body: any = await request.json().catch(() => ({}))
      const kind = String(body.kind ?? '').trim()
      const title = String(body.title ?? '').trim()
      if (!kind || !title) return json({ error: 'kind and title are required' }, 400)
      const id = String(body.id ?? crypto.randomUUID())
      const meta = JSON.stringify(body.meta ?? {})
      const published = body.published === false ? 0 : 1
      const sort = Number.isFinite(body.sort) ? body.sort : 0
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
      const body: any = await request.json().catch(() => ({}))
      const sets: string[] = ['updated_at = ?']
      const vals: unknown[] = [Date.now()]
      if (typeof body.title === 'string') { sets.push('title = ?'); vals.push(body.title) }
      if (body.meta !== undefined) { sets.push('meta = ?'); vals.push(JSON.stringify(body.meta)) }
      if (body.published !== undefined) { sets.push('published = ?'); vals.push(body.published ? 1 : 0) }
      if (Number.isFinite(body.sort)) { sets.push('sort = ?'); vals.push(body.sort) }
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
      const body: any = await request.json().catch(() => ({}))
      const published = body.published === false ? 0 : 1
      await env.DB.prepare(
        `INSERT INTO admin_resources (id, kind, title, meta, published, sort, updated_at)
         VALUES (?, 'pack', ?, '{}', ?, 0, ?)
         ON CONFLICT(id) DO UPDATE SET published = excluded.published, updated_at = excluded.updated_at`,
      ).bind(packId, packId, published, Date.now()).run()
      await audit(env, session, published ? 'pack.publish' : 'pack.unpublish', packId)
      return json({ ok: true, published: !!published })
    }

    // Community pack review: submissions are admin_resources rows of
    // kind='submission'. Approving flips a kind='pack' flag — the catalogue
    // merge and the /packs/* asset route both consult it, so no files move.
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
      const row = (await env.DB.prepare(
        "SELECT * FROM admin_resources WHERE id = ? AND kind = 'submission'",
      ).bind(subId).first()) as ResourceRow | null
      if (!row) return json({ error: 'Not found' }, 404)
      let sm: any = {}
      try { sm = JSON.parse(row.meta) } catch { /* keep {} */ }
      if (!['pending', 'uploading'].includes(sm.status)) {
        return json({ error: `Submission is ${sm.status}` }, 409)
      }

      if (action === 'approve') {
        sm.status = 'published'
        sm.reviewedBy = session.email
        sm.reviewedAt = Date.now()
        await env.DB.prepare(
          'UPDATE admin_resources SET meta = ?, updated_at = ? WHERE id = ?',
        ).bind(JSON.stringify(sm), sm.reviewedAt, subId).run()
        await env.DB.prepare(
          `INSERT INTO admin_resources (id, kind, title, meta, published, sort, updated_at)
           VALUES (?, 'pack', ?, ?, 1, 0, ?)
           ON CONFLICT(id) DO UPDATE SET published = 1, meta = excluded.meta, updated_at = excluded.updated_at`,
        ).bind(
          sm.packId, sm.packId,
          JSON.stringify({ community: true, submissionId: subId, submittedBy: sm.submitter, summary: sm.summary ?? {} }),
          sm.reviewedAt,
        ).run()
        await audit(env, session, 'submission.approve', `${subId}:${sm.packId}`)
        return json({ ok: true, packId: sm.packId })
      }

      // Reject: remove the uploaded objects so storage cannot leak.
      sm.status = 'rejected'
      sm.reviewedBy = session.email
      sm.reviewedAt = Date.now()
      if (env.PACKS && sm.packId) {
        let cursor: string | undefined
        do {
          const page: any = await env.PACKS.list({ prefix: `packs/${sm.packId}/`, cursor })
          for (const o of page.objects ?? []) await env.PACKS.delete(o.key)
          cursor = page.truncated ? page.cursor : undefined
        } while (cursor)
      }
      await env.DB.prepare(
        'UPDATE admin_resources SET meta = ?, updated_at = ? WHERE id = ?',
      ).bind(JSON.stringify(sm), sm.reviewedAt, subId).run()
      await audit(env, session, 'submission.reject', `${subId}:${sm.packId}`)
      return json({ ok: true })
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
  } catch (err: any) {
    return json({ error: err.message || 'Admin internal error' }, 500)
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
      if (indexRes.ok) {
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
                if (meta?.community) communityRows.push({ id: r.id, meta })
              } catch { /* malformed meta */ }
            }
          }
        }
        for (const id of index.packs ?? []) {
          try {
            const mres = await env.ASSETS.fetch(new Request(`${origin}/packs/${id}/pack.json`))
            if (!mres.ok) { packs.push({ id, missing: true }); continue }
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
      catalogueError = (e as Error).message
    }
  } else {
    catalogueError = 'assets binding unavailable'
  }

  return { packs, catalogueError, store: !!env.DB, generatedAt: Date.now() }
}
