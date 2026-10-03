import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { compareVersions, fetchMinClientVersion, isBelowMinimum, isUpdateRequired } from '../client-version'
import { applyUpdate, checkUpdateRequired, getUpdateState, markWaiting, registerUpdater, resetUpdateState, showRequiredBanner } from '../update-store'

const reply = (body: unknown, ok = true) => (async () => ({ ok, json: async () => body })) as unknown as typeof fetch

describe('version compare', () => {
  it('compares dotted numbers numerically', () => {
    expect(compareVersions('0.1.0', '0.1.0')).toBe(0)
    expect(compareVersions('0.1.0', '0.2.0')).toBeLessThan(0)
    expect(compareVersions('0.10.0', '0.9.0')).toBeGreaterThan(0)
    expect(compareVersions('1', '1.0.0')).toBe(0)
  })

  it('treats a missing minimum (0) as no minimum', () => {
    expect(isBelowMinimum('0.1.0', '0')).toBe(false)
  })

  it('never calls a malformed version outdated', () => {
    expect(isBelowMinimum('0.1.0', 'abc')).toBe(false)
    expect(isBelowMinimum('dev', '1.0.0')).toBe(false)
  })
})

describe('server check', () => {
  it('flags a client below minClientVersion', async () => {
    expect(await isUpdateRequired(reply({ minClientVersion: '0.2.0', apiVersion: 1 }), '0.1.0')).toBe(true)
    expect(await isUpdateRequired(reply({ minClientVersion: '0.1.0', apiVersion: 1 }), '0.1.0')).toBe(false)
  })

  it('treats offline, errors and junk bodies as unknown, not outdated', async () => {
    expect(await fetchMinClientVersion((async () => { throw new TypeError('offline') }) as unknown as typeof fetch)).toBeNull()
    expect(await fetchMinClientVersion(reply({}, false))).toBeNull()
    expect(await fetchMinClientVersion(reply({ minClientVersion: 5 }))).toBeNull()
    expect(await isUpdateRequired(reply({ minClientVersion: 'x' }), '0.0.1')).toBe(false)
  })
})

describe('update store', () => {
  beforeEach(() => resetUpdateState())
  afterEach(() => vi.unstubAllGlobals())

  it('raises the required flag and keeps it through a later failed check', async () => {
    vi.stubGlobal('navigator', { serviceWorker: undefined })
    markWaiting()
    await checkUpdateRequired(reply({ minClientVersion: '999.0.0' }))
    expect(getUpdateState().required).toBe(true)
    await checkUpdateRequired((async () => { throw new TypeError('offline') }) as unknown as typeof fetch)
    expect(getUpdateState().required).toBe(true)
  })

  it('applies through the registered service-worker updater when one is waiting', async () => {
    const activate = vi.fn(async () => {})
    registerUpdater(activate)
    markWaiting()
    await applyUpdate()
    expect(activate).toHaveBeenCalledWith(true)
  })

  it('does not reload when no new worker appears: a reload would not clear anything', async () => {
    vi.useFakeTimers()
    const reload = vi.fn()
    vi.stubGlobal('window', { location: { reload } })
    vi.stubGlobal('navigator', { serviceWorker: { getRegistration: async () => ({ update: async () => {} }) } })
    const done = applyUpdate()
    await vi.runAllTimersAsync()
    await done
    expect(reload).not.toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('hides the required banner when the minimum is above anything deployed (no worker ever waits)', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('navigator', { serviceWorker: { getRegistration: async () => ({ update: async () => {} }) } })
    const done = checkUpdateRequired(reply({ minClientVersion: '999.0.0' }))
    await vi.runAllTimersAsync()
    await done
    expect(getUpdateState().required).toBe(true)
    expect(showRequiredBanner()).toBe(false)
    vi.useRealTimers()
  })

  it('shows the required banner once the newer worker is waiting', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('navigator', { serviceWorker: { getRegistration: async () => ({ update: async () => { markWaiting() } }) } })
    const done = checkUpdateRequired(reply({ minClientVersion: '999.0.0' }))
    await vi.runAllTimersAsync()
    await done
    expect(showRequiredBanner()).toBe(true)
    vi.useRealTimers()
  })
})
