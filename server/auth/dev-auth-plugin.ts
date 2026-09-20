import type { Plugin, ViteDevServer } from 'vite'
import fs from 'fs'
import path from 'path'
import {
  authenticateWithPassword,
  createUser,
  getOAuthAuthorizationUrl,
  authenticateWithCode,
  workos,
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

export function devAuthPlugin(): Plugin {
  return {
    name: 'spidex-dev-auth-plugin',
    configureServer(server: ViteDevServer) {
      server.middlewares.use(async (req, res, next) => {
        if (req.url?.startsWith('/api/admin/')) {
          return handleAdmin(req, res)
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

    if (method === 'GET' && pathname === '/api/admin/users') {
      try {
        const list = await workos.userManagement.listUsers({ limit: 100 })
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

  return { packs, catalogueError: null, store: true, generatedAt: Date.now() }
}
