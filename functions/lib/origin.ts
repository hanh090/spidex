/**
 * CSRF guard for cookie-authenticated, state-changing endpoints.
 *
 * SameSite=Lax already withholds the session cookie from cross-site POSTs, but
 * that is one layer. This check is the second: a state-changing request must
 * come from the page's own origin. Browsers always send `Origin` on a
 * non-GET fetch; when it is absent we fall back to `Sec-Fetch-Site`, and a
 * request with neither is refused rather than trusted.
 */

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get('Origin')
  if (origin) {
    try {
      return new URL(origin).origin === new URL(request.url).origin
    } catch {
      return false
    }
  }
  const site = request.headers.get('Sec-Fetch-Site')
  return site === 'same-origin' || site === 'none'
}

/** A 403 Response when the request is state-changing and cross-origin, else null. */
export function rejectCrossOrigin(request: Request): Response | null {
  if (SAFE_METHODS.has(request.method.toUpperCase())) return null
  if (isSameOrigin(request)) return null
  return new Response(JSON.stringify({ error: 'Cross-origin request refused' }), {
    status: 403,
    headers: { 'Content-Type': 'application/json' },
  })
}
