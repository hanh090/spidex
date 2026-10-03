/**
 * /packs/<id>/<file> — serves bundled packs AND community packs.
 *
 * Static assets win first (context.next()), but only a real file counts: Pages
 * answers a missing path with the SPA fallback (200 text/html), which is a
 * miss. On a miss we consult D1 — the pack id must be a published community
 * pack (kind='pack', published=1, meta.community) before anything is read
 * from the PACKS bucket, and the row's meta.prefix says where its files live.
 * An unpublished or unknown id stays a 404, so the bucket is never browsable
 * and unlisting a pack takes it off the air immediately.
 *
 * Bundled packs (the ones listed in the static packs/index.json) keep their
 * manifests in git but their media in the bucket under bundled/<id>/<path>,
 * uploaded by scripts/upload-pack-media.mjs. A bundled file missing from the
 * deploy is read from there, with no D1 lookup: being in the shipped index is
 * what makes it public.
 *
 * pack.json and species.ndjson of a bundled pack may be overridden by an admin
 * edit stored at overrides/<id>/<file>; that object is served in preference to
 * the static file, until a deploy ships a pack.json version at or above the
 * override's.
 *
 * Every response from the bucket gets CSP script-src 'none': packs may
 * contain SVG, and same-origin SVG is scriptable. The header keeps a
 * published pack inert no matter what an author uploads.
 */
import { communityPackRow, contentType, isRealAsset, servingPrefix } from '../lib/submissions'
import { bundledPackIds } from '../lib/bundled-packs'

const META_FILES = /^(pack\.json|species\.ndjson)$/ // freshness > caching

const notFound = () => new Response('Not found', { status: 404 })

export const onRequestGet = async (context: any) => {
  // An admin edit of a bundled pack's manifest or species data lives in the
  // bucket and wins over the file in the deploy.
  const override = await bundledOverride(context)
  if (override) return override

  const res: Response = await context.next()
  if (isRealAsset(res)) return res

  const m = new URL(context.request.url).pathname.match(/^\/packs\/([^/]+)\/(.+)$/)
  if (!m) return res
  // A pack file that is not on disk must not come back as index.html.
  const miss = () => (res.ok ? notFound() : res)

  const { env } = context
  if (!env?.PACKS) return miss()

  const [, packId, file] = m
  if ((await bundledPackIds(env, context.request.url)).has(packId!)) {
    // Bundled media is public and only changes with an upload, so the edge
    // cache absorbs repeat requests before they reach the bucket. Where the
    // Cache API is unavailable this degrades to a straight bucket read.
    const cache = META_FILES.test(file!) ? undefined : (globalThis as any).caches?.default
    const key = new Request(context.request.url)
    const hit = await cache?.match(key).catch(() => undefined)
    if (hit) return hit
    const served = await fromBucket(env.PACKS, `bundled/${packId}/${file}`, file!, miss)
    if (cache && served.status === 200) context.waitUntil?.(cache.put(key, served.clone()).catch(() => {}))
    return served
  }

  if (!env.DB) return miss()
  let row
  try {
    row = await communityPackRow(env.DB, packId!)
  } catch (err) {
    console.error('community pack lookup failed', err)
    return miss()
  }
  if (!row?.published || !row.meta.community) return miss()

  return fromBucket(env.PACKS, `${servingPrefix(packId!, row.meta)}/${file}`, file!, miss)
}

async function bundledOverride(context: any): Promise<Response | null> {
  const { env } = context
  if (!env?.PACKS || !env?.ASSETS) return null
  const m = new URL(context.request.url).pathname.match(/^\/packs\/([^/]+)\/(pack\.json|species\.ndjson)$/)
  if (!m) return null
  try {
    if (!(await bundledPackIds(env, context.request.url)).has(m[1]!)) return null
    // A deploy that ships a pack version at or above the override's supersedes
    // the admin edit: the edit was made against an older pack.
    const overrideVersion = await jsonVersion(await env.PACKS.get(`overrides/${m[1]}/pack.json`))
    if (overrideVersion == null) return null
    const staticVersion = await jsonVersion(await env.ASSETS.fetch(new URL(`/packs/${m[1]}/pack.json`, context.request.url)))
    if (staticVersion != null && staticVersion >= overrideVersion) return null
    return await fromBucket(env.PACKS, `overrides/${m[1]}/${m[2]}`, m[2]!, () => null)
  } catch (err) {
    console.error('pack override lookup failed', err)
    return null
  }
}

/** `version` of a pack.json body (R2 object or Response), or null if absent/unreadable. */
async function jsonVersion(body: { json?: () => Promise<unknown>; ok?: boolean } | null): Promise<number | null> {
  if (!body || body.ok === false || !body.json) return null
  try {
    const v = ((await body.json()) as { version?: unknown }).version
    return typeof v === 'number' ? v : null
  } catch {
    return null
  }
}

async function fromBucket<M extends Response | null>(bucket: any, key: string, file: string, miss: () => M): Promise<Response | M> {
  let obj
  try {
    obj = await bucket.get(key)
  } catch (err) {
    console.error('pack bucket read failed', key, err)
    return miss()
  }
  if (!obj) return miss()

  const headers = new Headers()
  headers.set('Content-Type', contentType(file))
  headers.set('Content-Security-Policy', "script-src 'none'")
  headers.set('Cache-Control', META_FILES.test(file) ? 'no-store' : 'public, max-age=86400')
  if (obj.etag) headers.set('ETag', obj.etag)
  return new Response(obj.body, { status: 200, headers })
}

/** HEAD gets the GET answer without a body (the SPA fallback otherwise answers 200 html). */
export const onRequestHead = async (context: any) => {
  const res = await onRequestGet(context)
  return new Response(null, { status: res.status, headers: res.headers })
}
