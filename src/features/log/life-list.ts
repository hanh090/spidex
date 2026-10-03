/**
 * The life list is a DERIVED query, never a stored table — so it cannot drift
 * out of sync with the sightings it summarises.
 *
 * It reads the species snapshot rather than joining to the pack, so an entry
 * survives its pack being deleted or its species being renamed by a split.
 * Family and pack name are the only fields that need the pack; they are
 * optional and filled in when the pack is still installed.
 */
import { db, speciesUid, type Sighting, type Trip } from '../../data/db'
import { resolve } from '../../data/localized'
import { visibleSightings, visibleTrips } from '../auth/scope'

export interface LifeListEntry {
  /** Pack-scoped key — authored species ids are only unique within a pack. */
  uid: string
  speciesId: string
  packId?: string
  sciName: string
  commonName: string
  firstSeen: number
  /** Stored offset of the first record, to show its date where it was observed. */
  firstSeenOffset: number
  lastSeen: number
  /** Where the first record was made: trip location, trip name, or coordinates. */
  firstPlace?: string
  count: number
  records: number
  /** Present only while the species' pack is installed. */
  family?: string
  packName?: string
  /** True when the species can still be opened in the guide. */
  inGuide: boolean
}

export type LifeListSort = 'date' | 'name' | 'count'
export type LifeListGroup = 'none' | 'pack' | 'family'

function placeOf(s: Sighting, trips: Map<string, Trip>): string | undefined {
  const trip = s.tripId ? trips.get(s.tripId) : undefined
  const label = trip?.locationLabel.trim() || trip?.name.trim()
  if (label) return label
  if (s.lat != null && s.lng != null) return `${s.lat.toFixed(3)}, ${s.lng.toFixed(3)}`
  return undefined
}

export async function buildLifeList(): Promise<LifeListEntry[]> {
  const [all, trips, packs, species] = await Promise.all([
    visibleSightings(),
    visibleTrips(),
    db.packs.toArray(),
    db.species.toArray(),
  ])
  const tripById = new Map(trips.map((tr) => [tr.id, tr]))
  const packName = new Map(packs.map((p) => [p.id, resolve(p.manifest.name)]))
  const spByUid = new Map(species.map((sp) => [sp.uid, sp]))
  const byUid = new Map<string, LifeListEntry>()

  for (const s of all) {
    if (!s.speciesId) continue // Needs-ID records are not life-list entries
    const uid = speciesUid(s.packId ?? '', s.speciesId)
    const existing = byUid.get(uid)
    if (!existing) {
      const sci = s.speciesSnapshot?.sciName ?? s.speciesId
      const live = spByUid.get(uid)
      byUid.set(uid, {
        uid,
        speciesId: s.speciesId,
        packId: s.packId,
        sciName: sci,
        commonName: s.speciesSnapshot?.commonName ?? sci,
        firstSeen: s.at,
        firstSeenOffset: s.tzOffsetMinutes,
        lastSeen: s.at,
        firstPlace: placeOf(s, tripById),
        count: s.count,
        records: 1,
        family: live?.family,
        packName: s.packId ? packName.get(s.packId) : undefined,
        inGuide: !!live,
      })
    } else {
      if (s.at < existing.firstSeen) {
        existing.firstSeen = s.at
        existing.firstSeenOffset = s.tzOffsetMinutes
        existing.firstPlace = placeOf(s, tripById)
      }
      existing.lastSeen = Math.max(existing.lastSeen, s.at)
      existing.count += s.count
      existing.records += 1
    }
  }

  return [...byUid.values()].sort((a, b) => b.firstSeen - a.firstSeen)
}

const cmp: Record<LifeListSort, (a: LifeListEntry, b: LifeListEntry) => number> = {
  date: (a, b) => b.firstSeen - a.firstSeen,
  name: (a, b) => a.commonName.localeCompare(b.commonName) || a.sciName.localeCompare(b.sciName),
  count: (a, b) => b.count - a.count || a.commonName.localeCompare(b.commonName),
}

export interface LifeListSection {
  /** Group label, or null for the ungrouped list and for entries with no pack/family known. */
  label: string | null
  entries: LifeListEntry[]
}

/** Sort within groups; groups themselves are ordered by label, unknown last. */
export function groupLifeList(entries: LifeListEntry[], group: LifeListGroup, sort: LifeListSort): LifeListSection[] {
  const sorted = [...entries].sort(cmp[sort])
  if (group === 'none') return [{ label: null, entries: sorted }]
  const buckets = new Map<string | null, LifeListEntry[]>()
  for (const e of sorted) {
    const key = (group === 'pack' ? e.packName : e.family) ?? null
    const list = buckets.get(key) ?? []
    list.push(e)
    buckets.set(key, list)
  }
  return [...buckets.entries()]
    .sort(([a], [b]) => (a === null ? 1 : b === null ? -1 : a.localeCompare(b)))
    .map(([label, items]) => ({ label, entries: items }))
}
