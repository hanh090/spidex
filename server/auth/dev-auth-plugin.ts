import type { Plugin, ViteDevServer } from 'vite'
import fs from 'fs'
import path from 'path'
import {
  authenticateWithPassword,
  createUser,
  getOAuthAuthorizationUrl,
  authenticateWithCode,
  getWorkos,
  type AuthSessionUser,
} from './workos-service'

// In-memory token store for dev server mapped by session ID
const sessionStore = new Map<string, { user: AuthSessionUser; accessToken?: string; refreshToken?: string }>()

function parseCookies(cookieHeader?: string): Record<string, string> {
  const list: Record<string, string> = {}
  if (!cookieHeader) return list

  cookieHeader.split(';').forEach((cookie) => {
    const parts = cookie.split('=')
    const key = parts[0]?.trim()
    const val = parts.slice(1).join('=').trim()
    if (key) list[key] = decodeURIComponent(val)
  })

  return list
}

function generateSessionId(): string {
  return 'sess_' + Math.random().toString(36).substring(2) + Date.now().toString(36)
}

/* ---- dev admin store ------------------------------------------------------
 * The production admin API is D1-backed; in dev the same endpoints are served
 * from a JSON file so the console works with no Cloudflare resources at all.
 * data/admin-store.json is gitignored — it is scratch state, not content.
 */

interface AdminResource {
  id: string
  kind: string
  title: string
  meta: Record<string, unknown>
  published: boolean
  sort: number
  updatedAt: number
}

const ADMIN_STORE_PATH = path.resolve(process.cwd(), 'data/admin-store.json')

function readAdminStore(): AdminResource[] {
  try {
    const raw = JSON.parse(fs.readFileSync(ADMIN_STORE_PATH, 'utf8'))
    return Array.isArray(raw?.resources) ? raw.resources : []
  } catch {
    return []
  }
}

function writeAdminStore(resources: AdminResource[]): void {
  try {
    fs.mkdirSync(path.dirname(ADMIN_STORE_PATH), { recursive: true })
    fs.writeFileSync(ADMIN_STORE_PATH, JSON.stringify({ resources }, null, 2))
  } catch { /* read-only checkout: dev admin degrades to session-only */ }
}

function devIsAdmin(user: AuthSessionUser | undefined): boolean {
  if (!user?.email) return false
  const allow = (process.env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
  return allow.includes(user.email.toLowerCase())
}

/* ---- dev submissions + community pack serving ------------------------------
 * Production stores uploads in the PACKS R2 bucket and gates serving on the
 * D1 publish flag. Dev mirrors that on disk: files land in
 * data/submissions/<packId>/ (gitignored scratch), and /packs/<id>/* falls
 * back to it only while a published kind='pack' row marks it community.
 */
const SUBMISSIONS_DIR = path.resolve(process.cwd(), 'data/submissions')
const PACK_ID_RE = /^[a-z0-9][a-z0-9-]{0,62}$/
const UPLOADABLE_EXT = /\.(json|ndjson|webp|svg|jpe?g|png|gif|avif|mp3|ogg|opus|wav|m4a|woff2?)$/i
const TOP_LEVEL = /^(pack\.json|species\.ndjson|img\/|audio\/|fonts\/)/

const DEV_CONTENT_TYPES: Record<string, string> = {
  '.json': 'application/json', '.ndjson': 'application/x-ndjson',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.png': 'image/png', '.gif': 'image/gif', '.avif': 'image/avif',
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.opus': 'audio/opus', '.wav': 'audio/wav', '.m4a': 'audio/mp4',
  '.woff2': 'font/woff2', '.woff': 'font/woff',
}

function devSanitizePath(raw: string): string | null {
  const p = raw.trim().replace(/^\/+/, '')
  if (!p || p.length > 220) return null
  if (p.includes('..') || p.includes('//') || p.includes('\\')) return null
  if (!/^[a-zA-Z0-9._/-]+$/.test(p)) return null
  if (!TOP_LEVEL.test(p) || !UPLOADABLE_EXT.test(p)) return null
  return p
}

function devFindSubmission(id: string) {
  const row = readAdminStore().find((r) => r.kind === 'submission' && r.id === id)
  return row
}

function devUpdateSubmission(id: string, patch: (m: any) => void) {
  const store = readAdminStore()
  const row = store.find((r) => r.kind === 'submission' && r.id === id)
  if (!row) return null
  patch(row.meta)
  row.updatedAt = Date.now()
  writeAdminStore(store)
  return row
}

/** Serve a community pack file from disk when its pack row is published. */
function handleCommunityPackFile(req: any, res: any, next: () => void): void {
  const m = (req.url ?? '').match(/^\/packs\/([^/]+)\/(.+)$/)
  if (!m || req.method !== 'GET') return next()
  const [, packId, file] = m
  const row = readAdminStore().find((r) => r.kind === 'pack' && r.id === packId && r.published && (r.meta as any)?.community)
  if (!row) return next()
  const rel = devSanitizePath(file.split('?')[0]!)
  if (!rel) return next()
  const fp = path.join(SUBMISSIONS_DIR, packId, rel)
  if (!fp.startsWith(SUBMISSIONS_DIR) || !fs.existsSync(fp) || !fs.statSync(fp).isFile()) return next()
  res.setHeader('Content-Type', DEV_CONTENT_TYPES[path.extname(rel).toLowerCase()] ?? 'application/octet-stream')
  res.setHeader('Content-Security-Policy', "script-src 'none'")
  res.setHeader('Cache-Control', /^(pack\.json|species\.ndjson)$/.test(rel) ? 'no-store' : 'public, max-age=86400')
  fs.createReadStream(fp).pipe(res)
}

export function devAuthPlugin(): Plugin {
  return {
    name: 'spidex-dev-auth-plugin',
    configureServer(server: ViteDevServer) {
      server.middlewares.use(async (req, res, next) => {
        if (req.url?.startsWith('/api/admin/')) {
          return handleAdmin(req, res)
        }
        if (req.url?.startsWith('/api/submissions')) {
          return handleSubmission(req, res)
        }
        if (req.url?.startsWith('/packs/')) {
          return handleCommunityPackFile(req, res, next)
        }
        if (!req.url?.startsWith('/api/auth/')) {
          return next()
        }

        const url = new URL(req.url, `http://${req.headers.host || 'localhost:5173'}`)
        const pathname = url.pathname

        res.setHeader('Content-Type', 'application/json')

        // Helper to read JSON request body
        const readBody = async (): Promise<any> => {
          return new Promise((resolve) => {
            let data = ''
            req.on('data', (chunk) => { data += chunk })
            req.on('end', () => {
              try {
                resolve(data ? JSON.parse(data) : {})
              } catch {
                resolve({})
              }
            })
          })
        }

        try {
          // 1. Password login
          if (req.method === 'POST' && pathname === '/api/auth/password') {
            const { email, password } = await readBody()
            if (!email || !password) {
              res.statusCode = 400
              res.end(JSON.stringify({ error: 'Email and password are required' }))
              return
            }

            try {
              const authRes = await authenticateWithPassword(email, password)
              const sessionId = generateSessionId()
              sessionStore.set(sessionId, authRes)

              // 90-day cookie
              res.setHeader(
                'Set-Cookie',
                `spidex_session=${sessionId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${90 * 24 * 3600}`
              )
              res.statusCode = 200
              res.end(JSON.stringify({ user: authRes.user }))
            } catch (err: any) {
              res.statusCode = 401
              res.end(JSON.stringify({ error: err.message || 'Authentication failed' }))
            }
            return
          }

          // 2. User registration
          if (req.method === 'POST' && pathname === '/api/auth/register') {
            const { email, password, firstName, lastName } = await readBody()
            if (!email || !password) {
              res.statusCode = 400
              res.end(JSON.stringify({ error: 'Email and password are required' }))
              return
            }

            try {
              const newUser = await createUser(email, password, firstName, lastName)
              
              // Auto-authenticate newly created user
              let authRes
              try {
                authRes = await authenticateWithPassword(email, password)
              } catch {
                authRes = { user: newUser }
              }

              const sessionId = generateSessionId()
              sessionStore.set(sessionId, authRes)

              res.setHeader(
                'Set-Cookie',
                `spidex_session=${sessionId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${90 * 24 * 3600}`
              )
              res.statusCode = 201
              res.end(JSON.stringify({ user: authRes.user }))
            } catch (err: any) {
              res.statusCode = 400
              res.end(JSON.stringify({ error: err.message || 'Registration failed' }))
            }
            return
          }

          // 3. OAuth start URL
          if (req.method === 'GET' && pathname.startsWith('/api/auth/oauth/')) {
            const providerKey = pathname.replace('/api/auth/oauth/', '') as 'GoogleOAuth' | 'MicrosoftOAuth' | 'authkit'
            const redirectUri = url.searchParams.get('redirectUri') || `http://${req.headers.host || 'localhost:5173'}/auth/callback`
            
            try {
              const authUrl = getOAuthAuthorizationUrl(providerKey, redirectUri)
              res.statusCode = 200
              res.end(JSON.stringify({ url: authUrl }))
            } catch (err: any) {
              res.statusCode = 500
              res.end(JSON.stringify({ error: err.message || 'Failed to generate OAuth URL' }))
            }
            return
          }

          // 4. OAuth code exchange callback
          if (req.method === 'POST' && pathname === '/api/auth/callback') {
            const { code } = await readBody()
            if (!code) {
              res.statusCode = 400
              res.end(JSON.stringify({ error: 'Authorization code is required' }))
              return
            }

            try {
              const authRes = await authenticateWithCode(code)
              const sessionId = generateSessionId()
              sessionStore.set(sessionId, authRes)

              res.setHeader(
                'Set-Cookie',
                `spidex_session=${sessionId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${90 * 24 * 3600}`
              )
              res.statusCode = 200
              res.end(JSON.stringify({ user: authRes.user }))
            } catch (err: any) {
              res.statusCode = 400
              res.end(JSON.stringify({ error: err.message || 'Failed to exchange authorization code' }))
            }
            return
          }

          // 5. Current user session (me)
          if (req.method === 'GET' && pathname === '/api/auth/me') {
            const cookies = parseCookies(req.headers.cookie)
            const sessionId = cookies['spidex_session']

            if (sessionId && sessionStore.has(sessionId)) {
              const session = sessionStore.get(sessionId)!
              res.statusCode = 200
              res.end(JSON.stringify({ user: session.user }))
            } else {
              res.statusCode = 200
              res.end(JSON.stringify({ user: null }))
            }
            return
          }

          // 6. Sign out / Logout
          if (req.method === 'POST' && pathname === '/api/auth/logout') {
            const cookies = parseCookies(req.headers.cookie)
            const sessionId = cookies['spidex_session']
            if (sessionId) {
              sessionStore.delete(sessionId)
            }

            // Clear cookie
            res.setHeader('Set-Cookie', 'spidex_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0')
            res.statusCode = 200
            res.end(JSON.stringify({ success: true }))
            return
          }

          // Unhandled auth route
          res.statusCode = 404
          res.end(JSON.stringify({ error: 'Auth route not found' }))
        } catch (err: any) {
          res.statusCode = 500
          res.end(JSON.stringify({ error: err.message || 'Internal server error' }))
        }
      })
    },
  }
}

/* ---- /api/submissions/* in dev ----------------------------------------------
 * Same contract as functions/api/submissions/[[catchall]].ts, but files go to
 * data/submissions/<packId>/ instead of R2. Requires a dev session; no admin
 * needed — matching production, where any signed-in user may submit.
 */
async function handleSubmission(req: any, res: any): Promise<void> {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost:5173'}`)
  const pathname = url.pathname
  const method = req.method ?? 'GET'

  res.setHeader('Content-Type', 'application/json')
  const send = (body: unknown, status = 200) => {
    res.statusCode = status
    res.end(JSON.stringify(body))
  }
  const readBody = async (): Promise<any> =>
    new Promise((resolve) => {
      let data = ''
      req.on('data', (chunk: any) => { data += chunk })
      req.on('end', () => {
        try { resolve(data ? JSON.parse(data) : {}) } catch { resolve({}) }
      })
    })

  const sessionId = parseCookies(req.headers.cookie)['spidex_session']
  const user = sessionId ? sessionStore.get(sessionId)?.user : undefined
  if (!user) return send({ error: 'Sign in required' }, 401)

  try {
    if (method === 'GET' && pathname === '/api/submissions/mine') {
      const mine = readAdminStore()
        .filter((r) => r.kind === 'submission' && (r.meta as any)?.submitter?.userId === user.id)
        .map((r) => ({ id: r.id, packId: (r.meta as any).packId, status: (r.meta as any).status, issues: (r.meta as any).issues ?? [], summary: (r.meta as any).summary ?? null, updatedAt: r.updatedAt }))
      return send({ submissions: mine })
    }

    if (method === 'POST' && pathname === '/api/submissions') {
      const body = await readBody()
      const packId = String(body.packId ?? '').trim()
      if (!PACK_ID_RE.test(packId)) return send({ error: 'packId must be lowercase letters, digits and dashes' }, 400)
      const fileCount = Number(body.fileCount)
      const totalBytes = Number(body.totalBytes)
      if (!Number.isInteger(fileCount) || fileCount < 2) return send({ error: 'fileCount must be at least 2' }, 400)
      if (!Number.isFinite(totalBytes) || totalBytes <= 0) return send({ error: 'totalBytes required' }, 400)
      if (fs.existsSync(path.resolve(process.cwd(), 'public/packs', packId, 'pack.json'))) {
        return send({ error: 'That pack id already exists' }, 409)
      }
      const store = readAdminStore()
      const taken = store.find((r) => {
        if (r.kind === 'pack' && r.id === packId && r.published) {
          // The pack's own author may resubmit — that is the update path.
          return (r.meta as any)?.submittedBy?.userId !== user.id
        }
        return r.kind === 'submission' && (r.meta as any)?.packId === packId && ['uploading', 'pending'].includes((r.meta as any)?.status)
      })
      if (taken) return send({ error: 'That pack id is taken' }, 409)

      const id = `sub_${crypto.randomUUID()}`
      store.push({
        id, kind: 'submission', title: packId,
        meta: {
          packId, note: String(body.note ?? '').slice(0, 500),
          submitter: { userId: user.id, email: user.email },
          status: 'uploading', fileCount, totalBytes, receivedFiles: 0, receivedBytes: 0,
        },
        published: false, sort: 0, updatedAt: Date.now(),
      })
      writeAdminStore(store)
      return send({ ok: true, id }, 201)
    }

    const filesMatch = pathname.match(/^\/api\/submissions\/([^/]+)\/files$/)
    if (filesMatch && method === 'PUT') {
      const row = devFindSubmission(decodeURIComponent(filesMatch[1]!))
      if (!row) return send({ error: 'Not found' }, 404)
      const m = row.meta as any
      if (m.submitter?.userId !== user.id) return send({ error: 'Not your submission' }, 403)
      if (m.status !== 'uploading') return send({ error: `Submission is ${m.status}` }, 409)
      const rel = devSanitizePath(url.searchParams.get('path') ?? '')
      if (!rel) return send({ error: 'Unsupported path' }, 400)

      const fp = path.join(SUBMISSIONS_DIR, m.packId, rel)
      fs.mkdirSync(path.dirname(fp), { recursive: true })
      const out = fs.createWriteStream(fp)
      let bytes = 0
      await new Promise<void>((resolve, reject) => {
        req.on('data', (c: any) => { bytes += c.length })
        req.pipe(out)
        req.on('end', () => out.end(() => resolve()))
        req.on('error', reject)
      })
      devUpdateSubmission(row.id, (mm) => { mm.receivedFiles = (mm.receivedFiles ?? 0) + 1; mm.receivedBytes = (mm.receivedBytes ?? 0) + bytes })
      return send({ ok: true, received: (devFindSubmission(row.id)?.meta as any)?.receivedFiles ?? 0 })
    }

    const completeMatch = pathname.match(/^\/api\/submissions\/([^/]+)\/complete$/)
    if (completeMatch && method === 'POST') {
      const row = devFindSubmission(decodeURIComponent(completeMatch[1]!))
      if (!row) return send({ error: 'Not found' }, 404)
      const m = row.meta as any
      if (m.submitter?.userId !== user.id) return send({ error: 'Not your submission' }, 403)
      if (m.status !== 'uploading') return send({ error: `Submission is ${m.status}` }, 409)

      const dir = path.join(SUBMISSIONS_DIR, m.packId)
      const issues: { path: string; message: string }[] = []
      let manifest: any = null
      try { manifest = JSON.parse(fs.readFileSync(path.join(dir, 'pack.json'), 'utf8')) }
      catch { issues.push({ path: 'pack.json', message: 'missing or invalid' }) }
      if (manifest) {
        if (manifest.id !== m.packId) issues.push({ path: 'pack.json', message: `id "${manifest.id}" != "${m.packId}"` })
        if (!manifest.name?.en) issues.push({ path: 'pack.json', message: 'name.en missing' })
        if (!manifest.traitSchema?.traits?.length) issues.push({ path: 'pack.json', message: 'traitSchema.traits missing' })
      }
      let count = 0
      try {
        for (const line of fs.readFileSync(path.join(dir, 'species.ndjson'), 'utf8').split('\n')) {
          if (!line.trim()) continue
          count++
          const sp = JSON.parse(line)
          if (!sp.id || !sp.sciName) issues.push({ path: 'species.ndjson', message: `line ${count}: id/sciName missing` })
        }
      } catch { issues.push({ path: 'species.ndjson', message: 'missing or invalid' }) }
      if (!count) issues.push({ path: 'species.ndjson', message: 'no species records' })
      if (manifest && Number.isInteger(manifest.speciesCount) && count !== manifest.speciesCount) {
        issues.push({ path: 'species.ndjson', message: `${count} records, manifest declares ${manifest.speciesCount}` })
      }
      if (manifest && !issues.length) {
        m.summary = {
          name: manifest.name, region: manifest.region, taxonGroup: manifest.taxonGroup,
          version: manifest.version, speciesCount: manifest.speciesCount, sizeBytes: manifest.sizeBytes,
        }
      }
      devUpdateSubmission(row.id, (mm) => { mm.issues = issues; mm.status = issues.length ? 'uploading' : 'pending' })
      return issues.length ? send({ ok: false, issues }, 422) : send({ ok: true, status: 'pending' })
    }

    const delMatch = pathname.match(/^\/api\/submissions\/([^/]+)$/)
    if (delMatch && method === 'DELETE') {
      const row = devFindSubmission(decodeURIComponent(delMatch[1]!))
      if (!row) return send({ error: 'Not found' }, 404)
      const m = row.meta as any
      if (m.submitter?.userId !== user.id && !devIsAdmin(user)) return send({ error: 'Not your submission' }, 403)
      if (m.status === 'published') return send({ error: 'Already published' }, 409)
      fs.rmSync(path.join(SUBMISSIONS_DIR, m.packId), { recursive: true, force: true })
      devUpdateSubmission(row.id, (mm) => { mm.status = 'withdrawn' })
      return send({ ok: true })
    }

    return send({ error: 'Not found' }, 404)
  } catch (err: any) {
    return send({ error: err.message || 'Submission error' }, 500)
  }
}

/* ---- /api/admin/* in dev -------------------------------------------------- */

async function handleAdmin(req: any, res: any): Promise<void> {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost:5173'}`)
  const pathname = url.pathname
  const method = req.method ?? 'GET'

  res.setHeader('Content-Type', 'application/json')
  const send = (body: unknown, status = 200) => {
    res.statusCode = status
    res.end(JSON.stringify(body))
  }
  const readBody = async (): Promise<any> =>
    new Promise((resolve) => {
      let data = ''
      req.on('data', (chunk: any) => { data += chunk })
      req.on('end', () => {
        try { resolve(data ? JSON.parse(data) : {}) } catch { resolve({}) }
      })
    })

  const sessionId = parseCookies(req.headers.cookie)['spidex_session']
  const session = sessionId ? sessionStore.get(sessionId) : undefined
  const user = session?.user
  const admin = devIsAdmin(user)

  if (method === 'GET' && pathname === '/api/admin/me') {
    return send({ user: user ?? null, isAdmin: admin, store: true })
  }
  if (!user) return send({ error: 'Sign in required' }, 401)
  if (!admin) return send({ error: 'Not an administrator' }, 403)

  try {
    if (method === 'GET' && pathname === '/api/admin/overview') {
      return send(devOverview())
    }

    if (method === 'GET' && pathname === '/api/admin/resources') {
      const kind = url.searchParams.get('kind')
      const all = readAdminStore().sort((a, b) => a.kind.localeCompare(b.kind) || a.sort - b.sort || a.id.localeCompare(b.id))
      return send({ resources: kind ? all.filter((r) => r.kind === kind) : all })
    }

    if (method === 'POST' && pathname === '/api/admin/resources') {
      const body = await readBody()
      const kind = String(body.kind ?? '').trim()
      const title = String(body.title ?? '').trim()
      if (!kind || !title) return send({ error: 'kind and title are required' }, 400)
      const store = readAdminStore()
      const id = String(body.id ?? crypto.randomUUID())
      store.push({
        id, kind, title,
        meta: body.meta && typeof body.meta === 'object' ? body.meta : {},
        published: body.published !== false,
        sort: Number.isFinite(body.sort) ? body.sort : 0,
        updatedAt: Date.now(),
      })
      writeAdminStore(store)
      return send({ ok: true, id }, 201)
    }

    const resourceMatch = pathname.match(/^\/api\/admin\/resources\/([^/]+)$/)
    if (resourceMatch && method === 'PATCH') {
      const id = decodeURIComponent(resourceMatch[1])
      const body = await readBody()
      const store = readAdminStore()
      const row = store.find((r) => r.id === id)
      if (!row) return send({ error: 'Not found' }, 404)
      if (typeof body.title === 'string') row.title = body.title
      if (body.meta !== undefined && typeof body.meta === 'object') row.meta = body.meta
      if (body.published !== undefined) row.published = !!body.published
      if (Number.isFinite(body.sort)) row.sort = body.sort
      row.updatedAt = Date.now()
      writeAdminStore(store)
      return send({ ok: true })
    }

    if (resourceMatch && method === 'DELETE') {
      const id = decodeURIComponent(resourceMatch[1])
      const store = readAdminStore()
      const next = store.filter((r) => r.id !== id)
      if (next.length === store.length) return send({ error: 'Not found' }, 404)
      writeAdminStore(next)
      return send({ ok: true })
    }

    const publishMatch = pathname.match(/^\/api\/admin\/packs\/([^/]+)\/publish$/)
    if (publishMatch && method === 'POST') {
      const packId = decodeURIComponent(publishMatch[1])
      const body = await readBody()
      const store = readAdminStore()
      let row = store.find((r) => r.kind === 'pack' && r.id === packId)
      if (!row) {
        row = { id: packId, kind: 'pack', title: packId, meta: {}, published: true, sort: 0, updatedAt: Date.now() }
        store.push(row)
      }
      row.published = body.published !== false
      row.updatedAt = Date.now()
      writeAdminStore(store)
      return send({ ok: true, published: row.published })
    }

    if (method === 'GET' && pathname === '/api/admin/submissions') {
      return send({ submissions: readAdminStore().filter((r) => r.kind === 'submission') })
    }

    const reviewMatch = pathname.match(/^\/api\/admin\/submissions\/([^/]+)\/(approve|reject)$/)
    if (reviewMatch && method === 'POST') {
      const row = devFindSubmission(decodeURIComponent(reviewMatch[1]!))
      if (!row) return send({ error: 'Not found' }, 404)
      const m = row.meta as any
      if (!['pending', 'uploading'].includes(m.status)) return send({ error: `Submission is ${m.status}` }, 409)
      if (reviewMatch[2] === 'approve') {
        devUpdateSubmission(row.id, (mm) => { mm.status = 'published'; mm.reviewedBy = user!.email; mm.reviewedAt = Date.now() })
        const store = readAdminStore()
        const existing = store.find((r) => r.kind === 'pack' && r.id === m.packId)
        const meta = { community: true, submissionId: row.id, submittedBy: m.submitter, summary: m.summary ?? {} }
        if (existing) { existing.published = true; existing.meta = meta; existing.updatedAt = Date.now() }
        else store.push({ id: m.packId, kind: 'pack', title: m.packId, meta, published: true, sort: 0, updatedAt: Date.now() })
        writeAdminStore(store)
        return send({ ok: true, packId: m.packId })
      }
      fs.rmSync(path.join(SUBMISSIONS_DIR, m.packId), { recursive: true, force: true })
      devUpdateSubmission(row.id, (mm) => { mm.status = 'rejected'; mm.reviewedBy = user!.email; mm.reviewedAt = Date.now() })
      return send({ ok: true })
    }

    if (method === 'GET' && pathname === '/api/admin/users') {
      try {
        const list = await getWorkos().userManagement.listUsers({ limit: 100 })
        return send({
          users: list.data.map((u: any) => ({
            id: u.id, email: u.email, firstName: u.firstName, lastName: u.lastName,
            emailVerified: u.emailVerified, createdAt: u.createdAt,
          })),
        })
      } catch {
        return send({ users: [], error: 'users unavailable in dev' })
      }
    }

    return send({ error: 'Not found' }, 404)
  } catch (err: any) {
    return send({ error: err.message || 'Admin internal error' }, 500)
  }
}

/**
 * Inventory from the real files on disk — the same pack.json documents the
 * production overview reads through the ASSETS binding.
 */
function devOverview() {
  const packsDir = path.resolve(process.cwd(), 'public/packs')
  let index: { packs?: string[]; featured?: string[] } = {}
  try {
    index = JSON.parse(fs.readFileSync(path.join(packsDir, 'index.json'), 'utf8'))
  } catch { /* no index yet */ }

  const hidden = new Set(
    readAdminStore().filter((r) => r.kind === 'pack' && !r.published).map((r) => r.id),
  )

  const packs = (index.packs ?? []).map((id) => {
    try {
      const m = JSON.parse(fs.readFileSync(path.join(packsDir, id, 'pack.json'), 'utf8'))
      return {
        id: m.id, name: m.name, region: m.region, taxonGroup: m.taxonGroup,
        version: m.version, speciesCount: m.speciesCount, sizeBytes: m.sizeBytes,
        featured: (index.featured ?? []).includes(id),
        published: !hidden.has(id),
      }
    } catch {
      return { id, missing: true }
    }
  })

  // Community packs approved in dev: files live in data/submissions/, so the
  // summary captured at approval time stands in for the manifest read.
  for (const r of readAdminStore()) {
    if (r.kind !== 'pack' || !r.published || !(r.meta as any)?.community) continue
    if ((index.packs ?? []).includes(r.id)) continue
    packs.push({ id: r.id, community: true, published: true, ...((r.meta as any).summary ?? {}) })
  }

  return { packs, catalogueError: null, store: true, generatedAt: Date.now() }
}
