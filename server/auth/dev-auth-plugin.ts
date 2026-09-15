import type { Plugin, ViteDevServer } from 'vite'
import {
  authenticateWithPassword,
  createUser,
  getOAuthAuthorizationUrl,
  authenticateWithCode,
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

export function devAuthPlugin(): Plugin {
  return {
    name: 'spidex-dev-auth-plugin',
    configureServer(server: ViteDevServer) {
      server.middlewares.use(async (req, res, next) => {
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
