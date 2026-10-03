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
import { rejectCrossOrigin } from '../../lib/origin'
import { checkRateLimit, credentialLimits, tooManyRequests } from '../../lib/rate-limit'
import { loginSchema, oauthCallbackSchema, parseBody, registerSchema } from '../../lib/validate'

type Env = {
  WORKOS_API_KEY: string
  WORKOS_CLIENT_ID: string
  SESSION_SECRET?: string
  DB?: any
}

export const onRequest = async (context: any) => {
  const { request } = context
  const env = context.env as Env
  const url = new URL(request.url)
  const pathname = url.pathname
  const method = request.method

  const clientId = env.WORKOS_CLIENT_ID
  const secret = sessionSecret(env)
  // Built lazily inside the try: a deployment without WorkOS secrets must
  // still answer /me with a logged-out user instead of a 500.
  let client: WorkOS | null = null
  const workosClient = () => (client ??= new WorkOS(env.WORKOS_API_KEY, { clientId }))

  const jsonHeaders = { 'Content-Type': 'application/json' }
  const json = (body: unknown, status = 200, headers = new Headers(jsonHeaders)) =>
    new Response(JSON.stringify(body), { status, headers })

  /** Issue a signed session cookie. Without a secret there is no safe session. */
  const issueSession = async (user: { id: string; email: string; firstName?: string | null; emailVerified?: boolean }) => {
    if (!secret) throw new Error('SESSION_SECRET/WORKOS_API_KEY not configured')
    return sessionCookie(await signSession({
      userId: user.id,
      email: user.email,
      firstName: user.firstName,
      emailVerified: user.emailVerified === true,
    }, secret))
  }

  /** Failures from WorkOS carry provider detail; log it, tell the client little. */
  const fail = (label: string, err: unknown, status: number, message: string) => {
    console.error(`auth ${label} failed`, err)
    return json({ error: message }, status)
  }

  // Every state-changing route is same-origin only. The OAuth redirect itself
  // is a GET (never checked); the code exchange is a same-origin fetch.
  const crossOrigin = rejectCrossOrigin(request)
  if (crossOrigin) return crossOrigin

  try {
    // 1. Password login
    if (method === 'POST' && pathname === '/api/auth/password') {
      const parsed = await parseBody(request, loginSchema)
      if (!parsed.ok) return parsed.response
      const { email, password } = parsed.data
      const limited = await checkRateLimit(env.DB, await credentialLimits('password', request, email))
      if (!limited.allowed) return tooManyRequests(limited.retryAfter)

      let res
      try {
        res = await workosClient().userManagement.authenticateWithPassword({ email, password, clientId })
      } catch (err) {
        return fail('password', err, 401, 'Invalid email or password')
      }

      const headers = new Headers(jsonHeaders)
      headers.set('Set-Cookie', await issueSession(res.user))

      return json({ user: res.user }, 200, headers)
    }

    // 2. User registration
    if (method === 'POST' && pathname === '/api/auth/register') {
      const parsed = await parseBody(request, registerSchema)
      if (!parsed.ok) return parsed.response
      const { email, password, firstName, lastName } = parsed.data
      const limited = await checkRateLimit(env.DB, await credentialLimits('register', request, email))
      if (!limited.allowed) return tooManyRequests(limited.retryAfter)

      const workos = workosClient()
      let newUser
      try {
        newUser = await workos.userManagement.createUser({
          email, password, firstName: firstName ?? undefined, lastName: lastName ?? undefined,
        })
      } catch (err) {
        return fail('register', err, 400, 'Could not create the account')
      }

      // A session exists only for an authenticated user. Creating an account
      // proves nothing about who owns the address, so when sign-in is refused
      // (e.g. email verification required) no cookie is issued.
      let auth
      try {
        auth = await workos.userManagement.authenticateWithPassword({ email, password, clientId })
      } catch (err) {
        console.error('auth register: account created, sign-in deferred', err)
        return json({
          pendingVerification: true,
          user: { id: newUser.id, email: newUser.email, firstName: newUser.firstName, lastName: newUser.lastName },
        }, 201)
      }

      const headers = new Headers(jsonHeaders)
      headers.set('Set-Cookie', await issueSession(auth.user))
      return json({ user: auth.user }, 201, headers)
    }

    // 3. OAuth start URL
    if (method === 'GET' && pathname.startsWith('/api/auth/oauth/')) {
      const provider = pathname.replace('/api/auth/oauth/', '') as any
      const redirectUri = url.searchParams.get('redirectUri') || `${url.origin}/auth/callback`
      const authUrl = workosClient().userManagement.getAuthorizationUrl({ provider, redirectUri, clientId })
      return json({ url: authUrl })
    }

    // 4. OAuth code exchange callback
    if (method === 'POST' && pathname === '/api/auth/callback') {
      const parsed = await parseBody(request, oauthCallbackSchema)
      if (!parsed.ok) return parsed.response
      const { code } = parsed.data

      let res
      try {
        res = await workosClient().userManagement.authenticateWithCode({ code, clientId })
      } catch (err) {
        return fail('callback', err, 400, 'Sign-in could not be completed')
      }

      const headers = new Headers(jsonHeaders)
      headers.set('Set-Cookie', await issueSession(res.user))

      return json({ user: res.user }, 200, headers)
    }

    // 5. Current user — the HMAC is verified before the payload is read.
    if (method === 'GET' && pathname === '/api/auth/me') {
      const session = await readSession(request, env)
      if (!session) {
        return json({ user: null })
      }

      try {
        const user = await workosClient().userManagement.getUser(session.userId)
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
  } catch (err) {
    return fail('route', err, 500, 'Auth internal error')
  }
}
