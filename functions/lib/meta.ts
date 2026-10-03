/**
 * GET /api/meta payload. `minClientVersion` is the oldest client build the
 * server will still sync with; clients below it show an update banner (they
 * keep working offline). Set MIN_CLIENT_VERSION to raise it; anything that is
 * not a dotted number falls back to "0" (no minimum) rather than locking
 * everyone out on a typo.
 */
export const API_VERSION = 1

const VERSION_RE = /^\d+(\.\d+){0,2}$/

export function metaBody(env: { MIN_CLIENT_VERSION?: unknown }): { minClientVersion: string; apiVersion: number } {
  const raw = typeof env.MIN_CLIENT_VERSION === 'string' ? env.MIN_CLIENT_VERSION.trim() : ''
  return { minClientVersion: VERSION_RE.test(raw) ? raw : '0', apiVersion: API_VERSION }
}

export function metaResponse(env: { MIN_CLIENT_VERSION?: unknown }): Response {
  return new Response(JSON.stringify(metaBody(env)), {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })
}
