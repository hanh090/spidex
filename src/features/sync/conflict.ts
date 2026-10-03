/**
 * Conflict storage and resolution.
 *
 * A conflict is a sighting whose local edit and server copy diverged. The
 * server copy is parked in `meta` (it is the user's own data, handed back in
 * the stale push result or the pull) so the user can see both sides and pick.
 * Nothing is ever resolved automatically.
 */
import { db, getMeta, setMeta, type Sighting } from '../../data/db'

export interface ServerCopy {
  clientVersion: number
  payload: Record<string, unknown> | null
  deletedAt: number | null
}

const key = (id: string) => `sync.conflict.${id}`

export const getConflict = (id: string) => getMeta<ServerCopy | null>(key(id), null)
export const saveConflict = (id: string, copy: ServerCopy) => setMeta(key(id), copy)
export const clearConflict = (id: string) => db.meta.delete(key(id))

/** Build a local row from a server payload. */
export function sightingFromServer(
  id: string, userId: string, copy: Pick<ServerCopy, 'clientVersion' | 'payload'>, base?: Sighting,
): Sighting {
  const p = (copy.payload ?? {}) as Partial<Sighting>
  return {
    ...(p as Sighting),
    id,
    userId,
    installId: p.installId ?? base?.installId ?? '',
    notes: p.notes ?? '',
    count: p.count ?? 1,
    clientVersion: copy.clientVersion,
    syncState: 'synced',
  }
}

export interface ConflictView {
  local: Sighting
  server: ServerCopy
}

export async function listConflicts(userId: string): Promise<ConflictView[]> {
  const rows = await db.sightings.where('syncState').equals('conflict').filter((s) => s.userId === userId).toArray()
  const out: ConflictView[] = []
  for (const local of rows) {
    const server = await getConflict(local.id)
    if (server) out.push({ local, server })
  }
  return out
}

/** Discard the local edit and adopt the server copy (including a server-side delete). */
export async function keepServer(userId: string, id: string): Promise<boolean> {
  const server = await getConflict(id)
  const local = await db.sightings.get(id)
  if (!server || !local) return false
  await db.transaction('rw', db.sightings, db.photos, db.meta, async () => {
    if (server.deletedAt !== null) {
      await db.photos.where('sightingId').equals(id).modify({ deletedAt: server.deletedAt ?? Date.now(), syncState: 'synced' })
      await db.sightings.delete(id)
    } else {
      await db.sightings.put(sightingFromServer(id, userId, server, local))
    }
    await clearConflict(id)
  })
  return true
}

/**
 * Keep the local edit: re-stamp it above the server version so the next push
 * wins the version guard, and queue it. The caller triggers the sync.
 */
export async function keepMine(id: string): Promise<boolean> {
  const server = await getConflict(id)
  const local = await db.sightings.get(id)
  if (!local) return false
  await db.transaction('rw', db.sightings, db.meta, async () => {
    await db.sightings.update(id, {
      clientVersion: Math.max(local.clientVersion, server?.clientVersion ?? 0) + 1,
      syncState: 'local',
      updatedAt: Date.now(),
    })
    await clearConflict(id)
  })
  return true
}
