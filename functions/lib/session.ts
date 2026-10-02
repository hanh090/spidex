/**
 * Signed session cookies for Pages Functions.
 *
 * The previous format was bare base64 JSON — readable AND writable by anyone,
 * so `userId` was forgeable with a one-line edit in devtools. Sessions are now
 * `b64url(payload).b64url(hmac-sha256)`; verification runs the HMAC before the
 * payload is ever parsed. WebCrypto is native to the Functions runtime.
 */

const enc = new TextEncoder()
const dec = new TextDecoder()

/** Session lifetime. Also the cookie Max-Age, so both ends agree. */
export const SESSION_TTL_SECONDS = 30 * 24 * 3600

export interface SessionPayload {
  userId: string
  email: string
  firstName?: string | null
  /** Only a verified address may pass the admin allowlist. */
  emailVerified?: boolean
  /** Issued-at / expiry, epoch seconds. Stamped by signSession. */
  iat?: number
  exp?: number
}

/** base64url over raw bytes — safe for any UTF-8 payload. */
function toB64(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** Accepts both base64url and the standard alphabet used by older cookies. */
function fromB64(s: string): Uint8Array<ArrayBuffer> | null {
  try {
    const std = s.replace(/-/g, '+').replace(/_/g, '/')
    const padded = std + '='.repeat((4 - (std.length % 4)) % 4)
    return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0))
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

export async function signSession(
  payload: SessionPayload,
  secret: string,
  nowMs: number = Date.now(),
): Promise<string> {
  const iat = Math.floor(nowMs / 1000)
  const stamped: SessionPayload = { ...payload, iat, exp: iat + SESSION_TTL_SECONDS }
  const body = toB64(enc.encode(JSON.stringify(stamped)))
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(body))
  return `${body}.${toB64(new Uint8Array(sig))}`
}

/**
 * Verify signature, then expiry. Tokens without `exp` (the pre-expiry format)
 * are rejected: they could never be retired, so one re-login is the price.
 */
export async function verifySession(
  token: string,
  secret: string,
  nowMs: number = Date.now(),
): Promise<SessionPayload | null> {
  const dot = token.lastIndexOf('.')
  if (dot <= 0) return null
  const body = token.slice(0, dot)
  const sig = fromB64(token.slice(dot + 1))
  const raw = fromB64(body)
  if (!sig || !raw) return null
  const ok = await crypto.subtle.verify('HMAC', await hmacKey(secret), sig, enc.encode(body))
  if (!ok) return null
  try {
    const payload = JSON.parse(dec.decode(raw)) as SessionPayload
    if (typeof payload.userId !== 'string' || typeof payload.email !== 'string') return null
    if (typeof payload.exp !== 'number' || payload.exp * 1000 <= nowMs) return null
    return payload
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
    if (!key) return
    try {
      list[key] = decodeURIComponent(val)
    } catch {
      // A foreign cookie with a bad % sequence must not break every API call.
      list[key] = val
    }
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

/** Admin gate: signed-in, email verified, AND on the ADMIN_EMAILS allowlist (comma-separated). */
export function isAdmin(payload: SessionPayload | null, env: Record<string, unknown>): boolean {
  if (!payload?.email || payload.emailVerified !== true) return false
  const raw = env.ADMIN_EMAILS
  if (typeof raw !== 'string' || !raw.trim()) return false
  const allow = raw.split(',').map((e) => e.trim().toLowerCase())
  return allow.includes(payload.email.toLowerCase())
}

export function sessionCookie(token: string): string {
  return `spidex_session=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_TTL_SECONDS}`
}
