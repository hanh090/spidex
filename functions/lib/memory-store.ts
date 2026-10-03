/**
 * In-memory D1 + R2 for the sync and credits endpoints.
 *
 * Used by the Functions tests and by `npm run dev` (server/auth/dev-auth-plugin).
 * It is NOT a SQL engine: it dispatches on the exact statement constants in
 * sync-sql.ts and re-implements each one's semantics, including the tenant
 * predicate and the client_version guard. Because the route code can only
 * reach the database through those constants, an unknown statement throws
 * instead of silently succeeding.
 */
import type { D1Like, D1Result, D1Statement, R2Like } from './d1'
import { L, Q } from './sync-sql'

interface SightingRow {
  id: string; user_id: string; payload: string; client_version: number
  server_seq: number; updated_at: number; deleted_at: number | null
}
interface PhotoRow {
  id: string; user_id: string; sighting_id: string; r2_key: string; width: number
  height: number; bytes: number; server_seq: number; created_at: number; deleted_at: number | null
}
interface LedgerRow {
  id: string; user_id: string; delta: number; reason: string; ref_type: string | null
  ref_id: string | null; idempotency_key: string; created_at: number
}

/** JSON-serialisable, so the dev server can persist it between restarts. */
export interface MemoryState {
  seq: Record<string, number>
  sightings: Record<string, SightingRow>
  photos: Record<string, PhotoRow>
  ledger: LedgerRow[]
  balances: Record<string, { balance: number; updated_at: number }>
  /** R2 objects, base64. */
  objects: Record<string, string>
}

export const emptyState = (): MemoryState => ({
  seq: {}, sightings: {}, photos: {}, ledger: [], balances: {}, objects: {},
})

type Exec = { rows?: unknown[]; changes: number }

export function createMemoryStore(initial?: MemoryState, onChange?: () => void) {
  const state: MemoryState = initial ?? emptyState()
  /** Every statement executed, for assertions such as "the ledger is never updated". */
  const log: { sql: string; args: unknown[] }[] = []

  const nextSeq = (uid: unknown): number => {
    const n = state.seq[String(uid)]
    if (n === undefined) throw new Error('NOT NULL constraint failed: server_seq')
    return n
  }

  function exec(sql: string, a: unknown[]): Exec {
    log.push({ sql, args: a })
    switch (sql) {
      case Q.bumpSeq: {
        const u = String(a[0])
        state.seq[u] = (state.seq[u] ?? 0) + 1
        return { changes: 1 }
      }
      case Q.upsertSighting: {
        const [id, uid, payload, ver, seqUid, now] = a as [string, string, string, number, string, number]
        const cur = state.sightings[id]
        if (cur && !(cur.user_id === uid && cur.client_version < ver)) return { changes: 0 }
        state.sightings[id] = {
          id, user_id: cur ? cur.user_id : uid, payload, client_version: ver,
          server_seq: nextSeq(seqUid), updated_at: now, deleted_at: null,
        }
        return { changes: 1 }
      }
      case Q.getSighting:
        return { rows: state.sightings[String(a[0])] ? [state.sightings[String(a[0])]] : [], changes: 0 }
      case Q.pullSightings: {
        const [uid, since, limit] = a as [string, number, number]
        const rows = Object.values(state.sightings)
          .filter((r) => r.user_id === uid && r.server_seq > since)
          .sort((x, y) => x.server_seq - y.server_seq)
          .slice(0, limit)
        return { rows, changes: 0 }
      }
      case Q.tombstoneSighting: {
        const [now, , seqUid, id, uid] = a as [number, number, string, string, string]
        const r = state.sightings[id]
        if (!r || r.user_id !== uid || r.deleted_at !== null) return { changes: 0 }
        r.deleted_at = now; r.updated_at = now; r.server_seq = nextSeq(seqUid)
        return { changes: 1 }
      }
      case Q.tombstonePhotosOfSighting: {
        const [now, seqUid, sightingId, uid] = a as [number, string, string, string]
        let n = 0
        for (const p of Object.values(state.photos)) {
          if (p.sighting_id === sightingId && p.user_id === uid && p.deleted_at === null) {
            p.deleted_at = now; p.server_seq = nextSeq(seqUid); n++
          }
        }
        return { changes: n }
      }
      case Q.liveKeysOfSighting: {
        const [sightingId, uid] = a as [string, string]
        return {
          rows: Object.values(state.photos)
            .filter((p) => p.sighting_id === sightingId && p.user_id === uid && p.deleted_at === null)
            .map((p) => ({ r2_key: p.r2_key })),
          changes: 0,
        }
      }
      case Q.getPhoto:
        return { rows: state.photos[String(a[0])] ? [state.photos[String(a[0])]] : [], changes: 0 }
      case Q.insertPhoto: {
        const [id, uid, sightingId, key, width, height, bytes, seqUid, now] =
          a as [string, string, string, string, number, number, number, string, number]
        if (state.photos[id]) return { changes: 0 }
        state.photos[id] = {
          id, user_id: uid, sighting_id: sightingId, r2_key: key, width, height, bytes,
          server_seq: nextSeq(seqUid), created_at: now, deleted_at: null,
        }
        return { changes: 1 }
      }
      case Q.pullPhotos: {
        const [uid, since, limit] = a as [string, number, number]
        const rows = Object.values(state.photos)
          .filter((r) => r.user_id === uid && r.server_seq > since)
          .sort((x, y) => x.server_seq - y.server_seq || (x.id < y.id ? -1 : 1))
          .slice(0, limit)
        return { rows, changes: 0 }
      }
      case Q.tombstonePhoto: {
        const [now, seqUid, id, uid] = a as [number, string, string, string]
        const p = state.photos[id]
        if (!p || p.user_id !== uid || p.deleted_at !== null) return { changes: 0 }
        p.deleted_at = now; p.server_seq = nextSeq(seqUid)
        return { changes: 1 }
      }
      case L.hasKey:
        return { rows: state.ledger.some((r) => r.idempotency_key === a[0]) ? [{ present: 1 }] : [], changes: 0 }
      case L.append: {
        const [id, uid, delta, reason, refType, refId, key, now] =
          a as [string, string, number, string, string | null, string | null, string, number]
        if (state.ledger.some((r) => r.idempotency_key === key)) return { changes: 0 }
        state.ledger.push({
          id, user_id: uid, delta, reason, ref_type: refType, ref_id: refId, idempotency_key: key, created_at: now,
        })
        return { changes: 1 }
      }
      case L.refreshBalance: {
        const [uid, , now] = a as [string, string, number]
        const balance = state.ledger.filter((r) => r.user_id === uid).reduce((s, r) => s + r.delta, 0)
        state.balances[uid] = { balance, updated_at: now }
        return { changes: 1 }
      }
      case L.balance: {
        const b = state.balances[String(a[0])]
        return { rows: b ? [{ balance: b.balance }] : [], changes: 0 }
      }
      case L.history: {
        const [uid, at, , id, limit] = a as [string, number, number, string, number]
        const rows = state.ledger
          .filter((r) => r.user_id === uid && (r.created_at < at || (r.created_at === at && r.id < id)))
          .sort((x, y) => y.created_at - x.created_at || (x.id < y.id ? 1 : -1))
          .slice(0, limit)
        return { rows, changes: 0 }
      }
      default:
        throw new Error(`memory-store: unsupported statement: ${sql.slice(0, 80)}`)
    }
  }

  const isWrite = (sql: string) => !/^\s*SELECT/i.test(sql)
  const settle = <T>(sql: string, run: () => T): T => {
    const out = run()
    if (isWrite(sql)) onChange?.()
    return out
  }

  const statement = (sql: string, args: unknown[]): D1Statement => ({
    bind: (...next) => statement(sql, next),
    async first<T>() { return settle(sql, () => (exec(sql, args).rows?.[0] ?? null) as T | null) },
    async all<T>() { return settle(sql, () => ({ results: (exec(sql, args).rows ?? []) as T[] })) },
    async run() { return settle(sql, () => ({ meta: { changes: exec(sql, args).changes } })) },
  })

  /** Statements of a batch are not rolled back on failure here; the real D1 does. */
  const db: D1Like = {
    prepare: (sql) => statement(sql, []),
    async batch(stmts: D1Statement[]) {
      const out: D1Result[] = []
      for (const s of stmts) out.push(await s.run())
      return out
    },
  }

  const r2: R2Like & { keys(): string[] } = {
    keys: () => Object.keys(state.objects),
    async get(key) {
      const b64 = state.objects[key]
      return b64 === undefined ? null : { body: new Uint8Array(Buffer.from(b64, 'base64')) }
    },
    async put(key, body) {
      state.objects[key] = typeof body === 'string' ? Buffer.from(body).toString('base64') : Buffer.from(body).toString('base64')
      onChange?.()
    },
    async delete(keys) {
      for (const k of Array.isArray(keys) ? keys : [keys]) delete state.objects[k]
      onChange?.()
    },
  }

  return { db, r2, state, log }
}
