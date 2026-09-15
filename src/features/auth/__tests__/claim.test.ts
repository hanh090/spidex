import { describe, it, expect, beforeEach } from 'vitest'
import { db, type Sighting } from '../../../data/db'
import { claimGuestSightings } from '../claim'

describe('claimGuestSightings', () => {
  beforeEach(async () => {
    await db.sightings.clear()
  })

  it('claims all sightings where userId is unset', async () => {
    const s1: Sighting = {
      id: 'sight-1',
      installId: 'inst-1',
      packId: 'pack-1',
      packVersion: 1,
      speciesSnapshot: { sciName: 'Bird', commonName: 'Bird', sensitivity: 0 },
      at: Date.now(),
      tzOffsetMinutes: 420,
      clockConfidence: 'trusted',
      count: 1,
      notes: '',
      updatedAt: Date.now(),
      syncState: 'local',
      clientVersion: 1,
    }

    const s2: Sighting = {
      ...s1,
      id: 'sight-2',
      userId: 'existing-user-123',
    }

    const s3: Sighting = {
      ...s1,
      id: 'sight-3',
    }

    await db.sightings.bulkAdd([s1, s2, s3])

    const claimed = await claimGuestSightings('new-user-456')
    expect(claimed).toBe(2)

    const updated1 = await db.sightings.get('sight-1')
    expect(updated1?.userId).toBe('new-user-456')

    // Existing user must NOT be overwritten (scoping protection)
    const updated2 = await db.sightings.get('sight-2')
    expect(updated2?.userId).toBe('existing-user-123')

    const updated3 = await db.sightings.get('sight-3')
    expect(updated3?.userId).toBe('new-user-456')
  })

  it('is idempotent when re-run', async () => {
    const s1: Sighting = {
      id: 'sight-1',
      installId: 'inst-1',
      packId: 'pack-1',
      packVersion: 1,
      speciesSnapshot: { sciName: 'Bird', commonName: 'Bird', sensitivity: 0 },
      at: Date.now(),
      tzOffsetMinutes: 420,
      clockConfidence: 'trusted',
      count: 1,
      notes: '',
      updatedAt: Date.now(),
      syncState: 'local',
      clientVersion: 1,
    }

    await db.sightings.add(s1)

    const firstClaim = await claimGuestSightings('user-789')
    expect(firstClaim).toBe(1)

    // Second run should find 0 unclaimed sightings
    const secondClaim = await claimGuestSightings('user-789')
    expect(secondClaim).toBe(0)
  })
})
