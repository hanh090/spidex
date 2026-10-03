/**
 * Photo metadata pull. Uses the same per-user server_seq counter as sightings
 * but its own cursor, so a client pages photos independently of sightings.
 * Tombstones are rows with `deletedAt` set. Object bytes are never returned
 * here; the client fetches each one from the owner-checked GET /photos/:id.
 */
import type { D1Like } from './d1'
import { Q } from './sync-sql'

/** Upper bound on photos sharing one seq (all photos of one deleted sighting). */
const GROUP_MAX = 1000

export interface PulledPhoto {
  id: string
  sightingId: string
  width: number
  height: number
  bytes: number
  createdAt: number
  serverSeq: number
  deletedAt: number | null
}

interface PullRow {
  id: string; sighting_id: string; width: number; height: number; bytes: number
  created_at: number; server_seq: number; deleted_at: number | null
}

export async function pullPhotos(
  db: D1Like, userId: string, since: number, limit: number,
): Promise<{ photos: PulledPhoto[]; cursor: number; hasMore: boolean }> {
  const { results } = await db.prepare(Q.pullPhotos).bind(userId, since, limit + 1).all<PullRow>()
  let hasMore = results.length > limit
  let page = results.slice(0, limit)
  if (hasMore) {
    // Deleting a sighting tombstones all its photos under one server_seq. The
    // cursor is a bare seq, so a page must not end inside such a group or the
    // rest would be skipped: drop the trailing partial group (it leads the next
    // page). If the page is one single group, return the whole group instead.
    const boundary = results[limit]!.server_seq
    const trimmed = page.filter((r) => r.server_seq !== boundary)
    if (trimmed.length) {
      page = trimmed
    } else {
      const all = await db.prepare(Q.pullPhotos).bind(userId, since, GROUP_MAX + 1).all<PullRow>()
      page = all.results.filter((r) => r.server_seq === boundary).slice(0, GROUP_MAX)
      hasMore = all.results.length > page.length
    }
  }
  const photos = page.map((r) => ({
    id: r.id, sightingId: r.sighting_id, width: r.width, height: r.height, bytes: r.bytes,
    createdAt: r.created_at, serverSeq: r.server_seq, deletedAt: r.deleted_at,
  }))
  return { photos, cursor: page.length ? page[page.length - 1]!.server_seq : since, hasMore }
}
