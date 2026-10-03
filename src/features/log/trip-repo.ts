/**
 * Trips group a day's sightings, mirroring how birders actually work — a walk
 * is a checklist. Assignment by time window is a DEFAULT, never authoritative:
 * it will sometimes group wrongly across midnight or a long drive, so manual
 * reassignment is always available.
 */
import { db, type Sighting, type Trip } from '../../data/db'
import { updateSighting } from './sighting-repo'

export async function startTrip(name: string, locationLabel: string): Promise<Trip> {
  const trip: Trip = { id: crypto.randomUUID(), name, startedAt: Date.now(), locationLabel }
  await db.trips.put(trip)
  return trip
}

export async function endTrip(id: string): Promise<void> {
  await db.trips.update(id, { endedAt: Date.now() })
}

export async function activeTrip(): Promise<Trip | undefined> {
  return (await db.trips.orderBy('startedAt').reverse().toArray()).find((tr) => !tr.endedAt)
}

export async function listTrips(): Promise<Trip[]> {
  return db.trips.orderBy('startedAt').reverse().toArray()
}

export async function reassign(sightingId: string, tripId: string | undefined): Promise<void> {
  await updateSighting(sightingId, { tripId })
}

/** Sightings inside a trip's window that are not yet assigned to one. */
export async function autoAssign(tripId: string): Promise<number> {
  const trip = await db.trips.get(tripId)
  if (!trip) return 0
  const until = trip.endedAt ?? Date.now()
  const candidates = await db.sightings.where('at').between(trip.startedAt, until, true, true).toArray()
  let n = 0
  for (const s of candidates) {
    if (s.tripId) continue
    await updateSighting(s.id, { tripId })
    n++
  }
  return n
}

export async function getTrip(id: string): Promise<Trip | undefined> {
  return db.trips.get(id)
}

export type TripPatch = Partial<Pick<Trip, 'name' | 'locationLabel' | 'startedAt' | 'endedAt'>>

/** Rejects an end before the start rather than saving a trip with a negative window. */
export async function updateTrip(id: string, patch: TripPatch): Promise<void> {
  const current = await db.trips.get(id)
  if (!current) return
  const startedAt = patch.startedAt ?? current.startedAt
  const endedAt = 'endedAt' in patch ? patch.endedAt : current.endedAt
  if (endedAt != null && endedAt < startedAt) throw new Error('trip-end-before-start')
  await db.trips.update(id, { ...patch })
}

/**
 * Re-open an ended trip. Only one trip is active at a time (new sightings
 * attach to it), so any other open trip is closed first.
 */
export async function resumeTrip(id: string): Promise<void> {
  await db.transaction('rw', db.trips, async () => {
    const now = Date.now()
    for (const tr of await db.trips.toArray()) {
      if (tr.id !== id && !tr.endedAt) await db.trips.update(tr.id, { endedAt: now })
    }
    await db.trips.update(id, { endedAt: undefined })
  })
}

export interface TripSummary {
  trip: Trip
  records: number
  species: number
}

/** Distinct species by pack-scoped id; Needs-ID records add no species. */
export function countSpecies(sightings: Sighting[]): number {
  return new Set(sightings.filter((s) => s.speciesId).map((s) => `${s.packId ?? ''}:${s.speciesId}`)).size
}

export async function tripSightings(tripId: string): Promise<Sighting[]> {
  return (await db.sightings.where('tripId').equals(tripId).sortBy('at')).reverse()
}

export async function listTripSummaries(): Promise<TripSummary[]> {
  const [trips, sightings] = await Promise.all([listTrips(), db.sightings.toArray()])
  const byTrip = new Map<string, Sighting[]>()
  for (const s of sightings) {
    if (!s.tripId) continue
    const list = byTrip.get(s.tripId) ?? []
    list.push(s)
    byTrip.set(s.tripId, list)
  }
  return trips.map((trip) => {
    const rows = byTrip.get(trip.id) ?? []
    return { trip, records: rows.length, species: countSpecies(rows) }
  })
}
