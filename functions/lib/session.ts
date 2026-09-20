/**
 * Signed session cookies for Pages Functions.
 *
 * The previous format was bare base64 JSON — readable AND writable by anyone,
 * so `userId` was forgeable with a one-line edit in devtools. Sessions are now
 * `base64(payload).base64(hmac-sha256)`; verification runs the HMAC before the
 * payload is ever parsed. WebCrypto is native to the Functions runtime.
 */

const enc = new TextEncoder()

export interface SessionPayload {
  userId: string
  email: string
  firstName?: string | null
}

function toB64(buf: ArrayBuffer): string {
  let bin = ''
  const bytes = new Uint8Array(buf)
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!)
  return btoa(bin)
}

function fromB64(s: string): ArrayBuffer | null {
  try {
    return Uint8Array.from(atob(s), (c) => c.charCodeAt(0)).buffer
  } catch {
    return null
  }
}

/**
 * Signing key: SESSION_SECRET when configured, else the WorkOS API key, which
 * is already a server-only secret on every environment that has auth at all.
 * A deployment with neither has no business issuing sessions — callers treat
 * a null secret as misconfiguration and refuse to sign.
 */
export function sessionSecret(env: Record<string, unknown>): string | null {
  const s = env.SESSION_SECRET || env.WORKOS_API_KEY
  return typeof s === 'string' && s.length ? s : null
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
    'verify',
  ])
}

export async function signSession(payload: SessionPayload, secret: string): Promise<string> {
  const body = btoa(JSON.stringify(payload))
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(body))
  return `${body}.${toB64(sig)}`
}

export async function verifySession(token: string, secret: string): Promise<SessionPayload | null> {
  const dot = token.lastIndexOf('.')
  if (dot <= 0) return null
  const body = token.slice(0, dot)
  const sig = fromB64(token.slice(dot + 1))
  if (!sig) return null
  const ok = await crypto.subtle.verify('HMAC', await hmacKey(secret), sig, enc.encode(body))
  if (!ok) return null
  try {
    const payload = JSON.parse(atob(body)) as SessionPayload
    return typeof payload.userId === 'string' && typeof payload.email === 'string' ? payload : null
  } catch {
    return null
  }
}

export function parseCookies(cookieHeader: string | null): Record<string, string> {
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

/** Session payload from the request's cookie, or null when absent/invalid. */
export async function readSession(request: Request, env: Record<string, unknown>): Promise<SessionPayload | null> {
  const secret = sessionSecret(env)
  if (!secret) return null
  const token = parseCookies(request.headers.get('Cookie'))['spidex_session']
  if (!token) return null
  return verifySession(token, secret)
}

/** Admin gate: signed-in AND on the ADMIN_EMAILS allowlist (comma-separated). */
export function isAdmin(payload: SessionPayload | null, env: Record<string, unknown>): boolean {
  if (!payload?.email) return false
  const raw = env.ADMIN_EMAILS
  if (typeof raw !== 'string' || !raw.trim()) return false
  const allow = raw.split(',').map((e) => e.trim().toLowerCase())
  return allow.includes(payload.email.toLowerCase())
}

export function sessionCookie(token: string): string {
  return `spidex_session=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${90 * 24 * 3600}`
}
