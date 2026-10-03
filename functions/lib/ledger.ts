/**
 * Append-only credit ledger.
 *
 * Metered, not enforced: entries are always recorded; nothing is blocked
 * unless CREDITS_ENFORCED is switched on (a product decision, default off).
 * Balance is SUM(delta); the credit_balance cache row is rewritten from that
 * sum in the same batch as every append, so the two cannot disagree.
 */
import type { D1Like, D1Statement } from './d1'
import { changes } from './d1'
import { L } from './sync-sql'

export const SIGNUP_GRANT = 10_000
export const PHOTO_SYNC_COST = 5

export type LedgerReason = 'signup_grant' | 'photo_sync' | 'ai_id' | 'adjustment' | 'founder_grant'

export interface LedgerEntry {
  userId: string
  delta: number
  reason: LedgerReason
  refType?: string
  refId?: string
  /** Unique across the whole ledger; a replay with the same key is a no-op. */
  idempotencyKey: string
  now?: number
}

export interface HistoryRow {
  id: string
  delta: number
  reason: string
  ref_type: string | null
  ref_id: string | null
  created_at: number
}

/** `true` only when the flag is explicitly on. Absent or anything else = off. */
export function creditsEnforced(env: { CREDITS_ENFORCED?: unknown }): boolean {
  const v = env.CREDITS_ENFORCED
  return v === true || v === '1' || (typeof v === 'string' && v.toLowerCase() === 'true')
}

/** The two statements that make up one ledger write. Run them in one batch. */
export function ledgerStatements(db: D1Like, e: LedgerEntry): [D1Statement, D1Statement] {
  const now = e.now ?? Date.now()
  return [
    db.prepare(L.append).bind(
      crypto.randomUUID(), e.userId, e.delta, e.reason, e.refType ?? null, e.refId ?? null, e.idempotencyKey, now,
    ),
    db.prepare(L.refreshBalance).bind(e.userId, e.userId, now),
  ]
}

/** Append one entry. `applied` is false when the idempotency key already existed. */
export async function record(db: D1Like, e: LedgerEntry): Promise<{ applied: boolean }> {
  const results = await db.batch(ledgerStatements(db, e))
  return { applied: changes(results[0]) > 0 }
}

export const signupKey = (userId: string) => `signup:${userId}`
export const photoKey = (photoId: string) => `photo:${photoId}`

/** Grants the signup credits exactly once per account, however many times it is called. */
export async function ensureSignupGrant(db: D1Like, userId: string): Promise<void> {
  const key = signupKey(userId)
  if (await db.prepare(L.hasKey).bind(key).first()) return
  await record(db, {
    userId, delta: SIGNUP_GRANT, reason: 'signup_grant', refType: 'user', refId: userId, idempotencyKey: key,
  })
}

export async function getBalance(db: D1Like, userId: string): Promise<number> {
  const row = await db.prepare(L.balance).bind(userId).first<{ balance: number }>()
  return row?.balance ?? 0
}

export interface HistoryCursor { createdAt: number; id: string }

export async function getHistory(
  db: D1Like, userId: string, limit: number, before?: HistoryCursor,
): Promise<{ rows: HistoryRow[]; next: HistoryCursor | null }> {
  const at = before?.createdAt ?? Number.MAX_SAFE_INTEGER
  const id = before?.id ?? '￿'
  const { results } = await db.prepare(L.history).bind(userId, at, at, id, limit + 1).all<HistoryRow>()
  const rows = results.slice(0, limit)
  const last = rows[rows.length - 1]
  return { rows, next: results.length > limit && last ? { createdAt: last.created_at, id: last.id } : null }
}
