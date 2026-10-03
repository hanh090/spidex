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

/**
 * The "update required" banner is only worth showing when the update can
 * actually be applied. If the server's minimum is raised above what is
 * deployed, no newer worker exists, and a banner whose button cannot change
 * anything would be stuck on screen for good.
 */
export const showRequiredBanner = (s: UpdateState = state): boolean => s.required && s.waiting

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Ask the registration to look for a newer worker and give it a moment to install. */
async function probeForWaitingWorker(): Promise<void> {
  if (state.waiting) return
  try {
    const reg = await navigator.serviceWorker?.getRegistration()
    await reg?.update()
  } catch { /* offline: nothing to probe */ }
  for (let i = 0; i < 20 && !state.waiting; i++) await sleep(150)
}

/**
 * Check the server; only ever raises the flag, a later failed check cannot
 * clear it. When the minimum is above this build, also look for the update
 * that would satisfy it: the banner shows once that worker is waiting.
 */
export async function checkUpdateRequired(fetchFn?: typeof fetch): Promise<void> {
  if (!(await isUpdateRequired(fetchFn))) return
  set({ required: true })
  await probeForWaitingWorker()
}

/**
 * Apply the update through the same service-worker path as the regular prompt.
 * If no new worker is waiting yet, ask the registration to look for one. When
 * none turns up there is nothing to apply: a plain reload would not activate
 * anything (a waiting worker survives reloads), so it is not attempted.
 */
export async function applyUpdate(): Promise<void> {
  await probeForWaitingWorker()
  if (state.waiting && activate) await activate(true)
}

/** Test seam. */
export function resetUpdateState(): void {
  state = { required: false, waiting: false }
  activate = null
  listeners.forEach((l) => l())
}
