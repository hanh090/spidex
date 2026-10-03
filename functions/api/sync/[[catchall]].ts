/**
 * /api/sync/* — signed-in sync of sightings and their photos.
 *
 *   POST   /api/sync/sightings        batch upsert { records: [{id, clientVersion, payload}] }
 *   GET    /api/sync/sightings?since= pull changes after a server_seq cursor
 *   DELETE /api/sync/sightings/:id    tombstone (and its photos)
 *   GET    /api/sync/photos?since=    pull photo metadata (incl. tombstones) after a server_seq cursor
 *   POST   /api/sync/photos           upload one derived JPEG/WebP (?photoId&sightingId&width&height)
 *   GET    /api/sync/photos/:id       stream the caller's own photo
 *   DELETE /api/sync/photos/:id       tombstone + remove the object
 *
 * Every route needs a verified session; `userId` is taken from it and from
 * nowhere else. State-changing requests must also pass the Origin check.
 * Photos live in the PACKS bucket under user-photos/<userId>/<photoId>.<ext>
 * and are only ever served by the owner-checked GET above.
 *
 * Photo sync is metered at PHOTO_SYNC_COST credits (idempotent per photo id)
 * and never blocked unless CREDITS_ENFORCED is on.
 */
import { readSession } from '../../lib/session'
import { rejectCrossOrigin } from '../../lib/origin'
import { json } from '../../lib/http'
import { changes, type D1Like, type R2Like } from '../../lib/d1'
import { Q } from '../../lib/sync-sql'
import {
  MAX_BATCH, PULL_DEFAULT, PULL_MAX, pullSightings, tombstoneSighting, upsertSighting,
} from '../../lib/sync-sightings'
import { pullPhotos } from '../../lib/sync-photos'
import {
  PHOTO_SYNC_COST, creditsEnforced, ensureSignupGrant, getBalance, ledgerStatements, photoKey,
} from '../../lib/ledger'

interface Env {
  SESSION_SECRET?: string
  WORKOS_API_KEY?: string
  CREDITS_ENFORCED?: string
  DB?: D1Like
  PACKS?: R2Like
}

const MAX_PHOTO_BYTES = 8 * 1024 * 1024
const MAX_JSON_BYTES = 1024 * 1024
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** Becomes part of an R2 key, so it must not be able to introduce path structure. */
const SAFE_USER_ID = /^[A-Za-z0-9_-]{1,128}$/
const IMAGE_TYPES: Record<string, string> = { 'image/jpeg': 'jpg', 'image/webp': 'webp' }
const EXT_TYPES: Record<string, string> = { jpg: 'image/jpeg', webp: 'image/webp' }

function looksLikeImage(type: string, b: Uint8Array): boolean {
  if (type === 'image/jpeg') return b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff
  // RIFF....WEBP
  return b.length > 12 && String.fromCharCode(...b.slice(0, 4)) === 'RIFF' && String.fromCharCode(...b.slice(8, 12)) === 'WEBP'
}

/** `decodeURIComponent` throws URIError on a malformed escape; that is a bad request, not a server fault. */
const safeDecode = (raw: string): string | null => {
  try { return decodeURIComponent(raw) } catch { return null }
}

const dimension = (v: string | null): number => {
  const n = Number(v)
  return Number.isInteger(n) && n >= 0 && n <= 30_000 ? n : 0
}

interface PhotoRow { id: string; user_id: string; sighting_id: string; r2_key: string; bytes: number; deleted_at: number | null }
interface SightingOwner { user_id: string; deleted_at: number | null }

export const onRequest = async (context: { request: Request; env: Env }) => {
  const { request, env } = context
  const url = new URL(request.url)
  const method = request.method
  const path = url.pathname

  const crossOrigin = rejectCrossOrigin(request)
  if (crossOrigin) return crossOrigin

  const session = await readSession(request, env as unknown as Record<string, unknown>)
  if (!session) return json({ error: 'Sign in required' }, 401)
  const userId = session.userId
  if (!SAFE_USER_ID.test(userId)) return json({ error: 'Unsupported account id' }, 400)
  const db = env.DB
  if (!db) return json({ error: 'Sync is not configured on this deployment' }, 503)

  try {
    if (path === '/api/sync/sightings' && method === 'GET') {
      const since = Number(url.searchParams.get('since') ?? 0)
      const limit = Math.min(Number(url.searchParams.get('limit') ?? PULL_DEFAULT) || PULL_DEFAULT, PULL_MAX)
      if (!Number.isInteger(since) || since < 0) return json({ error: 'since must be a non-negative integer' }, 400)
      return json(await pullSightings(db, userId, since, Math.max(1, limit)))
    }

    if (path === '/api/sync/photos' && method === 'GET') {
      const since = Number(url.searchParams.get('since') ?? 0)
      const limit = Math.min(Number(url.searchParams.get('limit') ?? PULL_DEFAULT) || PULL_DEFAULT, PULL_MAX)
      if (!Number.isInteger(since) || since < 0) return json({ error: 'since must be a non-negative integer' }, 400)
      return json(await pullPhotos(db, userId, since, Math.max(1, limit)))
    }

    if (path === '/api/sync/sightings' && method === 'POST') {
      const len = Number(request.headers.get('Content-Length') ?? 0)
      if (len > MAX_JSON_BYTES) return json({ error: 'Batch too large' }, 413)
      const body = await request.json().catch(() => null) as { records?: unknown } | null
      if (!body || !Array.isArray(body.records)) return json({ error: 'records array required' }, 400)
      if (body.records.length > MAX_BATCH) return json({ error: `At most ${MAX_BATCH} records per batch` }, 413)
      await ensureSignupGrant(db, userId)
      const now = Date.now()
      const results = []
      for (const rec of body.records) results.push(await upsertSighting(db, userId, rec, now))
      return json({ results })
    }

    const sightingDel = path.match(/^\/api\/sync\/sightings\/([^/]+)$/)
    if (sightingDel && method === 'DELETE') {
      const id = safeDecode(sightingDel[1]!)
      if (id === null) return json({ error: 'Malformed id' }, 400)
      if (!UUID.test(id)) return json({ error: 'Not found' }, 404)
      const ok = await tombstoneSighting(db, env.PACKS, userId, id, Date.now())
      return ok ? json({ result: 'applied' }) : json({ error: 'Not found' }, 404)
    }

    if (path === '/api/sync/photos' && method === 'POST') {
      if (!env.PACKS) return json({ error: 'Photo storage is not configured' }, 503)
      const photoId = url.searchParams.get('photoId') ?? ''
      const sightingId = url.searchParams.get('sightingId') ?? ''
      if (!UUID.test(photoId) || !UUID.test(sightingId)) return json({ error: 'photoId and sightingId must be UUIDs' }, 400)

      const type = (request.headers.get('Content-Type') ?? '').split(';')[0]!.trim().toLowerCase()
      const ext = IMAGE_TYPES[type]
      if (!ext) return json({ error: 'Only image/jpeg and image/webp are accepted' }, 415)
      if (Number(request.headers.get('Content-Length') ?? 0) > MAX_PHOTO_BYTES) return json({ error: 'Photo too large' }, 413)
      const buffer = await request.arrayBuffer().catch(() => null)
      if (!buffer) return json({ error: 'Could not read the request body' }, 400)
      const bytes = new Uint8Array(buffer)
      if (!bytes.length) return json({ error: 'Empty body' }, 400)
      if (bytes.length > MAX_PHOTO_BYTES) return json({ error: 'Photo too large' }, 413)
      if (!looksLikeImage(type, bytes)) return json({ error: 'Body is not a valid image' }, 415)

      await ensureSignupGrant(db, userId)

      const owner = await db.prepare(Q.getSighting).bind(sightingId).first<SightingOwner>()
      if (!owner || owner.user_id !== userId || owner.deleted_at !== null) {
        return json({ error: 'Sighting not found — sync the sighting first' }, 404)
      }

      const existing = await db.prepare(Q.getPhoto).bind(photoId).first<PhotoRow>()
      if (existing) {
        if (existing.user_id !== userId) return json({ error: 'Photo id is already in use' }, 403)
        if (existing.deleted_at !== null) return json({ error: 'Photo was deleted' }, 410)
        // Already stored: no second R2 write, no second charge.
        return json({ result: 'applied', alreadyStored: true })
      }

      const enforced = creditsEnforced(env)
      if (enforced && (await getBalance(db, userId)) < PHOTO_SYNC_COST) {
        return json({ error: 'needs_credits' }, 402)
      }

      const key = `user-photos/${userId}/${photoId}.${ext}`
      await env.PACKS.put(key, bytes.buffer as ArrayBuffer, { httpMetadata: { contentType: type } })
      const now = Date.now()
      // The insert re-checks, inside the batch, that the sighting is still live
      // and (when enforced) that the balance covers the cost, so a concurrent
      // delete or a concurrent upload cannot slip past the checks above. The
      // charge only lands if the photo row exists.
      const results = await db.batch([
        db.prepare(Q.bumpSeq).bind(userId),
        db.prepare(Q.insertPhoto).bind(
          photoId, userId, sightingId, key, dimension(url.searchParams.get('width')),
          dimension(url.searchParams.get('height')), bytes.length, userId, now,
          sightingId, userId, enforced ? 1 : 0, userId, PHOTO_SYNC_COST,
        ),
        ...ledgerStatements(db, {
          userId, delta: -PHOTO_SYNC_COST, reason: 'photo_sync', refType: 'photo', refId: photoId,
          idempotencyKey: photoKey(photoId), now, requirePhotoId: photoId,
        }),
      ])
      if (changes(results[1]) === 0) {
        const row = await db.prepare(Q.getPhoto).bind(photoId).first<PhotoRow>()
        // Never delete the object a winning writer of the same key relies on.
        if (!row || row.r2_key !== key) await env.PACKS.delete(key).catch(() => undefined)
        if (row) {
          // Lost a race to another writer of the same id; only the owner may proceed.
          if (row.user_id !== userId) return json({ error: 'Photo id is already in use' }, 403)
          return json({ result: 'applied', alreadyStored: true })
        }
        const parent = await db.prepare(Q.getSighting).bind(sightingId).first<SightingOwner>()
        if (!parent || parent.user_id !== userId || parent.deleted_at !== null) {
          return json({ error: 'Sighting not found — sync the sighting first' }, 404)
        }
        return json({ error: 'needs_credits' }, 402)
      }
      return json({ result: 'applied' }, 201)
    }

    const photoRoute = path.match(/^\/api\/sync\/photos\/([^/]+)$/)
    if (photoRoute) {
      const id = safeDecode(photoRoute[1]!)
      if (id === null) return json({ error: 'Malformed id' }, 400)
      if (!UUID.test(id)) return json({ error: 'Not found' }, 404)
      const row = await db.prepare(Q.getPhoto).bind(id).first<PhotoRow>()
      // Not-yours and does-not-exist are indistinguishable on purpose.
      const mine = row && row.user_id === userId ? row : null

      if (method === 'GET') {
        if (!mine || mine.deleted_at !== null || !env.PACKS) return json({ error: 'Not found' }, 404)
        const obj = await env.PACKS.get(mine.r2_key)
        if (!obj) return json({ error: 'Not found' }, 404)
        const ext = mine.r2_key.split('.').pop() ?? ''
        return new Response(obj.body as BodyInit, {
          headers: {
            'Content-Type': EXT_TYPES[ext] ?? 'application/octet-stream',
            'Cache-Control': 'private, no-store',
            'X-Content-Type-Options': 'nosniff',
          },
        })
      }

      if (method === 'DELETE') {
        if (!mine) return json({ error: 'Not found' }, 404)
        if (mine.deleted_at === null) {
          const now = Date.now()
          await db.batch([
            db.prepare(Q.bumpSeq).bind(userId),
            db.prepare(Q.tombstonePhoto).bind(now, userId, id, userId),
          ])
          if (env.PACKS) await env.PACKS.delete(mine.r2_key).catch(() => undefined)
        }
        return json({ result: 'applied' })
      }
    }

    return json({ error: 'Not found' }, 404)
  } catch (err) {
    console.error('sync error', err)
    return json({ error: 'Sync error' }, 500)
  }
}
