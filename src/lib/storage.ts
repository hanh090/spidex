/**
 * Storage durability.
 *
 * Eviction is per-origin: it takes IndexedDB and Cache Storage together, so
 * where data is stored protects nothing. Persistent mode is the only real
 * defence, and browsers grant it from engagement history with no prompt —
 * asking on a cold first paint is asking at the worst possible moment.
 *
 * So: ask after install, before the first pack download, and on every launch
 * until it is granted.
 */
export type PersistState = 'granted' | 'denied' | 'unsupported'

export async function persistedAlready(): Promise<boolean> {
  try { return (await navigator.storage?.persisted?.()) ?? false } catch { return false }
}

export async function requestPersist(): Promise<PersistState> {
  if (!navigator.storage?.persist) return 'unsupported'
  try {
    if (await persistedAlready()) return 'granted'
    // persist() can sit on an unanswered permission prompt forever in
    // automation and some embedded contexts — treat a hang as a refusal.
    const answer = await Promise.race([
      navigator.storage.persist(),
      new Promise<null>((res) => setTimeout(() => res(null), 10_000)),
    ])
    if (answer === null) return 'denied'
    return answer ? 'granted' : 'denied'
  } catch {
    return 'unsupported'
  }
}

export interface StorageEstimate { usage: number; quota: number }

/**
 * Rounded and padded on iOS — useful as a headroom signal before a large
 * download, never as a figure to show as fact.
 */
export async function estimate(): Promise<StorageEstimate | null> {
  try {
    const e = await navigator.storage?.estimate?.()
    if (!e || e.usage == null || e.quota == null) return null
    return { usage: e.usage, quota: e.quota }
  } catch {
    return null
  }
}

/** Ask at the engagement points, not on first paint. */
export function schedulePersistRequests(onResult: (s: PersistState) => void): void {
  void requestPersist().then(onResult)
  window.addEventListener('appinstalled', () => { void requestPersist().then(onResult) })
}
