/**
 * Trips group a day's sightings, mirroring how birders actually work — a walk
 * is a checklist. Assignment by time window is a DEFAULT, never authoritative:
 * it will sometimes group wrongly across midnight or a long drive, so manual
 * reassignment is always available.
 */
import { db, type Trip } from '../../data/db'
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
