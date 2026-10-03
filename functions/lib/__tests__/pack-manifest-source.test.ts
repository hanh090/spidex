import { describe, expect, it } from 'vitest'
import { manifestVersion, overrideIsLive } from '../pack-manifest-source'

describe('manifestVersion', () => {
  it('reads a numeric version and nothing else', () => {
    expect(manifestVersion('{"version":7}')).toBe(7)
    expect(manifestVersion('{"version":"7"}')).toBeNull()
    expect(manifestVersion('{}')).toBeNull()
    expect(manifestVersion('not json')).toBeNull()
    expect(manifestVersion('null')).toBeNull()
    expect(manifestVersion(null)).toBeNull()
  })
})

describe('overrideIsLive', () => {
  it('wins only while strictly above the deployed version', () => {
    expect(overrideIsLive(7, 6)).toBe(true)
    expect(overrideIsLive(7, 7)).toBe(false)
    expect(overrideIsLive(7, 8)).toBe(false)
  })
  it('is never live without an override, and live over an unreadable deployed manifest', () => {
    expect(overrideIsLive(null, 6)).toBe(false)
    expect(overrideIsLive(null, null)).toBe(false)
    expect(overrideIsLive(3, null)).toBe(true)
  })
})
