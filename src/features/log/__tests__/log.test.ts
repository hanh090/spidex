/**
 * The stateful half of the field log, executed against a real IndexedDB.
 *
 * These cover the paths a pure-function suite cannot reach and where the
 * consequences of a bug are unrecoverable user data: quota recovery, tombstone
 * deletion, the sensitivity snapshot that export depends on, day grouping
 * across a timezone boundary, and pack delete keeping sightings.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { db, speciesUid, type StoredSpecies } from '../../../data/db'
import { buildSighting, deleteSighting, groupByDay, listNeedsId, resolveSpecies, saveSighting } from '../sighting-repo'
import { buildLifeList } from '../life-list'
import { generalize, toCsv, toGeoJson } from '../export'
import { assessClock, noteWallClock, tzOffsetMinutes } from '../clock'
import { checkIntegrity, recordUserDataCounts } from '../../../data/integrity'

function species(over: Partial<StoredSpecies> = {}): StoredSpecies {
  const id = over.id ?? 'sp-1'
  const packId = over.packId ?? 'pack-a'
  return {
    uid: speciesUid(packId, id),
    id,
    packId,
    packVersion: 1,
    sciName: 'Troides helena',
    commonNames: { en: 'Common Birdwing' },
    family: 'Papilionidae',
    traits: {},
    keyFeatures: [],
    taxonFields: {},
    similarTo: [],
    months: [],
    sensitivity: 0,
    images: [{ id: 'i1', aspect: 'dorsal', credit: 'C', license: 'CC0-1.0', thumbUrl: 'img/a.svg' }],
    searchBlob: 'troides helena common birdwing',
    ...over,
  }
}

beforeEach(async () => {
  await Promise.all([
    db.sightings.clear(), db.photos.clear(), db.species.clear(),
    db.packs.clear(), db.trips.clear(), db.favourites.clear(), db.meta.clear(),
  ])
})

describe('saveSighting', () => {
  it('saves with no species, no GPS and no photos', async () => {
    const { id } = await saveSighting({ count: 1, notes: 'big and gold', photos: [] })
    const row = await db.sightings.get(id)
    expect(row).toBeDefined()
    expect(row!.speciesId).toBeUndefined()
    expect(row!.lat).toBeUndefined()
    expect(row!.notes).toBe('big and gold')
  })

  it('records a species with its pack binding and a sensitivity snapshot', async () => {
    const sp = species({ sensitivity: 2 })
    const { id } = await saveSighting({ species: sp, count: 2, notes: '', photos: [] })
    const row = await db.sightings.get(id)
    expect(row!.packId).toBe('pack-a')
    expect(row!.packVersion).toBe(1)
    // Export must never need the species row to decide on generalization.
    expect(row!.speciesSnapshot).toEqual({
      sciName: 'Troides helena', commonName: 'Common Birdwing', sensitivity: 2,
    })
  })

  it('a record with no species is in the Needs-ID queue', async () => {
    await saveSighting({ count: 1, notes: 'unknown', photos: [] })
    await saveSighting({ species: species(), count: 1, notes: '', photos: [] })
    const queue = await listNeedsId()
    expect(queue).toHaveLength(1)
    expect(queue[0]!.notes).toBe('unknown')
  })

  it('resolving a Needs-ID record keeps its notes and stamps the snapshot', async () => {
    const { id } = await saveSighting({ count: 1, notes: 'black and gold, high canopy', photos: [] })
    await resolveSpecies(id, species({ sensitivity: 3 }))
    const row = await db.sightings.get(id)
    expect(row!.notes).toBe('black and gold, high canopy')
    expect(row!.speciesId).toBe('sp-1')
    expect(row!.speciesSnapshot!.sensitivity).toBe(3)
    expect(row!.clientVersion).toBe(2)   // an edit bumps the ordering key
  })
})

describe('deleteSighting', () => {
  it('tombstones the photos instead of destroying the originals', async () => {
    const { id } = await saveSighting({ count: 1, notes: '', photos: [] })
    await db.photos.put({
      id: 'ph-1', sightingId: id,
      original: new Blob(['original-bytes']), derived: new Blob(['derived']),
      width: 10, height: 10, takenAt: Date.now(), syncState: 'local',
    })

    await deleteSighting(id)

    expect(await db.sightings.get(id)).toBeUndefined()
    const photo = await db.photos.get('ph-1')
    expect(photo, 'the photo row must survive as a tombstone').toBeDefined()
    expect(photo!.deletedAt).toBeGreaterThan(0)
    expect(await photo!.original.text()).toBe('original-bytes')
  })
})

describe('life list', () => {
  it('is derived, and survives its pack being deleted', async () => {
    const sp = species()
    await db.packs.put({
      id: 'pack-a', version: 1, tier: 'thumb', installedAt: Date.now(), bytes: 0,
      manifest: {
        id: 'pack-a', name: { en: 'A' }, taxonGroup: 'x', region: 'y', version: 1,
        license: 'CC0-1.0', sources: [], speciesCount: 1,
        sizeBytes: { thumb: 0, full: 0 }, idRemap: [],
        traitSchema: { traits: [{ key: 'k', label: { en: 'K' }, type: 'single', render: 'chip', options: [{ v: 'a' }, { v: 'b' }] }], aspects: { required: ['dorsal'], optional: [] }, sections: [] },
      },
    })
    await db.species.put(sp)
    await saveSighting({ species: sp, count: 3, notes: '', photos: [] })
    await saveSighting({ species: sp, count: 1, notes: '', photos: [] })

    await db.species.clear()   // as deletePack does — sightings are kept

    const list = await buildLifeList()
    expect(list).toHaveLength(1)
    expect(list[0]!.commonName).toBe('Common Birdwing')
    expect(list[0]!.count).toBe(4)
    expect(list[0]!.records).toBe(2)
  })

  it('excludes unidentified records', async () => {
    await saveSighting({ count: 1, notes: 'unknown', photos: [] })
    expect(await buildLifeList()).toHaveLength(0)
  })
})

describe('groupByDay', () => {
  it('groups by the sighting\'s own local day, not the reader\'s timezone', () => {
    // 22:00 in UTC+7 is still the 7th locally, though it is the 7th 15:00 UTC.
    const at = Date.parse('2026-09-07T15:00:00Z')
    const rows = [
      buildSighting({ count: 1, notes: '', at, photos: [] }, 'i', 'trusted', 'a'),
      buildSighting({ count: 1, notes: '', at: at + 3_600_000, photos: [] }, 'i', 'trusted', 'b'),
    ].map((s) => ({ ...s, tzOffsetMinutes: 420 }))

    const groups = groupByDay(rows)
    expect(groups).toHaveLength(1)
    expect(groups[0]!.key).toBe('2026-09-07')
    // The heading instant is offset-corrected, so formatting cannot shift it.
    expect(new Date(groups[0]!.at).toISOString().slice(0, 10)).toBe('2026-09-07')
  })

  it('splits records that fall on different local days', () => {
    const rows = [
      { ...buildSighting({ count: 1, notes: '', at: Date.parse('2026-09-07T20:00:00Z'), photos: [] }, 'i', 'trusted', 'a'), tzOffsetMinutes: 420 },
      { ...buildSighting({ count: 1, notes: '', at: Date.parse('2026-09-06T20:00:00Z'), photos: [] }, 'i', 'trusted', 'b'), tzOffsetMinutes: 420 },
    ]
    expect(groupByDay(rows).map((g) => g.key)).toEqual(['2026-09-08', '2026-09-07'])
  })
})

describe('clock trust', () => {
  it('flags a backwards jump — the drained-battery case', async () => {
    const now = Date.parse('2026-09-08T10:00:00Z')
    await noteWallClock(now)
    expect(await assessClock(now + 60_000)).toBe('trusted')
    // Device boots to a factory date well before what the app has already seen.
    expect(await assessClock(Date.parse('2026-09-01T00:00:01Z'))).toBe('suspect')
  })

  it('tolerates a small NTP correction backwards', async () => {
    const now = Date.parse('2026-09-08T10:00:00Z')
    await noteWallClock(now)
    expect(await assessClock(now - 5_000)).toBe('trusted')
  })

  it('reports an offset in Intl sign convention', () => {
    const d = new Date()
    expect(tzOffsetMinutes(d)).toBe(-d.getTimezoneOffset())
  })
})

describe('export', () => {
  it('generalizes by GBIF category and withholds category 1 entirely', () => {
    expect(generalize(10.8231, 106.6297, 0, false)).toEqual({ lat: 10.8231, lng: 106.6297, generalized: false })
    expect(generalize(10.8231, 106.6297, 2, false)).toEqual({ lat: 10.8, lng: 106.6, generalized: true })
    expect(generalize(10.8231, 106.6297, 3, false)).toEqual({ lat: 10.8, lng: 106.6, generalized: true })
    expect(generalize(10.8231, 106.6297, 1, false)).toEqual({ generalized: true })
  })

  it('only reveals full precision on an explicit opt-in', () => {
    expect(generalize(10.8231, 106.6297, 2, true)).toEqual({ lat: 10.8231, lng: 106.6297, generalized: false })
  })

  it('does NOT fail open when the species row is gone', async () => {
    const sp = species({ sensitivity: 2 })
    const { id } = await saveSighting({
      species: sp, count: 1, notes: '', lat: 10.8231, lng: 106.6297, accuracy: 12, photos: [],
    })
    await db.species.clear()   // pack removed to free space

    const csv = toCsv([(await db.sightings.get(id))!])
    expect(csv).toContain('10.8,106.6')
    expect(csv).not.toContain('10.8231')
    // Accuracy is dropped alongside a generalized position.
    expect(csv).toMatch(/10\.8,106\.6,,true/)
  })

  it('defaults to generalized when a snapshot is somehow missing', async () => {
    const { id } = await saveSighting({ count: 1, notes: '', lat: 10.8231, lng: 106.6297, photos: [] })
    await db.sightings.update(id, { speciesId: 'orphan' })   // id but no snapshot
    const csv = toCsv([(await db.sightings.get(id))!])
    expect(csv).not.toContain('10.8231')
  })

  it('neutralises CSV formula injection in notes', async () => {
    const { id } = await saveSighting({ count: 1, notes: '=HYPERLINK("http://x","tap")', photos: [] })
    const csv = toCsv([(await db.sightings.get(id))!])
    expect(csv).toContain("'=HYPERLINK")
  })

  it('omits features with no coordinates from GeoJSON', async () => {
    const { id } = await saveSighting({ count: 1, notes: '', photos: [] })
    const gj = JSON.parse(toGeoJson([(await db.sightings.get(id))!]))
    expect(gj.features).toHaveLength(0)
  })
})

describe('integrity', () => {
  it('does not cry wolf when the user deletes a sighting', async () => {
    const { id } = await saveSighting({ count: 1, notes: '', photos: [] })
    await recordUserDataCounts()
    await deleteSighting(id)          // updates the mark as it goes
    const report = await checkIntegrity()
    expect(report.userDataLost).toBe(false)
  })

  it('detects records vanishing without a deletion', async () => {
    await saveSighting({ count: 1, notes: '', photos: [] })
    await recordUserDataCounts()
    await db.sightings.clear()         // eviction, not a user action
    const report = await checkIntegrity()
    expect(report.userDataLost).toBe(true)
  })
})
