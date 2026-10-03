/**
 * Trip detail, life list and favourites against a real IndexedDB: the derived
 * queries must survive pack removal and must key species by pack, not bare id.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { db, speciesUid, type StoredSpecies } from '../../../data/db'
import { buildSighting, groupByDay, saveSighting } from '../sighting-repo'
import { buildLifeList, groupLifeList } from '../life-list'
import { listFavourites, removeFavourite } from '../favourites-repo'
import {
  autoAssign, countSpecies, listTripSummaries, reassign, resumeTrip, startTrip, endTrip, tripSightings, updateTrip,
} from '../trip-repo'
import { fromLocalInput, toLocalInput } from '../clock'

function species(over: Partial<StoredSpecies> = {}): StoredSpecies {
  const id = over.id ?? 'sp-1'
  const packId = over.packId ?? 'pack-a'
  return {
    uid: speciesUid(packId, id), id, packId, packVersion: 1,
    sciName: 'Troides helena', commonNames: { en: 'Common Birdwing' }, family: 'Papilionidae',
    traits: {}, keyFeatures: [], taxonFields: {}, similarTo: [], months: [], sensitivity: 0,
    images: [], sounds: [], searchBlob: '', ...over,
  }
}

async function putPack(id: string, name: string) {
  await db.packs.put({
    id, version: 1, tier: 'thumb', installedAt: Date.now(), bytes: 0,
    manifest: {
      id, name: { en: name }, taxonGroup: 'x', region: 'y', version: 1, license: 'CC0-1.0', sources: [],
      speciesCount: 1, sizeBytes: { thumb: 0, full: 0 }, idRemap: [],
      traitSchema: { traits: [], aspects: { required: [], optional: [] }, sections: [] },
    },
  } as never)
}

beforeEach(async () => {
  await Promise.all([
    db.sightings.clear(), db.photos.clear(), db.species.clear(),
    db.packs.clear(), db.trips.clear(), db.favourites.clear(), db.meta.clear(),
  ])
})

describe('life list aggregation', () => {
  it('keeps first-seen date and place, count and survives removal of the pack', async () => {
    await putPack('pack-a', 'Pack A')
    const sp = species()
    await db.species.put(sp)
    const trip = await startTrip('Cat Tien', 'Cat Tien NP')
    await saveSighting({ species: sp, count: 2, notes: '', at: 2_000_000, tripId: trip.id, photos: [] })
    await saveSighting({ species: sp, count: 1, notes: '', at: 1_000_000, lat: 10.12345, lng: 106.5, photos: [] })
    await saveSighting({ species: sp, count: 4, notes: '', at: 3_000_000, photos: [] })

    let [entry] = await buildLifeList()
    expect(entry!.count).toBe(7)
    expect(entry!.records).toBe(3)
    expect(entry!.firstSeen).toBe(1_000_000)
    expect(entry!.lastSeen).toBe(3_000_000)
    expect(entry!.firstPlace).toBe('10.123, 106.500')
    expect(entry!.family).toBe('Papilionidae')
    expect(entry!.packName).toBe('Pack A')
    expect(entry!.inGuide).toBe(true)

    // Pack removed: species rows and the pack go, sightings stay.
    await db.species.clear()
    await db.packs.clear()
    ;[entry] = await buildLifeList()
    expect(entry!.commonName).toBe('Common Birdwing')
    expect(entry!.sciName).toBe('Troides helena')
    expect(entry!.count).toBe(7)
    expect(entry!.inGuide).toBe(false)
    expect(entry!.family).toBeUndefined()
    expect(entry!.packName).toBeUndefined()
  })

  it('uses the trip location as the first place', async () => {
    const sp = species()
    const trip = await startTrip('Walk', 'Bach Ma')
    await saveSighting({ species: sp, count: 1, notes: '', at: 5, tripId: trip.id, photos: [] })
    expect((await buildLifeList())[0]!.firstPlace).toBe('Bach Ma')
  })

  it('does not merge same-id species from different packs', async () => {
    await saveSighting({ species: species({ packId: 'pack-a' }), count: 1, notes: '', photos: [] })
    await saveSighting({ species: species({ packId: 'pack-b', sciName: 'Other', commonNames: { en: 'Other' } }), count: 1, notes: '', photos: [] })
    expect(await buildLifeList()).toHaveLength(2)
  })

  it('groups by pack and family, unknown last, and sorts within groups', async () => {
    await putPack('pack-a', 'Alpha')
    await putPack('pack-b', 'Beta')
    const a1 = species({ id: 'a1', commonNames: { en: 'Zed' }, sciName: 'Z z', packId: 'pack-a', family: 'Fam1' })
    const a2 = species({ id: 'a2', commonNames: { en: 'Abe' }, sciName: 'A a', packId: 'pack-a', family: 'Fam2' })
    const b1 = species({ id: 'b1', commonNames: { en: 'Mid' }, sciName: 'M m', packId: 'pack-b', family: 'Fam1' })
    await db.species.bulkPut([a1, a2, b1])
    for (const [i, sp] of [a1, a2, b1].entries()) {
      await saveSighting({ species: sp, count: i + 1, notes: '', at: 1000 * (i + 1), photos: [] })
    }
    await db.species.delete(b1.uid) // family unknown for b1 now
    const list = await buildLifeList()

    const byPack = groupLifeList(list, 'pack', 'name')
    expect(byPack.map((s) => s.label)).toEqual(['Alpha', 'Beta'])
    expect(byPack[0]!.entries.map((e) => e.commonName)).toEqual(['Abe', 'Zed'])

    const byFamily = groupLifeList(list, 'family', 'count')
    expect(byFamily.map((s) => s.label)).toEqual(['Fam1', 'Fam2', null])

    expect(groupLifeList(list, 'none', 'date')[0]!.entries.map((e) => e.commonName)).toEqual(['Mid', 'Abe', 'Zed'])
    expect(groupLifeList(list, 'none', 'count')[0]!.entries.map((e) => e.commonName)).toEqual(['Mid', 'Abe', 'Zed'])
  })

  it('ignores Needs-ID records', async () => {
    await saveSighting({ count: 1, notes: 'unknown', photos: [] })
    expect(await buildLifeList()).toEqual([])
  })
})

describe('trips', () => {
  it('lists a trip\'s sightings newest first, grouped by day, with a species count', async () => {
    const sp = species()
    const other = species({ id: 'sp-2', sciName: 'Other' })
    const trip = await startTrip('T', 'L')
    const day1 = Date.parse('2026-09-07T03:00:00Z')
    const day2 = day1 + 86_400_000
    await saveSighting({ species: sp, count: 1, notes: '', at: day1, tripId: trip.id, photos: [] })
    await saveSighting({ species: sp, count: 1, notes: '', at: day1 + 60_000, tripId: trip.id, photos: [] })
    await saveSighting({ species: other, count: 1, notes: '', at: day2, tripId: trip.id, photos: [] })
    await saveSighting({ count: 1, notes: 'unknown', at: day2 + 1, tripId: trip.id, photos: [] })
    await saveSighting({ species: sp, count: 1, notes: '', at: day2, photos: [] }) // not in the trip

    const rows = await tripSightings(trip.id)
    expect(rows).toHaveLength(4)
    expect(rows[0]!.at).toBeGreaterThanOrEqual(rows[3]!.at)
    expect(countSpecies(rows)).toBe(2)
    const groups = groupByDay(rows.map((r) => ({ ...r, tzOffsetMinutes: 420 })))
    expect(groups.map((g) => g.items.length)).toEqual([2, 2])

    const [summary] = await listTripSummaries()
    expect(summary).toMatchObject({ records: 4, species: 2 })
  })

  it('edits, rejects an end before the start, and reassigns a sighting out', async () => {
    const trip = await startTrip('Old', '')
    await updateTrip(trip.id, { name: 'New', locationLabel: 'Here', startedAt: 1000, endedAt: 2000 })
    expect(await db.trips.get(trip.id)).toMatchObject({ name: 'New', locationLabel: 'Here', startedAt: 1000, endedAt: 2000 })
    await expect(updateTrip(trip.id, { endedAt: 500 })).rejects.toThrow('trip-end-before-start')

    const { id } = await saveSighting({ count: 1, notes: '', at: 1500, tripId: trip.id, photos: [] })
    await reassign(id, undefined)
    expect(await tripSightings(trip.id)).toHaveLength(0)
  })

  it('ends then resumes, closing any other open trip', async () => {
    const a = await startTrip('A', '')
    await endTrip(a.id)
    const b = await startTrip('B', '')
    await resumeTrip(a.id)
    expect((await db.trips.get(a.id))!.endedAt).toBeUndefined()
    expect((await db.trips.get(b.id))!.endedAt).toBeDefined()
  })

  it('adds unassigned sightings inside the window only', async () => {
    const trip = await startTrip('W', '')
    await updateTrip(trip.id, { startedAt: 1000, endedAt: 3000 })
    await db.sightings.bulkPut([
      buildSighting({ count: 1, notes: '', at: 2000, photos: [] }, 'i', 'trusted', 'in'),
      buildSighting({ count: 1, notes: '', at: 9000, photos: [] }, 'i', 'trusted', 'out'),
    ])
    expect(await autoAssign(trip.id)).toBe(1)
    expect((await db.sightings.get('in'))!.tripId).toBe(trip.id)
    expect((await db.sightings.get('out'))!.tripId).toBeUndefined()
  })

  it('round-trips a datetime-local value through the device zone', () => {
    const at = Date.parse('2026-09-07T10:30:00Z')
    expect(Math.abs(fromLocalInput(toLocalInput(at))! - at)).toBeLessThan(60_000)
    expect(fromLocalInput('not a date')).toBeNull()
  })
})

describe('favourites', () => {
  it('flags seen only when a sighting of that pack-scoped species exists', async () => {
    const seenSp = species({ id: 'seen' })
    const unseenSp = species({ id: 'unseen', sciName: 'Unseen' })
    const samePackOther = species({ id: 'seen', packId: 'pack-b' })
    await db.species.bulkPut([seenSp, unseenSp, samePackOther])
    await db.favourites.bulkPut([
      { id: seenSp.uid, packId: 'pack-a', speciesId: 'seen', addedAt: 1 },
      { id: unseenSp.uid, packId: 'pack-a', speciesId: 'unseen', addedAt: 2 },
      { id: samePackOther.uid, packId: 'pack-b', speciesId: 'seen', addedAt: 3 },
    ])
    await saveSighting({ species: seenSp, count: 1, notes: '', at: 500, photos: [] })
    await saveSighting({ species: seenSp, count: 1, notes: '', at: 900, photos: [] })

    const list = await listFavourites()
    const by = Object.fromEntries(list.map((v) => [v.favourite.id, v]))
    expect(by[seenSp.uid]!.seen).toBe(true)
    expect(by[seenSp.uid]!.lastSeen).toBe(900)
    expect(by[unseenSp.uid]!.seen).toBe(false)
    expect(by[samePackOther.uid]!.seen).toBe(false)
    expect(list.map((v) => v.favourite.addedAt)).toEqual([3, 2, 1])
  })

  it('falls back to the sighting snapshot when the pack is gone, and removes', async () => {
    const sp = species()
    await db.favourites.put({ id: sp.uid, packId: sp.packId, speciesId: sp.id, addedAt: 1 })
    await saveSighting({ species: sp, count: 1, notes: '', photos: [] })
    const [v] = await listFavourites()
    expect(v!.species).toBeUndefined()
    expect(v!.commonName).toBe('Common Birdwing')
    expect(v!.seen).toBe(true)

    await removeFavourite(sp.uid)
    expect(await listFavourites()).toEqual([])
  })
})
