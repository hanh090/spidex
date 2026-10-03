/**
 * Pack version updates.
 *
 * Taxonomic splits are routine in this domain: a species id in v3 can become
 * two ids in v4. Without an explicit remap, every sighting referencing the old
 * id is orphaned — and because the life list is a derived query, those entries
 * would vanish rather than degrade.
 *
 * So the remap is applied to existing sightings inside the same transaction as
 * the new pack, and unmappable references are reported to the user BEFORE the
 * update commits.
 */
import { db, speciesUid } from './db'
import { fetchManifest } from './pack-download'
import { resolve } from './localized'
import type { PackManifest } from './pack-manifest'

export interface UpdatePreview {
  packId: string
  fromVersion: number
  toVersion: number
  affectedSightings: number
  /** Sightings whose species has no mapping in the new version. */
  unmappable: { sightingId: string; speciesId: string; snapshot?: string }[]
  manifest: PackManifest
}

export async function previewUpdate(packId: string, baseUrl: string): Promise<UpdatePreview | { error: string }> {
  const stored = await db.packs.get(packId)
  if (!stored) return { error: 'not-installed' }
  const m = await fetchManifest(baseUrl)
  if (!m.ok) return { error: m.error ?? 'invalid-manifest' }

  const next = m.manifest
  const remap = new Map(next.idRemap.map((r) => [r.from, r.to]))

  const sightings = await db.sightings.where('packId').equals(packId).toArray()
  const unmappable: UpdatePreview['unmappable'] = []
  for (const s of sightings) {
    if (!s.speciesId) continue
    if (remap.has(s.speciesId)) continue
    // Still fine if the id survives the bump unchanged. Report only ids the
    // remap does not cover AND which are absent from the stored set.
    const still = await db.species.get(speciesUid(packId, s.speciesId))
    if (!still) unmappable.push({ sightingId: s.id, speciesId: s.speciesId, snapshot: s.speciesSnapshot?.sciName })
  }

  return {
    packId,
    fromVersion: stored.version,
    toVersion: next.version,
    affectedSightings: sightings.length,
    unmappable,
    manifest: next,
  }
}

/**
 * Apply the id remap to existing sightings.
 *
 * Must be called from INSIDE the caller's transaction — `downloadPack` commits
 * species, pack and this remap together so a crash cannot separate them. It
 * deliberately opens no transaction of its own.
 *
 * The species snapshot is refreshed alongside the id: leaving the old name
 * against a new id would show the pre-split name in the life list forever.
 */
export async function applyIdRemap(packId: string, manifest: PackManifest): Promise<number> {
  if (!manifest.idRemap.length) return 0
  const remap = new Map(manifest.idRemap.map((r) => [r.from, r.to]))
  const rows = await db.sightings.where('packId').equals(packId).toArray()
  let changed = 0
  for (const s of rows) {
    if (!s.speciesId) continue
    const to = remap.get(s.speciesId)
    if (!to) continue
    const next = await db.species.get(speciesUid(packId, to))
    await db.sightings.update(s.id, {
      speciesId: to,
      packVersion: manifest.version,
      speciesSnapshot: next
        ? { sciName: next.sciName, commonName: resolve(next.commonNames), sensitivity: next.sensitivity }
        : s.speciesSnapshot,
      clientVersion: s.clientVersion + 1,
      // A remapped record that was already synced is a local edit the server has
      // not seen: queue it again, or the server keeps the old speciesId. A
      // record parked in conflict stays there for the user to resolve.
      syncState: s.syncState === 'conflict' ? s.syncState : 'local',
      updatedAt: Date.now(),
    })
    changed++
  }
  return changed
}
