/**
 * /packs/<id>/<file> — serves bundled packs AND community packs.
 *
 * Static assets win first (context.next()); only on a 404 do we consult D1 —
 * the pack id must be a published community pack (kind='pack', published=1,
 * meta.community) before anything is read from the PACKS bucket. An
 * unpublished or unknown id stays a 404, so the bucket is never browsable
 * and unlisting a pack takes it off the air immediately.
 *
 * Every response from the bucket gets CSP script-src 'none': packs may
 * contain SVG, and same-origin SVG is scriptable. The header keeps a
 * published pack inert no matter what an author uploads.
 */
import { communityPackRow, contentType } from '../lib/submissions'

const META_FILES = /^(pack\.json|species\.ndjson)$/ // freshness > caching

export const onRequestGet = async (context: any) => {
  const res = await context.next()
  if (res.ok) return res

  const { env } = context
  if (!env?.PACKS || !env?.DB) return res

  const m = new URL(context.request.url).pathname.match(/^\/packs\/([^/]+)\/(.+)$/)
  if (!m) return res

  const [, packId, file] = m
  const row = await communityPackRow(env.DB, packId!)
  if (!row?.published || !row.meta.community) return res

  const obj = await env.PACKS.get(`packs/${packId}/${file}`)
  if (!obj) return res

  const headers = new Headers()
  headers.set('Content-Type', contentType(file!))
  headers.set('Content-Security-Policy', "script-src 'none'")
  headers.set('Cache-Control', META_FILES.test(file!) ? 'no-store' : 'public, max-age=86400')
  if (obj.etag) headers.set('ETag', obj.etag)
  return new Response(obj.body, { status: 200, headers })
}
