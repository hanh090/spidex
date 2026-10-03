/**
 * Sighting sync: validation, tenant-scoped upsert, pull and tombstone.
 *
 * Authorization model: `userId` is always the verified session user and is the
 * only owner value ever written. The payload is validated and stripped of
 * unknown keys, so a client-supplied `userId` field cannot reach the row.
 *
 * Ordering model: the client owns `client_version`, a per-record counter
 * bumped on every edit. An incoming record wins only with a strictly greater
 * version; an older (or concurrent, same-version-different-content) edit is
 * reported as `stale` and never overwrites. `server_seq` is the pull cursor.
 */
import { z } from 'zod'
import { changes, type D1Like, type R2Like } from './d1'
import { Q } from './sync-sql'

/**
 * Records per push request. Each record costs up to 3 D1 queries (a 2-statement
 * batch plus one read-back) and the signup-grant check up to 3 more; Cloudflare
 * Free allows 50 per invocation, counting every batched statement.
 * 3 * 12 + 3 = 39 leaves headroom. The client chunks pushes to the same size.
 */
export const MAX_BATCH = 12
export const MAX_PAYLOAD_BYTES = 16 * 1024
export const PULL_DEFAULT = 100
export const PULL_MAX = 200

/** Client timestamps outside this window are rejected rather than stored. */
const MIN_PLAUSIBLE_MS = Date.UTC(2000, 0, 1)
const MAX_FUTURE_SKEW_MS = 24 * 3600 * 1000

const payloadSchema = z.object({
  installId: z.string().max(64).optional(),
  speciesId: z.string().max(200).optional(),
  packId: z.string().max(100).optional(),
  packVersion: z.number().int().optional(),
  speciesSnapshot: z.object({
    sciName: z.string().max(200),
    commonName: z.string().max(200),
    sensitivity: z.number().int().min(0).max(3),
  }).optional(),
  count: z.number().int().min(0).max(1_000_000),
  at: z.number().int(),
  tzOffsetMinutes: z.number().int().min(-1440).max(1440),
  clockConfidence: z.enum(['trusted', 'suspect']),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  accuracy: z.number().min(0).max(1e7).optional(),
  notes: z.string().max(5000),
  tripId: z.string().max(100).optional(),
  updatedAt: z.number().int(),
})

const recordSchema = z.object({
  id: z.string().uuid(),
  clientVersion: z.number().int().min(1).max(2_147_483_647),
  payload: payloadSchema,
  /** Set only by an explicit "keep mine" on a server-side delete: bring the tombstoned record back. */
  restore: z.boolean().optional(),
})

export type SightingPayload = z.infer<typeof payloadSchema>

export interface SightingResult {
  id: string
  result: 'applied' | 'stale' | 'rejected'
  serverSeq?: number
  clientVersion?: number
  reason?: string
  /** On `stale`: the caller's own current server copy, so the conflict UI can show it. */
  server?: { payload: unknown; deletedAt: number | null }
}

interface SightingRow {
  id: string; user_id: string; payload: string; client_version: number; server_seq: number; deleted_at: number | null
}

const parsePayload = (raw: string): unknown => {
  try { return JSON.parse(raw) } catch { return null }
}

export async function upsertSighting(db: D1Like, userId: string, raw: unknown, now: number): Promise<SightingResult> {
  const idGuess = typeof (raw as { id?: unknown } | null)?.id === 'string' ? (raw as { id: string }).id : ''
  const parsed = recordSchema.safeParse(raw)
  if (!parsed.success) return { id: idGuess, result: 'rejected', reason: 'invalid_record' }
  const { id, clientVersion, payload, restore } = parsed.data

  if (payload.at < MIN_PLAUSIBLE_MS || payload.at > now + MAX_FUTURE_SKEW_MS ||
      payload.updatedAt < MIN_PLAUSIBLE_MS || payload.updatedAt > now + MAX_FUTURE_SKEW_MS) {
    return { id, result: 'rejected', reason: 'timestamp_out_of_range' }
  }
  const body = JSON.stringify(payload)
  if (new TextEncoder().encode(body).length > MAX_PAYLOAD_BYTES) return { id, result: 'rejected', reason: 'payload_too_large' }

  const results = await db.batch([
    db.prepare(Q.bumpSeq).bind(userId),
    db.prepare(Q.upsertSighting).bind(id, userId, body, clientVersion, userId, now, restore ? 1 : 0),
  ])
  const row = await db.prepare(Q.getSighting).bind(id).first<SightingRow>()
  if (!row || row.user_id !== userId) return { id, result: 'rejected', reason: 'not_owner' }

  if (changes(results[1]) > 0) {
    return { id, result: 'applied', serverSeq: row.server_seq, clientVersion: row.client_version }
  }
  // Nothing changed: either an exact replay (idempotent success) or a stale edit.
  if (row.client_version === clientVersion && row.payload === body && row.deleted_at === null) {
    return { id, result: 'applied', serverSeq: row.server_seq, clientVersion: row.client_version }
  }
  return {
    id, result: 'stale', serverSeq: row.server_seq, clientVersion: row.client_version,
    server: { payload: parsePayload(row.payload), deletedAt: row.deleted_at },
  }
}

export interface PulledSighting {
  id: string
  clientVersion: number
  serverSeq: number
  deletedAt: number | null
  payload: unknown
}

export async function pullSightings(
  db: D1Like, userId: string, since: number, limit: number,
): Promise<{ sightings: PulledSighting[]; cursor: number; hasMore: boolean }> {
  const { results } = await db.prepare(Q.pullSightings).bind(userId, since, limit + 1)
    .all<Omit<SightingRow, 'user_id'>>()
  const page = results.slice(0, limit)
  const sightings = page.map((r) => ({
    id: r.id, clientVersion: r.client_version, serverSeq: r.server_seq,
    deletedAt: r.deleted_at, payload: parsePayload(r.payload),
  }))
  return { sightings, cursor: page.length ? page[page.length - 1]!.server_seq : since, hasMore: results.length > limit }
}

/**
 * Tombstones a sighting and its photos (objects removed from R2, best effort).
 * `false` means it does not exist for this user.
 */
export async function tombstoneSighting(db: D1Like, r2: R2Like | undefined, userId: string, id: string, now: number): Promise<boolean> {
  const out = await db.batch([
    db.prepare(Q.bumpSeq).bind(userId),
    db.prepare(Q.tombstoneSighting).bind(now, now, userId, id, userId),
    db.prepare(Q.tombstonePhotosOfSighting).bind(now, userId, id, userId),
  ])
  if (changes(out[1]) > 0) {
    // Keys are read after the batch: the sighting is already tombstoned, so no
    // photo can be inserted for it any more and none is missed (no orphan objects).
    if (r2) {
      const { results: keys } = await db.prepare(Q.keysTombstonedAt).bind(id, userId, now).all<{ r2_key: string }>()
      if (keys.length) await r2.delete(keys.map((k) => k.r2_key)).catch(() => undefined)
    }
    return true
  }
  const row = await db.prepare(Q.getSighting).bind(id).first<SightingRow>()
  return !!row && row.user_id === userId && row.deleted_at !== null
}
