/**
 * Shared device: the previous account's records must never reach the next
 * person, whether they sign in or stay a guest. Runs against real (fake)
 * IndexedDB so the visibility rule is exercised where it is enforced.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { db, getInstallId } from '../../../data/db'
import { buildLifeList } from '../../log/life-list'
import { listSightings, listNeedsId, saveSighting } from '../../log/sighting-repo'
import { activeTrip, listTrips, listTripSummaries, startTrip, tripSightings } from '../../log/trip-repo'
import { claimGuestSightings } from '../claim'
import { beginUserSession, endUserSession } from '../session-transitions'
import { canViewSighting, countUnsynced, getActiveUserId } from '../scope'

beforeEach(async () => {
  await Promise.all([db.sightings.clear(), db.photos.clear(), db.trips.clear(), db.meta.clear(), db.species.clear(), db.packs.clear()])
})

const log = (notes: string) => saveSighting({ count: 1, notes, photos: [] })
const notes = async () => (await listSightings()).map((s) => s.notes).sort()

describe('shared-device isolation', () => {
  it('B sees zero of A\'s sightings after A signs out and B signs in', async () => {
    await log('guest-before')
    await beginUserSession('user-a')
    await log('a-signed-in')
    expect(await notes()).toEqual(['a-signed-in', 'guest-before'])

    await endUserSession()
    await beginUserSession('user-b')

    expect(await notes()).toEqual([])
    expect(await listNeedsId()).toEqual([])
    expect(await buildLifeList()).toEqual([])
    // A's rows are still on the device, untouched and still A's.
    const all = await db.sightings.toArray()
    expect(all).toHaveLength(2)
    expect(all.every((s) => s.userId === 'user-a')).toBe(true)
  })

  it('a guest after sign-out also sees none of A\'s records', async () => {
    await beginUserSession('user-a')
    await log('a-only')
    await endUserSession()
    expect(await notes()).toEqual([])
    expect(await getActiveUserId()).toBeNull()
  })

  it('B cannot open A\'s record by id', async () => {
    await beginUserSession('user-a')
    const { id } = await log('private')
    await endUserSession()
    await beginUserSession('user-b')
    expect(await canViewSighting(await db.sightings.get(id))).toBe(false)
  })

  it('rotates the install id on sign-out', async () => {
    const before = await getInstallId()
    await beginUserSession('user-a')
    expect(await getInstallId()).toBe(before)
    await endUserSession()
    const after = await getInstallId()
    expect(after).not.toBe(before)
    await beginUserSession('user-b')
    const { id } = await log('b-record')
    expect((await db.sightings.get(id))!.installId).toBe(after)
  })

  it('B claims only records made after sign-out, never A\'s', async () => {
    await beginUserSession('user-a')
    await log('a-record')
    await endUserSession()
    await log('guest-between')
    await beginUserSession('user-b')

    expect(await notes()).toEqual(['guest-between'])
    const byNote = Object.fromEntries((await db.sightings.toArray()).map((s) => [s.notes, s.userId]))
    expect(byNote).toEqual({ 'a-record': 'user-a', 'guest-between': 'user-b' })
  })

  it('A gets their records back on the next sign-in', async () => {
    await beginUserSession('user-a')
    await log('a-record')
    await endUserSession()
    await beginUserSession('user-b')
    await endUserSession()
    await beginUserSession('user-a')
    expect(await notes()).toEqual(['a-record'])
  })

  it('sign-out stamps any residual unowned record to the departing user so it cannot be inherited', async () => {
    await beginUserSession('user-a')
    // A record that slipped in without an owner (e.g. created mid-transition).
    await db.sightings.put({ ...(await db.sightings.get((await log('seed')).id))!, id: 'orphan', userId: undefined, notes: 'orphan' })
    await endUserSession()
    await beginUserSession('user-b')
    expect(await notes()).toEqual([])
    expect((await db.sightings.get('orphan'))!.userId).toBe('user-a')
  })

  it('claim never re-stamps records another account owns', async () => {
    await beginUserSession('user-a')
    await log('a-record')
    expect(await claimGuestSightings('user-b')).toBe(0)
    expect((await db.sightings.toArray())[0]!.userId).toBe('user-a')
  })

  it('scopes trips too', async () => {
    await beginUserSession('user-a')
    const trip = await startTrip('A\'s secret spot', 'somewhere')
    const { id } = await log('a-record')
    await db.sightings.update(id, { tripId: trip.id })
    expect((await activeTrip())?.id).toBe(trip.id)

    await endUserSession()
    await beginUserSession('user-b')
    expect(await listTrips()).toEqual([])
    expect(await activeTrip()).toBeUndefined()
    expect(await listTripSummaries()).toEqual([])
    expect(await tripSightings(trip.id)).toEqual([])
  })

  it('a guest trip is claimed along with the guest\'s sightings', async () => {
    const trip = await startTrip('Walk', '')
    await beginUserSession('user-a')
    expect((await db.trips.get(trip.id))!.userId).toBe('user-a')
    await endUserSession()
    await beginUserSession('user-b')
    expect(await listTrips()).toEqual([])
  })

  it('stamps new records with the signed-in user so sync picks them up', async () => {
    await beginUserSession('user-a')
    const { id } = await log('mine')
    expect((await db.sightings.get(id))!.userId).toBe('user-a')
  })
})

describe('countUnsynced', () => {
  it('counts guest records and anything not yet synced, but not synced ones', async () => {
    await log('guest')
    expect(await countUnsynced()).toBe(1)

    await beginUserSession('user-a')
    const synced = await log('synced')
    await db.sightings.update(synced.id, { syncState: 'synced' })
    expect(await countUnsynced()).toBe(1) // the claimed guest record is still 'local'

    await db.sightings.toCollection().modify({ syncState: 'synced' })
    expect(await countUnsynced()).toBe(0)
  })

  it('counts a synced record whose photo has not uploaded', async () => {
    await beginUserSession('user-a')
    const { id } = await log('with-photo')
    await db.sightings.update(id, { syncState: 'synced' })
    await db.photos.put({
      id: 'p1', sightingId: id, original: new Blob(['x']), derived: new Blob(['x']),
      width: 1, height: 1, takenAt: 1, syncState: 'queued',
    })
    expect(await countUnsynced()).toBe(1)
  })

  it('ignores another account\'s records', async () => {
    await beginUserSession('user-a')
    await log('a')
    await endUserSession()
    await beginUserSession('user-b')
    expect(await countUnsynced()).toBe(0)
  })
})
