/**
 * The stateful half of the field log, executed against a real IndexedDB.
 *
 * These cover the paths a pure-function suite cannot reach and where the
 * consequences of a bug are unrecoverable user data: quota recovery, tombstone
 * deletion, the sensitivity snapshot that export depends on, day grouping
 * across a timezone boundary, and pack delete keeping sightings.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { db, speciesUid, type Sighting, type StoredSpecies } from '../../../data/db'
import {
  buildSighting, deleteSighting, editDraftFrom, editPatch, groupByDay, listNeedsId, NOTES_MAX, parsePosition, resolveSpecies,
  saveSighting, SightingEditError, updateSighting,
} from '../sighting-repo'
import { buildLifeList } from '../life-list'
import { generalize, toCsv, toGeoJson } from '../export'
import { assessClock, noteWallClock, tzOffsetMinutes } from '../clock'
import { formatDate, formatTime } from '../../../i18n/format'
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
    sounds: [],
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

describe('editing a sighting', () => {
  it('changes only what was edited and marks the record for sync', async () => {
    const { id } = await saveSighting({ species: species(), count: 1, notes: 'on a reed', photos: [] })
    const before = (await db.sightings.get(id))!
    await db.sightings.update(id, { syncState: 'synced' })

    const patch = editPatch(before, { notes: '  on a reed, dived twice ', count: 3 })
    expect(patch).toEqual({ notes: 'on a reed, dived twice', count: 3 })
    await updateSighting(id, patch!)

    const after = (await db.sightings.get(id))!
    expect(after.notes).toBe('on a reed, dived twice')
    expect(after.count).toBe(3)
    expect(after.clientVersion).toBe(before.clientVersion + 1)
    expect(after.syncState).toBe('local')
    // The observation itself is untouched.
    expect(after.at).toBe(before.at)
    expect(after.speciesId).toBe(before.speciesId)
  })

  it('is a no-op when nothing changed, so no version is spent', () => {
    expect(editPatch({ notes: 'same', count: 2 }, { notes: 'same ', count: 2 })).toBeNull()
  })

  it('never stores a count below one or notes the sync API would reject', () => {
    expect(editPatch({ notes: '', count: 4 }, { notes: '', count: 0 })).toEqual({ count: 1 })
    expect(editPatch({ notes: '', count: 4 }, { notes: '', count: Number.NaN })).toBeNull()
    const long = editPatch({ notes: '', count: 1 }, { notes: 'x'.repeat(NOTES_MAX + 50), count: 1 })
    expect(long?.notes).toHaveLength(NOTES_MAX)
  })
})

describe('editing time, position and trip', () => {
  // Seen at 06:15:42.123 on 3 Oct 2026 in Hanoi (UTC+7): 23:15:42 UTC on the 2nd.
  const SEEN = Date.UTC(2026, 9, 2, 23, 15, 42, 123)
  const NOW = Date.UTC(2026, 10, 23)
  const base = {
    notes: 'on a reed', count: 2, at: SEEN, tzOffsetMinutes: 420, clockConfidence: 'trusted' as const,
    lat: 21.028511234, lng: 105.854212345, accuracy: 12, tripId: 'trip-a',
  }

  it('saving the prefilled form changes nothing, even with sub-minute time and full GPS precision', () => {
    // The time input holds minutes and the stored value milliseconds: a parsed
    // round-trip would differ and spend a version on every untouched save.
    expect(editDraftFrom(base).time).toBe('2026-10-03T06:15')
    expect(editPatch(base, editDraftFrom(base), NOW)).toBeNull()
    expect(editPatch(base, { ...editDraftFrom(base), lat: '21.028511234 ', lng: '105.854212345' }, NOW)).toBeNull()
  })

  it("edits the time as wall time at the sighting's own offset, not this device's", () => {
    const patch = editPatch(base, { ...editDraftFrom(base), time: '2026-10-03T05:40' }, NOW)
    expect(patch).toEqual({ at: Date.UTC(2026, 9, 2, 22, 40) })
    // Still the 3rd where it was seen, so it stays in the same day group.
    const [day] = groupByDay([{ ...base, ...patch } as Sighting])
    expect(day!.key).toBe('2026-10-03')
  })

  it('clears the clock warning once the observer has set the time', () => {
    const suspect = { ...base, clockConfidence: 'suspect' as const }
    expect(editPatch(suspect, { ...editDraftFrom(suspect), time: '2026-10-03T07:00' }, NOW))
      .toEqual({ at: Date.UTC(2026, 9, 3, 0, 0), clockConfidence: 'trusted' })
    // An edit that leaves the time alone does not vouch for it.
    expect(editPatch(suspect, { ...editDraftFrom(suspect), notes: 'x' }, NOW)).toEqual({ notes: 'x' })
  })

  it('refuses a time the sync API would reject', () => {
    const at = (time: string) => () => editPatch(base, { ...editDraftFrom(base), time }, NOW)
    expect(at('1999-12-31T23:00')).toThrow(SightingEditError)
    expect(at('2026-11-25T12:00')).toThrow(SightingEditError)
    expect(at('')).toThrow(SightingEditError)
  })

  it('sets a typed position with no accuracy, and clears one when both fields are emptied', () => {
    const none = { ...base, lat: undefined, lng: undefined, accuracy: undefined }
    expect(editPatch(none, { ...editDraftFrom(none), lat: '10,7626', lng: ' 106.6602' }, NOW))
      .toEqual({ lat: 10.7626, lng: 106.6602, accuracy: undefined })

    const cleared = editPatch(base, { ...editDraftFrom(base), lat: '', lng: ' ' }, NOW)
    expect(cleared).toEqual({ lat: undefined, lng: undefined, accuracy: undefined })
    expect(Object.keys(cleared!)).toEqual(['lat', 'lng', 'accuracy'])
  })

  it('refuses half a position or one out of range', () => {
    expect(() => parsePosition('21.0', '')).toThrow(SightingEditError)
    expect(() => parsePosition('91', '105')).toThrow(SightingEditError)
    expect(() => parsePosition('21', '-181')).toThrow(SightingEditError)
    expect(() => parsePosition('north', '105')).toThrow(SightingEditError)
    expect(parsePosition(' ', '')).toBeNull()
  })

  it('moves a sighting to another trip, or out of any trip', () => {
    expect(editPatch(base, { ...editDraftFrom(base), tripId: 'trip-b' }, NOW)).toEqual({ tripId: 'trip-b' })
    expect(editPatch(base, { ...editDraftFrom(base), tripId: '' }, NOW)).toEqual({ tripId: undefined })
  })

  it('persists all three, removes cleared values from the record, and queues it for sync', async () => {
    const { id } = await saveSighting({
      species: species(), count: 1, notes: '', at: SEEN, lat: 21.0285, lng: 105.8542, accuracy: 9, tripId: 'trip-a', photos: [],
    })
    await db.sightings.update(id, { syncState: 'synced' })
    const before = (await db.sightings.get(id))!

    const draft = { ...editDraftFrom(before), time: toInput(before, Date.UTC(2026, 9, 3, 1, 5)), lat: '', lng: '', tripId: 'trip-b' }
    await updateSighting(id, editPatch(before, draft, NOW)!)

    const after = (await db.sightings.get(id))!
    expect(after.at).toBe(Date.UTC(2026, 9, 3, 1, 5))
    expect(after.tripId).toBe('trip-b')
    expect('lat' in after || 'lng' in after || 'accuracy' in after).toBe(false)
    expect(after.tzOffsetMinutes).toBe(before.tzOffsetMinutes)
    expect(after.clientVersion).toBe(before.clientVersion + 1)
    expect(after.syncState).toBe('local')
  })
})

/** The datetime-local value that means `at` on this record's own clock. */
function toInput(s: { tzOffsetMinutes: number }, at: number): string {
  return new Date(at + s.tzOffsetMinutes * 60_000).toISOString().slice(0, 16)
}

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
    expect(await photo!.original!.text()).toBe('original-bytes')
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

  it('renders the day heading as the sighting\'s own date in any reader timezone', () => {
    // 21:10 local (UTC+7) on the 2nd is 14:10Z; the offset-shifted instant is
    // 04:10Z on the 3rd, so only a UTC render keeps the heading on the 2nd.
    const at = Date.parse('2026-10-02T14:10:00Z')
    const row = { ...buildSighting({ count: 1, notes: '', at, photos: [] }, 'i', 'trusted', 'a'), tzOffsetMinutes: 420 }
    const g = groupByDay([row])[0]!
    expect(g.key).toBe('2026-10-02')
    expect(formatDate(g.at, 'UTC')).toMatch(/02/)
    expect(formatDate(g.at, 'UTC')).not.toMatch(/03/)
  })

  it("renders the time on the sighting's own clock, not the reader's", () => {
    const at = Date.parse('2026-10-02T14:10:00Z')
    expect(formatTime(at, 420)).toMatch(/^(21|0?9):10/)
    expect(formatTime(at, -300)).toMatch(/^(0?9):10 AM|^09:10$/)
    expect(formatTime(at, 0)).toMatch(/^(14|0?2):10/)
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
