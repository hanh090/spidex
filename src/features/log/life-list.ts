/**
 * The life list is a DERIVED query, never a stored table — so it cannot drift
 * out of sync with the sightings it summarises.
 *
 * It reads the species snapshot rather than joining to the pack, so an entry
 * survives its pack being deleted or its species being renamed by a split.
 */
import { db, type Sighting } from '../../data/db'

export interface LifeListEntry {
  speciesId: string
  sciName: string
  commonName: string
  firstSeen: number
  lastSeen: number
  count: number
  records: number
}

export async function buildLifeList(): Promise<LifeListEntry[]> {
  const all: Sighting[] = await db.sightings.toArray()
  const byId = new Map<string, LifeListEntry>()

  for (const s of all) {
    if (!s.speciesId) continue // Needs-ID records are not life-list entries
    const existing = byId.get(s.speciesId)
    const sci = s.speciesSnapshot?.sciName ?? s.speciesId
    const common = s.speciesSnapshot?.commonName ?? sci
    if (!existing) {
      byId.set(s.speciesId, {
        speciesId: s.speciesId,
        sciName: sci,
        commonName: common,
        firstSeen: s.at,
        lastSeen: s.at,
        count: s.count,
        records: 1,
      })
    } else {
      existing.firstSeen = Math.min(existing.firstSeen, s.at)
      existing.lastSeen = Math.max(existing.lastSeen, s.at)
      existing.count += s.count
      existing.records += 1
    }
  }

  return [...byId.values()].sort((a, b) => b.firstSeen - a.firstSeen)
}
