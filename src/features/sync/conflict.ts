/**
 * Conflict storage and resolution.
 *
 * A conflict is a sighting whose local edit and server copy diverged. The
 * server copy is parked in `meta` (it is the user's own data, handed back in
 * the stale push result or the pull) so the user can see both sides and pick.
 * Nothing is ever resolved automatically.
 */
import { db, getMeta, setMeta, type Sighting } from '../../data/db'
import { lowerUserDataCounts } from '../../data/integrity'

export interface ServerCopy {
  clientVersion: number
  payload: Record<string, unknown> | null
  deletedAt: number | null
}

const key = (id: string) => `sync.conflict.${id}`

export const getConflict = (id: string) => getMeta<ServerCopy | null>(key(id), null)
export const saveConflict = (id: string, copy: ServerCopy) => setMeta(key(id), copy)
export const clearConflict = (id: string) => db.meta.delete(key(id))

/**
 * Set by "keep mine" on a server-side delete: the next push of this record
 * carries `restore`, which is the only way a tombstoned sighting comes back.
 */
const restoreKey = (id: string) => `sync.restore.${id}`
export const needsRestore = async (id: string): Promise<boolean> => (await getMeta<boolean>(restoreKey(id), false)) === true
export const clearRestore = (id: string) => db.meta.delete(restoreKey(id))

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
  const removesSighting = server.deletedAt !== null
  await db.transaction('rw', db.sightings, db.photos, db.meta, async () => {
    if (removesSighting) {
      await db.photos.where('sightingId').equals(id).modify({ deletedAt: server.deletedAt ?? Date.now(), syncState: 'synced' })
      await db.sightings.delete(id)
    } else {
      await db.sightings.put(sightingFromServer(id, userId, server, local))
    }
    await clearConflict(id)
    await clearRestore(id)
  })
  if (removesSighting) await lowerUserDataCounts({ sightings: 1 })
  return true
}

/**
 * Keep the local edit: re-stamp it above the server version so the next push
 * wins the version guard, and queue it. The caller triggers the sync.
 *
 * When the server copy is a delete, the record is sent with `restore` and the
 * photos still on this device are re-uploaded under fresh ids: the server
 * tombstoned the originals and removed their objects when it deleted the
 * sighting, and a deleted photo id can never be uploaded again.
 */
export async function keepMine(id: string): Promise<boolean> {
  const server = await getConflict(id)
  const local = await db.sightings.get(id)
  if (!local) return false
  const restoring = server?.deletedAt != null
  await db.transaction('rw', db.sightings, db.photos, db.meta, async () => {
    await db.sightings.update(id, {
      clientVersion: Math.max(local.clientVersion, server?.clientVersion ?? 0) + 1,
      syncState: 'local',
      updatedAt: Date.now(),
    })
    await clearConflict(id)
    if (restoring) {
      await setMeta(restoreKey(id), true)
      const photos = await db.photos.where('sightingId').equals(id).filter((p) => !p.deletedAt).toArray()
      for (const p of photos) {
        await db.photos.delete(p.id)
        const { pulled: _pulled, ...rest } = p
        await db.photos.add({ ...rest, id: crypto.randomUUID(), syncState: 'local' })
      }
    }
  })
  return true
}
