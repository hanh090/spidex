/**
 * Test environment.
 *
 * The stateful half of this app is Dexie, and a node environment has no
 * IndexedDB — so without this shim the suite can report green while every
 * save, delete, quota-recovery and integrity path is never executed.
 */
import 'fake-indexeddb/auto'

// Dexie and the app both use these; node provides neither.
if (!globalThis.crypto?.randomUUID) {
  const { webcrypto } = await import('node:crypto')
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true })
}

// The integrity check reads navigator.onLine; node 20 (CI) has no navigator.
if (!('navigator' in globalThis)) {
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: true } })
}

// `caches` is only touched by pack download and the integrity check; a minimal
// in-memory stand-in keeps those paths exercisable without a service worker.
if (!('caches' in globalThis)) {
  const stores = new Map<string, Map<string, Response>>()
  Object.defineProperty(globalThis, 'caches', {
    configurable: true,
    value: {
      async open(name: string) {
        const store = stores.get(name) ?? new Map<string, Response>()
        stores.set(name, store)
        return {
          async put(req: RequestInfo, res: Response) { store.set(String(typeof req === 'string' ? req : (req as Request).url), res) },
          async match(req: RequestInfo) { return store.get(String(typeof req === 'string' ? req : (req as Request).url)) },
          async keys() { return [...store.keys()].map((url) => new Request(url)) },
          async delete(req: RequestInfo) { return store.delete(String(typeof req === 'string' ? req : (req as Request).url)) },
        }
      },
    },
  })
}
