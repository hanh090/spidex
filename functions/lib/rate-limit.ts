/**
 * Fixed-window throttling backed by D1 (table `rate_limits`, migration 0003).
 *
 * One row per (key, window) holds an attempt counter; a request bumps its
 * counters and is refused once any exceeds its limit. Old windows are swept
 * opportunistically when a new window opens. If D1 is not bound or errors,
 * the limiter fails open: auth must not go down because the throttle table did.
 */
import type { D1Like } from './d1'

export interface Limit {
  /** Stable key, e.g. `password:ip:1.2.3.4`. */
  key: string
  max: number
  /**
   * Count only attempts reported through `recordFailure`. A request is refused
   * once `max` failures are on record, but a successful sign-in never adds to
   * it, so a third party cannot lock a known email out by merely sending
   * requests (they would have to guess wrong, and the IP bucket still bounds that).
   */
  failuresOnly?: boolean
}

export const WINDOW_SECONDS = 15 * 60
export const EMAIL_MAX = 10
export const IP_MAX = 30

export type RateResult = { allowed: true } | { allowed: false; retryAfter: number }

async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export async function checkRateLimit(
  db: D1Like | undefined | null,
  limits: Limit[],
  nowMs: number = Date.now(),
): Promise<RateResult> {
  if (!db) return { allowed: true }
  const windowSec = Math.floor(nowMs / 1000 / WINDOW_SECONDS) * WINDOW_SECONDS
  try {
    let denied = false
    let opened = false
    for (const { key, max, failuresOnly } of limits) {
      if (failuresOnly) {
        const seen = await db.prepare('SELECT count FROM rate_limits WHERE key = ? AND window = ?')
          .bind(key, windowSec).first<{ count: number }>()
        if ((seen?.count ?? 0) >= max) denied = true
        continue
      }
      const row = await db
        .prepare(
          'INSERT INTO rate_limits (key, window, count) VALUES (?, ?, 1) ' +
            'ON CONFLICT(key, window) DO UPDATE SET count = count + 1 RETURNING count',
        )
        .bind(key, windowSec)
        .first<{ count: number }>()
      const count = row?.count ?? 1
      if (count === 1) opened = true
      if (count > max) denied = true
    }
    if (opened) {
      await db.prepare('DELETE FROM rate_limits WHERE window < ?').bind(windowSec).run().catch(() => undefined)
    }
    if (!denied) return { allowed: true }
    return { allowed: false, retryAfter: Math.max(1, windowSec + WINDOW_SECONDS - Math.floor(nowMs / 1000)) }
  } catch (err) {
    console.error('rate limit unavailable, allowing', err)
    return { allowed: true }
  }
}

/** Records a failed attempt against the `failuresOnly` limits. Never throws: the throttle must not break auth. */
export async function recordFailure(
  db: D1Like | undefined | null,
  limits: Limit[],
  nowMs: number = Date.now(),
): Promise<void> {
  if (!db) return
  const windowSec = Math.floor(nowMs / 1000 / WINDOW_SECONDS) * WINDOW_SECONDS
  try {
    for (const { key, failuresOnly } of limits) {
      if (!failuresOnly) continue
      await db
        .prepare('INSERT INTO rate_limits (key, window, count) VALUES (?, ?, 1) ON CONFLICT(key, window) DO UPDATE SET count = count + 1')
        .bind(key, windowSec)
        .run()
    }
  } catch (err) {
    console.error('rate limit failure not recorded', err)
  }
}

/**
 * Limits for one credential endpoint: per normalised email and per client IP. */
export async function credentialLimits(action: 'password' | 'register', request: Request, email: string): Promise<Limit[]> {
  const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown'
  return [
    // Password login counts only failures against an email; the IP bucket counts every attempt.
    { key: `${action}:email:${await sha256Hex(email.trim().toLowerCase())}`, max: EMAIL_MAX, failuresOnly: action === 'password' },
    { key: `${action}:ip:${ip}`, max: IP_MAX },
  ]
}

export function tooManyRequests(retryAfter: number): Response {
  return new Response(JSON.stringify({ error: 'Too many attempts. Try again later.', retryAfter }), {
    status: 429,
    headers: { 'Content-Type': 'application/json', 'Retry-After': String(retryAfter), 'Cache-Control': 'no-store' },
  })
}
