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
 * Every response from the bucket gets CSP script-src 'none': packs may
 * contain SVG, and same-origin SVG is scriptable. The header keeps a
 * published pack inert no matter what an author uploads.
 */
import { communityPackRow, contentType, isRealAsset, servingPrefix } from '../lib/submissions'
import { bundledPackIds } from '../lib/bundled-packs'

const META_FILES = /^(pack\.json|species\.ndjson)$/ // freshness > caching

const notFound = () => new Response('Not found', { status: 404 })

export const onRequestGet = async (context: any) => {
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
    return fromBucket(env.PACKS, `bundled/${packId}/${file}`, file!, miss)
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

async function fromBucket(bucket: any, key: string, file: string, miss: () => Response) {
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
