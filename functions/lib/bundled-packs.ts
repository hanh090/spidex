/**
 * Ids of the packs shipped with the app, read from the static
 * /packs/index.json through the asset binding (which bypasses the
 * index.json function that merges community packs in). Cached per isolate:
 * the file only changes with a deploy, and a deploy starts new isolates.
 */
let cached: Promise<Set<string>> | null = null

export function bundledPackIds(env: any, requestUrl: string): Promise<Set<string>> {
  if (!env?.ASSETS) return Promise.resolve(new Set())
  cached ??= (async () => {
    const res: Response = await env.ASSETS.fetch(new URL('/packs/index.json', requestUrl))
    const index = (await res.json()) as { packs?: unknown }
    return new Set(Array.isArray(index.packs) ? index.packs.filter((p): p is string => typeof p === 'string') : [])
  })().catch((err) => {
    console.error('bundled pack index unreadable', err)
    cached = null
    return new Set<string>()
  })
  return cached
}

/** Per-isolate copy of each shipped pack.json, same lifetime reasoning as the index. */
export const shippedManifests = new Map<string, string>()

/** Test hook: forget the cached index and manifests. */
export function resetBundledPackIds() {
  cached = null
  shippedManifests.clear()
}
