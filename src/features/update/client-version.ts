/**
 * Client version negotiation. The build's own version (package.json, injected
 * at build time) is compared with the server's minClientVersion. Falling below
 * it never blocks anything — the app is offline-first — it only surfaces an
 * update prompt. No server route checks the client version, so the banner is
 * advisory; it is shown only once a newer service worker is actually waiting,
 * so raising MIN_CLIENT_VERSION above the deployed version cannot leave a
 * banner that nothing can clear (see update-store.ts).
 */

export const CLIENT_VERSION: string = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0'

const parse = (v: string): number[] | null =>
  /^\d+(\.\d+)*$/.test(v.trim()) ? v.trim().split('.').map(Number) : null

/** Numeric dotted compare: negative if a < b, 0 if equal, positive if a > b. NaN if either is malformed. */
export function compareVersions(a: string, b: string): number {
  const pa = parse(a)
  const pb = parse(b)
  if (!pa || !pb) return NaN
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return d
  }
  return 0
}

/** True only when both versions are well-formed and `client` is strictly older. */
export function isBelowMinimum(client: string, minimum: string): boolean {
  return compareVersions(client, minimum) < 0
}

/**
 * Ask the server for the minimum supported version. Any failure (offline,
 * non-200, malformed body) yields null: unknown is never treated as "outdated".
 */
export async function fetchMinClientVersion(
  fetchFn: typeof fetch = (input, init) => fetch(input, init),
): Promise<string | null> {
  try {
    const res = await fetchFn('/api/meta', { headers: { Accept: 'application/json' }, cache: 'no-store' })
    if (!res.ok) return null
    const body = (await res.json()) as { minClientVersion?: unknown }
    return typeof body.minClientVersion === 'string' && parse(body.minClientVersion) ? body.minClientVersion : null
  } catch {
    return null
  }
}

/** True when the server says this build is too old. */
export async function isUpdateRequired(
  fetchFn?: typeof fetch,
  client: string = CLIENT_VERSION,
): Promise<boolean> {
  const min = await fetchMinClientVersion(fetchFn)
  return min !== null && isBelowMinimum(client, min)
}
