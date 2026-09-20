/**
 * Cloudflare Pages Functions handler for /api/auth/*
 * Serves authentication endpoints on the same origin as the PWA.
 *
 * Session cookies are HMAC-signed (see functions/lib/session.ts). Unsigned
 * cookies from before the signing change fail verification and read as
 * logged-out — the fix is signing in again, once.
 */
import { WorkOS } from '@workos-inc/node'
import { readSession, sessionCookie, sessionSecret, signSession } from '../../lib/session'

interface Env {
  WORKOS_API_KEY: string
  WORKOS_CLIENT_ID: string
  SESSION_SECRET?: string
}

export const onRequest = async (context: any) => {
  const { request, env } = context
  const url = new URL(request.url)
  const pathname = url.pathname
  const method = request.method

  const workos = new WorkOS(env.WORKOS_API_KEY, { clientId: env.WORKOS_CLIENT_ID })
  const clientId = env.WORKOS_CLIENT_ID
  const secret = sessionSecret(env)

  const jsonHeaders = { 'Content-Type': 'application/json' }
  const json = (body: unknown, status = 200, headers = new Headers(jsonHeaders)) =>
    new Response(JSON.stringify(body), { status, headers })

  /** Issue a signed session cookie. Without a secret there is no safe session. */
  const issueSession = async (payload: { userId: string; email: string; firstName?: string | null }) => {
    if (!secret) throw new Error('SESSION_SECRET/WORKOS_API_KEY not configured')
    return sessionCookie(await signSession(payload, secret))
  }

  try {
    // 1. Password login
    if (method === 'POST' && pathname === '/api/auth/password') {
      const body: any = await request.json().catch(() => ({}))
      const { email, password } = body
      if (!email || !password) {
        return json({ error: 'Email and password required' }, 400)
      }

      const res = await workos.userManagement.authenticateWithPassword({ email, password, clientId })

      const headers = new Headers(jsonHeaders)
      headers.set('Set-Cookie', await issueSession({
        userId: res.user.id,
        email: res.user.email,
        firstName: res.user.firstName,
      }))

      return json({ user: res.user }, 200, headers)
    }

    // 2. User registration
    if (method === 'POST' && pathname === '/api/auth/register') {
      const body: any = await request.json().catch(() => ({}))
      const { email, password, firstName, lastName } = body
      if (!email || !password) {
        return json({ error: 'Email and password required' }, 400)
      }

      const newUser = await workos.userManagement.createUser({ email, password, firstName, lastName })
      let userRes = newUser
      let sessionPayload = { userId: newUser.id, email: newUser.email, firstName: newUser.firstName }

      try {
        const auth = await workos.userManagement.authenticateWithPassword({ email, password, clientId })
        userRes = auth.user
        sessionPayload = { userId: auth.user.id, email: auth.user.email, firstName: auth.user.firstName }
      } catch {
        // user created, pending verification
      }

      const headers = new Headers(jsonHeaders)
      headers.set('Set-Cookie', await issueSession(sessionPayload))

      return json({ user: userRes }, 201, headers)
    }

    // 3. OAuth start URL
    if (method === 'GET' && pathname.startsWith('/api/auth/oauth/')) {
      const provider = pathname.replace('/api/auth/oauth/', '') as any
      const redirectUri = url.searchParams.get('redirectUri') || `${url.origin}/auth/callback`
      const authUrl = workos.userManagement.getAuthorizationUrl({ provider, redirectUri, clientId })
      return json({ url: authUrl })
    }

    // 4. OAuth code exchange callback
    if (method === 'POST' && pathname === '/api/auth/callback') {
      const body: any = await request.json().catch(() => ({}))
      const { code } = body
      if (!code) {
        return json({ error: 'Code required' }, 400)
      }

      const res = await workos.userManagement.authenticateWithCode({ code, clientId })

      const headers = new Headers(jsonHeaders)
      headers.set('Set-Cookie', await issueSession({
        userId: res.user.id,
        email: res.user.email,
        firstName: res.user.firstName,
      }))

      return json({ user: res.user }, 200, headers)
    }

    // 5. Current user — the HMAC is verified before the payload is read.
    if (method === 'GET' && pathname === '/api/auth/me') {
      const session = await readSession(request, env)
      if (!session) {
        return json({ user: null })
      }

      try {
        const user = await workos.userManagement.getUser(session.userId)
        return json({ user })
      } catch {
        return json({ user: null })
      }
    }

    // 6. Sign out
    if (method === 'POST' && pathname === '/api/auth/logout') {
      const headers = new Headers(jsonHeaders)
      headers.set('Set-Cookie', 'spidex_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0')
      return json({ success: true }, 200, headers)
    }

    return json({ error: 'Not found' }, 404)
  } catch (err: any) {
    return json({ error: err.message || 'Auth internal error' }, 500)
  }
}
