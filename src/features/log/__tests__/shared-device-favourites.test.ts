/**
 * Favourites and trips on a shared device are per person, like sightings, and
 * a sighting's date is the same wherever it is shown.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../../data/db'
import { formatObservedDate } from '../../../i18n/format'
import { beginUserSession, endUserSession } from '../../auth/session-transitions'
import { isFavourite, listFavourites, removeFavourite, setFavourite } from '../favourites-repo'
import { buildLifeList } from '../life-list'
import { activeTrip, resumeTrip, startTrip, endTrip } from '../trip-repo'

beforeEach(async () => {
  await Promise.all([
    db.sightings.clear(), db.photos.clear(), db.trips.clear(), db.favourites.clear(), db.meta.clear(),
    db.species.clear(), db.packs.clear(),
  ])
})

describe('favourites per account', () => {
  it('B does not see A\'s favourites, and each can favourite the same species', async () => {
    await beginUserSession('user-a')
    await setFavourite('pack-a', 'sp-1', true)
    expect(await isFavourite('pack-a', 'sp-1')).toBe(true)

    await endUserSession()
    await beginUserSession('user-b')
    expect(await listFavourites()).toEqual([])
    expect(await isFavourite('pack-a', 'sp-1')).toBe(false)

    await setFavourite('pack-a', 'sp-1', true)
    expect((await listFavourites()).map((f) => f.favourite.userId)).toEqual(['user-b'])
    expect(await db.favourites.count()).toBe(2) // A's row was not overwritten

    await endUserSession()
    await beginUserSession('user-a')
    expect((await listFavourites()).map((f) => f.favourite.userId)).toEqual(['user-a'])
  })

  it('B cannot remove or toggle off A\'s favourite', async () => {
    await beginUserSession('user-a')
    await setFavourite('pack-a', 'sp-1', true)
    const [aRow] = await db.favourites.toArray()
    await endUserSession()
    await beginUserSession('user-b')
    await removeFavourite(aRow!.id)
    await setFavourite('pack-a', 'sp-1', false)
    expect(await db.favourites.get(aRow!.id)).toBeDefined()
  })

  it('a guest\'s favourites follow them into the account that signs in, and are not inherited after sign-out', async () => {
    await setFavourite('pack-a', 'sp-1', true)
    expect((await listFavourites()).map((f) => f.favourite.userId)).toEqual([undefined])
    await beginUserSession('user-a')
    expect((await listFavourites()).map((f) => f.favourite.userId)).toEqual(['user-a'])
    await endUserSession()
    await beginUserSession('user-b')
    expect(await listFavourites()).toEqual([])
  })
})

describe('trips on a shared device', () => {
  it('resuming a trip never closes another account\'s open trip, nor touches one it cannot see', async () => {
    await beginUserSession('user-a')
    const aTrip = await startTrip('A walk', 'here')
    await endUserSession()
    await beginUserSession('user-b')
    const bOld = await startTrip('B old', 'there')
    await endTrip(bOld.id)
    const bOther = await startTrip('B open', 'there')

    await resumeTrip(aTrip.id) // not B's: ignored
    expect((await db.trips.get(aTrip.id))!.endedAt).toBeUndefined()
    expect((await activeTrip())!.id).toBe(bOther.id)

    await resumeTrip(bOld.id)
    expect((await db.trips.get(bOther.id))!.endedAt).toEqual(expect.any(Number))
    expect((await db.trips.get(aTrip.id))!.endedAt).toBeUndefined() // A's open trip untouched
    await endTrip(aTrip.id)
    expect((await db.trips.get(aTrip.id))!.endedAt).toBeUndefined() // and B cannot end it
  })
})

describe('one date everywhere', () => {
  it('the life list carries the observation offset so its date matches the sightings day header', async () => {
    // 23:30 local time at UTC+7 is 16:30 UTC; a reader in UTC+8 or later would see the 13th if the device zone were used.
    const at = Date.UTC(2026, 2, 12, 16, 30)
    await db.sightings.put({
      id: 's1', installId: 'i', count: 1, at, tzOffsetMinutes: 420, clockConfidence: 'trusted', notes: '',
      speciesId: 'sp-1', packId: 'pack-a', speciesSnapshot: { sciName: 'X y', commonName: 'X', sensitivity: 0 },
      syncState: 'local', clientVersion: 1, updatedAt: at,
    })
    const [entry] = await buildLifeList()
    expect(entry!.firstSeenOffset).toBe(420)
    const shown = formatObservedDate(entry!.firstSeen, entry!.firstSeenOffset)
    // Same value the day header produces for the record (offset applied once, formatted in UTC).
    expect(shown).toBe(new Intl.DateTimeFormat('en', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(at + 420 * 60_000))
    expect(shown).toContain('12') // observed on the 12th, whatever zone the reader is in now
  })
})
