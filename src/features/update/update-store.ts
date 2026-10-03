/**
 * Shared update state between the service-worker registration (main.tsx) and
 * the banner. A tiny external store so neither needs the other's module graph.
 */
import { useSyncExternalStore } from 'react'
import { isUpdateRequired } from './client-version'

interface UpdateState {
  /** The server's minClientVersion is above this build. */
  required: boolean
  /** A newer service worker is installed and waiting. */
  waiting: boolean
}

let state: UpdateState = { required: false, waiting: false }
let activate: ((reload?: boolean) => Promise<void>) | null = null
const listeners = new Set<() => void>()

function set(next: Partial<UpdateState>): void {
  const merged = { ...state, ...next }
  if (merged.required === state.required && merged.waiting === state.waiting) return
  state = merged
  listeners.forEach((l) => l())
}

export const getUpdateState = (): UpdateState => state
export const useUpdateState = (): UpdateState =>
  useSyncExternalStore((cb) => { listeners.add(cb); return () => { listeners.delete(cb) } }, getUpdateState)

/** Called by main.tsx with the function vite-plugin-pwa's registerSW returned. */
export function registerUpdater(fn: (reload?: boolean) => Promise<void>): void {
  activate = fn
}

export const markWaiting = (): void => set({ waiting: true })

/** Check the server; only ever raises the flag, a later failed check cannot clear it. */
export async function checkUpdateRequired(fetchFn?: typeof fetch): Promise<void> {
  if (await isUpdateRequired(fetchFn)) set({ required: true })
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Apply the update through the same service-worker path as the regular prompt.
 * If no new worker is waiting yet, ask the registration to look for one; when
 * none turns up, fall back to a reload, which revalidates the shell (sw.js is
 * served no-cache).
 */
export async function applyUpdate(): Promise<void> {
  if (!state.waiting) {
    try {
      const reg = await navigator.serviceWorker?.getRegistration()
      await reg?.update()
    } catch { /* offline: the reload below is harmless */ }
    for (let i = 0; i < 20 && !state.waiting; i++) await sleep(150)
  }
  if (state.waiting && activate) {
    await activate(true)
    return
  }
  window.location.reload()
}

/** Test seam. */
export function resetUpdateState(): void {
  state = { required: false, waiting: false }
  activate = null
  listeners.forEach((l) => l())
}
