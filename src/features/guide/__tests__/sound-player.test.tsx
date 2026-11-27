// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SoundList } from '../sound-player'
import '../../../i18n'
import type { SpeciesSound } from '../../../data/pack-manifest'

const sound = {
  id: 'xc1', url: 'https://xeno-canto.org/1/download', credit: 'Recordist',
  license: 'CC BY 4.0', type: 'call',
} as SpeciesSound

let root: Root
let host: HTMLDivElement

beforeEach(() => {
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true })
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('streamed bird recordings', () => {
  it('warns before playback that recordings require a connection', async () => {
    await act(async () => root.render(<SoundList sounds={[sound]} />))
    expect(host.textContent).toContain('Recordings require an internet connection')
    expect((host.querySelector('button[aria-label="Play"]') as HTMLButtonElement).disabled).toBe(false)
  })

  it('disables playback offline and explains why before any tap', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false })
    const audio = vi.spyOn(globalThis, 'Audio')
    await act(async () => root.render(<SoundList sounds={[sound]} />))
    expect(host.textContent).toContain('connect to listen')
    expect((host.querySelector('button[aria-label="Play"]') as HTMLButtonElement).disabled).toBe(true)
    expect(audio).not.toHaveBeenCalled()
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true })
  })

  it('shows a retry when a stream fails and starts a fresh request on retry', async () => {
    let created = 0
    class FakeAudio {
      duration = 0
      currentTime = 0
      error = null
      preload = ''
      constructor() { created++ }
      addEventListener() { /* playback event listeners are not needed here */ }
      pause() { /* no media element in this test */ }
      play() { return created === 1 ? Promise.reject(new TypeError('Failed to fetch')) : Promise.resolve() }
    }
    vi.stubGlobal('Audio', FakeAudio)
    await act(async () => root.render(<SoundList sounds={[sound]} />))
    await act(async () => (host.querySelector('button[aria-label="Play"]') as HTMLButtonElement).click())
    expect(host.textContent).toContain('Check your connection and retry')
    const retry = [...host.querySelectorAll('button')].find((button) => button.textContent === 'Retry')!
    await act(async () => retry.click())
    expect(created).toBe(2)
    expect(host.textContent).not.toContain('Check your connection and retry')
  })
})
