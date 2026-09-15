/**
 * Cloudflare Pages Functions handler for /api/auth/*
 * Serves authentication endpoints on the same origin as the PWA.
 */
import { WorkOS } from '@workos-inc/node'

interface Env {
  WORKOS_API_KEY: string
  WORKOS_CLIENT_ID: string
}

function parseCookies(cookieHeader: string | null): Record<string, string> {
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

export const onRequest = async (context: any) => {
  const { request, env } = context
  const url = new URL(request.url)
  const pathname = url.pathname
  const method = request.method

  const workos = new WorkOS(env.WORKOS_API_KEY, { clientId: env.WORKOS_CLIENT_ID })
  const clientId = env.WORKOS_CLIENT_ID

  const jsonHeaders = { 'Content-Type': 'application/json' }

  try {
    // 1. Password login
    if (method === 'POST' && pathname === '/api/auth/password') {
      const body: any = await request.json().catch(() => ({}))
      const { email, password } = body
      if (!email || !password) {
        return new Response(JSON.stringify({ error: 'Email and password required' }), { status: 400, headers: jsonHeaders })
      }

      const res = await workos.userManagement.authenticateWithPassword({ email, password, clientId })
      
      const sessionPayload = JSON.stringify({
        userId: res.user.id,
        email: res.user.email,
        firstName: res.user.firstName,
        lastName: res.user.lastName,
      })

      const encoded = btoa(sessionPayload)
      const headers = new Headers(jsonHeaders)
      headers.set('Set-Cookie', `spidex_session=${encoded}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${90 * 24 * 3600}`)

      return new Response(JSON.stringify({ user: res.user }), { status: 200, headers })
    }

    // 2. User registration
    if (method === 'POST' && pathname === '/api/auth/register') {
      const body: any = await request.json().catch(() => ({}))
      const { email, password, firstName, lastName } = body
      if (!email || !password) {
        return new Response(JSON.stringify({ error: 'Email and password required' }), { status: 400, headers: jsonHeaders })
      }

      const newUser = await workos.userManagement.createUser({ email, password, firstName, lastName })
      let userRes = newUser
      let encoded = btoa(JSON.stringify({ userId: newUser.id, email: newUser.email, firstName: newUser.firstName }))
      
      try {
        const auth = await workos.userManagement.authenticateWithPassword({ email, password, clientId })
        userRes = auth.user
        encoded = btoa(JSON.stringify({ userId: auth.user.id, email: auth.user.email, firstName: auth.user.firstName }))
      } catch {
        // user created, pending verification
      }

      const headers = new Headers(jsonHeaders)
      headers.set('Set-Cookie', `spidex_session=${encoded}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${90 * 24 * 3600}`)

      return new Response(JSON.stringify({ user: userRes }), { status: 201, headers })
    }

    // 3. OAuth start URL
    if (method === 'GET' && pathname.startsWith('/api/auth/oauth/')) {
      const provider = pathname.replace('/api/auth/oauth/', '') as any
      const redirectUri = url.searchParams.get('redirectUri') || `${url.origin}/auth/callback`
      const authUrl = workos.userManagement.getAuthorizationUrl({ provider, redirectUri, clientId })
      return new Response(JSON.stringify({ url: authUrl }), { status: 200, headers: jsonHeaders })
    }

    // 4. OAuth code exchange callback
    if (method === 'POST' && pathname === '/api/auth/callback') {
      const body: any = await request.json().catch(() => ({}))
      const { code } = body
      if (!code) {
        return new Response(JSON.stringify({ error: 'Code required' }), { status: 400, headers: jsonHeaders })
      }

      const res = await workos.userManagement.authenticateWithCode({ code, clientId })
      const encoded = btoa(JSON.stringify({ userId: res.user.id, email: res.user.email, firstName: res.user.firstName }))

      const headers = new Headers(jsonHeaders)
      headers.set('Set-Cookie', `spidex_session=${encoded}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${90 * 24 * 3600}`)

      return new Response(JSON.stringify({ user: res.user }), { status: 200, headers })
    }

    // 5. Current user
    if (method === 'GET' && pathname === '/api/auth/me') {
      const cookies = parseCookies(request.headers.get('Cookie'))
      const session = cookies['spidex_session']

      if (!session) {
        return new Response(JSON.stringify({ user: null }), { status: 200, headers: jsonHeaders })
      }

      try {
        const decoded = JSON.parse(atob(session))
        const user = await workos.userManagement.getUser(decoded.userId)
        return new Response(JSON.stringify({ user }), { status: 200, headers: jsonHeaders })
      } catch {
        return new Response(JSON.stringify({ user: null }), { status: 200, headers: jsonHeaders })
      }
    }

    // 6. Sign out
    if (method === 'POST' && pathname === '/api/auth/logout') {
      const headers = new Headers(jsonHeaders)
      headers.set('Set-Cookie', 'spidex_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0')
      return new Response(JSON.stringify({ success: true }), { status: 200, headers })
    }

    return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers: jsonHeaders })
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message || 'Auth internal error' }), { status: 500, headers: jsonHeaders })
  }
}
