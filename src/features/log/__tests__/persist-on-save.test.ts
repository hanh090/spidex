import { afterEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../../data/db'
import { saveSighting } from '../sighting-repo'

afterEach(() => vi.unstubAllGlobals())

describe('storage persistence at the first sighting', () => {
  it('asks the browser for durable storage when a sighting is saved', async () => {
    const persist = vi.fn(async () => true)
    vi.stubGlobal('navigator', { onLine: true, storage: { persisted: async () => false, persist } })
    await db.sightings.clear()
    await saveSighting({ count: 1, notes: '', photos: [] })
    await vi.waitFor(() => expect(persist).toHaveBeenCalledTimes(1))
  })

  it('still saves when persistence is unsupported or throws', async () => {
    vi.stubGlobal('navigator', {
      onLine: true,
      storage: { persisted: async () => { throw new Error('nope') }, persist: async () => { throw new Error('nope') } },
    })
    const { id } = await saveSighting({ count: 1, notes: 'kept', photos: [] })
    expect((await db.sightings.get(id))?.notes).toBe('kept')
  })
})
