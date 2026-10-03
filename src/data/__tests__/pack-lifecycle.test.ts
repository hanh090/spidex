/**
 * Pack lifecycle against a real IndexedDB.
 *
 * These are regression tests for three defects that a pure-function suite
 * cannot see and that each break a stated guarantee:
 *
 *   - `sightings.packId` was unindexed, so pack delete threw before it could
 *     count references — the confirm dialog never appeared.
 *   - `species` was keyed on the bare species id, so two packs sharing a
 *     taxon id silently overwrote each other.
 *   - the taxonomic id remap was never called, so a pack update orphaned the
 *     log it was written to protect.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { db, speciesUid, setActivePackId, type StoredPack, type StoredSpecies } from '../db'
import { deletePack, packReferenceCount } from '../pack-download'
import { applyIdRemap } from '../pack-update'
import { saveSighting } from '../../features/log/sighting-repo'
import { buildLifeList } from '../../features/log/life-list'
import type { PackManifest } from '../pack-manifest'

function manifest(id: string, version = 1, idRemap: { from: string; to: string }[] = []): PackManifest {
  return {
    id, name: { en: id }, taxonGroup: 'lepidoptera', region: 'fixture', version,
    license: 'CC0-1.0', sources: [], speciesCount: 1,
    sizeBytes: { thumb: 0, full: 0 }, idRemap,
    traitSchema: {
      traits: [{ key: 'size', label: { en: 'Size' }, type: 'single', render: 'chip', options: [{ v: 'a' }, { v: 'b' }] }],
      aspects: { required: ['dorsal'], optional: [] },
      sections: [],
    },
  }
}

function pack(id: string, version = 1, idRemap: { from: string; to: string }[] = []): StoredPack {
  return { id, manifest: manifest(id, version, idRemap), version, tier: 'thumb', installedAt: Date.now(), bytes: 0 }
}

function species(packId: string, id: string, over: Partial<StoredSpecies> = {}): StoredSpecies {
  return {
    uid: speciesUid(packId, id), id, packId, packVersion: 1,
    sciName: `Sci ${id}`, commonNames: { en: `Common ${id}` }, family: 'F',
    traits: { size: 'a' }, keyFeatures: [], taxonFields: {}, similarTo: [], months: [],
    sensitivity: 0,
    images: [{ id: `${id}-i`, aspect: 'dorsal', credit: 'C', license: 'CC0-1.0', thumbUrl: 'img/a.svg' }],
    sounds: [],
    searchBlob: `sci ${id} common ${id}`,
    ...over,
  }
}

beforeEach(async () => {
  await Promise.all([
    db.packs.clear(), db.species.clear(), db.sightings.clear(),
    db.photos.clear(), db.favourites.clear(), db.meta.clear(),
  ])
})

describe('pack delete', () => {
  it('counts the sightings that reference a pack without throwing', async () => {
    await db.packs.put(pack('pack-a'))
    const sp = species('pack-a', 'sp-1')
    await db.species.put(sp)
    await saveSighting({ species: sp, count: 1, notes: '', photos: [] })
    await saveSighting({ species: sp, count: 1, notes: '', photos: [] })

    // Regression: this query needs sightings.packId to be indexed.
    await expect(packReferenceCount('pack-a')).resolves.toBe(2)
  })

  it('removes the pack and its species but KEEPS the sightings', async () => {
    await db.packs.put(pack('pack-a'))
    const sp = species('pack-a', 'sp-1')
    await db.species.put(sp)
    await db.favourites.put({ id: 'pack-a:sp-1', packId: 'pack-a', speciesId: 'sp-1', addedAt: Date.now() })
    await saveSighting({ species: sp, count: 1, notes: 'keep me', photos: [] })

    await deletePack('pack-a')

    expect(await db.packs.get('pack-a')).toBeUndefined()
    expect(await db.species.where('packId').equals('pack-a').count()).toBe(0)
    expect(await db.favourites.count()).toBe(0)

    const kept = await db.sightings.toArray()
    expect(kept).toHaveLength(1)
    expect(kept[0]!.notes).toBe('keep me')
    // Readable without its pack, via the snapshot.
    expect(kept[0]!.speciesSnapshot!.commonName).toBe('Common sp-1')
    expect(await buildLifeList()).toHaveLength(1)
  })

  it('clears the active scope when the last pack goes', async () => {
    await db.packs.put(pack('pack-a'))
    await setActivePackId('pack-a')
    await deletePack('pack-a')
    expect(await db.meta.get('activePackId').then((r) => r?.value)).toBeNull()
  })
})

describe('two packs sharing a species id', () => {
  it('coexist, and deleting one leaves the other intact', async () => {
    await db.packs.bulkPut([pack('pack-a'), pack('pack-b')])
    // Both packs use the id "sp-1" — routine across regional packs.
    await db.species.bulkPut([
      species('pack-a', 'sp-1', { sciName: 'Alpha one' }),
      species('pack-b', 'sp-1', { sciName: 'Beta one' }),
    ])

    expect(await db.species.count()).toBe(2)

    await deletePack('pack-b')

    const left = await db.species.toArray()
    expect(left).toHaveLength(1)
    expect(left[0]!.sciName).toBe('Alpha one')
    expect(left[0]!.uid).toBe('pack-a:sp-1')
  })
})

describe('taxonomic id remap', () => {
  it('re-points sightings and refreshes their snapshot', async () => {
    await db.packs.put(pack('pack-a', 1))
    const old = species('pack-a', 'sp-old', { sciName: 'Papilio polytes', commonNames: { en: 'Common Mormon' } })
    await db.species.put(old)
    const { id: sightingId } = await saveSighting({ species: old, count: 1, notes: '', photos: [] })

    // v2 splits sp-old into sp-new, with a new name and a sensitivity change.
    const v2 = manifest('pack-a', 2, [{ from: 'sp-old', to: 'sp-new' }])
    await db.species.put(species('pack-a', 'sp-new', {
      sciName: 'Papilio romulus', commonNames: { en: 'Romulus Mormon' }, sensitivity: 2, packVersion: 2,
    }))

    const changed = await applyIdRemap('pack-a', v2)
    expect(changed).toBe(1)

    const row = await db.sightings.get(sightingId)
    expect(row!.speciesId).toBe('sp-new')
    expect(row!.packVersion).toBe(2)
    // The snapshot follows the split — otherwise the life list would show the
    // pre-split name against a post-split id forever.
    expect(row!.speciesSnapshot!.sciName).toBe('Papilio romulus')
    expect(row!.speciesSnapshot!.sensitivity).toBe(2)
    expect(row!.clientVersion).toBe(2)
  })

  it('queues an already synced sighting for upload so the server learns the new id, but leaves conflicts parked', async () => {
    await db.packs.put(pack('pack-a', 1))
    const old = species('pack-a', 'sp-old')
    await db.species.bulkPut([old, species('pack-a', 'sp-new', { packVersion: 2 })])
    const synced = (await saveSighting({ species: old, count: 1, notes: '', photos: [] })).id
    const parked = (await saveSighting({ species: old, count: 1, notes: '', photos: [] })).id
    await db.sightings.update(synced, { syncState: 'synced' })
    await db.sightings.update(parked, { syncState: 'conflict' })

    await applyIdRemap('pack-a', manifest('pack-a', 2, [{ from: 'sp-old', to: 'sp-new' }]))
    expect((await db.sightings.get(synced))!.syncState).toBe('local')
    expect((await db.sightings.get(parked))!.syncState).toBe('conflict')
  })

  it('leaves unmapped sightings alone', async () => {
    await db.packs.put(pack('pack-a', 1))
    const sp = species('pack-a', 'sp-keep')
    await db.species.put(sp)
    const { id } = await saveSighting({ species: sp, count: 1, notes: '', photos: [] })

    const changed = await applyIdRemap('pack-a', manifest('pack-a', 2, [{ from: 'sp-other', to: 'sp-new' }]))
    expect(changed).toBe(0)
    expect((await db.sightings.get(id))!.speciesId).toBe('sp-keep')
  })

  it('is a no-op when the manifest declares no remap', async () => {
    await expect(applyIdRemap('pack-a', manifest('pack-a', 2))).resolves.toBe(0)
  })
})
