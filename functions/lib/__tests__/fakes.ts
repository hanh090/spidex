/** Minimal in-memory stand-ins for R2 and D1 used by the Functions tests. */

export function fakeR2(initial: Record<string, string> = {}, pageSize = 2) {
  const store = new Map<string, string>(Object.entries(initial))
  /** Content type recorded by put(), keyed like the store. */
  const types = new Map<string, string | undefined>()
  return {
    store,
    types,
    async head(key: string) { return store.has(key) ? { key } : null },
    async get(key: string) {
      const v = store.get(key)
      return v === undefined ? null : { body: v, etag: 'e', text: async () => v, json: async () => JSON.parse(v) }
    },
    async put(key: string, body: unknown, opts?: { httpMetadata?: { contentType?: string } }) {
      store.set(key, typeof body === 'string' ? body : 'bin')
      types.set(key, opts?.httpMetadata?.contentType)
    },
    async delete(keys: string | string[]) { for (const k of Array.isArray(keys) ? keys : [keys]) store.delete(k) },
    async list({ prefix = '', cursor }: { prefix?: string; cursor?: string } = {}) {
      // Key-based cursor, like R2: stable while earlier pages are deleted.
      const all = [...store.keys()].filter((k) => k.startsWith(prefix) && (!cursor || k > cursor)).sort()
      const page = all.slice(0, pageSize)
      const truncated = all.length > pageSize
      return { objects: page.map((key) => ({ key })), truncated, cursor: truncated ? page[page.length - 1] : undefined }
    },
  }
}

type Handler = (sql: string, args: unknown[]) => unknown
/**
 * D1 stand-in: every statement is routed to `handler(sql, args)`, whose return
 * value is used for first()/all()/run() alike. Calls are recorded in `log`.
 */
export function fakeD1(handler: Handler) {
  const log: { sql: string; args: unknown[] }[] = []
  return {
    log,
    /** Runs each statement in order, like D1's batch. */
    async batch(stmts: { run(): Promise<unknown> }[]) {
      const out: unknown[] = []
      for (const s of stmts) out.push(await s.run())
      return out
    },
    prepare(sql: string) {
      const make = (args: unknown[]) => ({
        bind: (...a: unknown[]) => make(a),
        async first() { log.push({ sql, args }); return handler(sql, args) ?? null },
        async all() { log.push({ sql, args }); return { results: (handler(sql, args) as unknown[]) ?? [] } },
        async run() { log.push({ sql, args }); return (handler(sql, args) as object) ?? { meta: { changes: 1 } } },
      })
      return make([])
    },
  }
}

export const htmlFallback = () =>
  new Response('<!doctype html>', { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } })

/**
 * Stateful D1 + R2 for the sync and credits endpoints: real semantics for the
 * tenant predicate, client_version guard, seq cursor and ledger idempotency.
 */
export { createMemoryStore as fakeSyncStore } from '../memory-store'
