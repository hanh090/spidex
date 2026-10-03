/**
 * Credits client. The balance is mirrored into Dexie (`ledgerCache`) so S15
 * can show the last known balance offline; history is only shown online.
 */
import { db } from '../../data/db'

export interface CreditEntry {
  id: string
  delta: number
  reason: string
  refType: string | null
  refId: string | null
  createdAt: number
}

export interface CreditsPage {
  balance: number
  enforced: boolean
  photoSyncCost: number
  history: CreditEntry[]
  next: { createdAt: number; id: string } | null
}

const CACHE_ID = 'balance'

export async function fetchCredits(
  before?: { createdAt: number; id: string },
  fetchFn: (input: string, init?: RequestInit) => Promise<Response> = (i, init) => fetch(i, init),
): Promise<CreditsPage> {
  const q = new URLSearchParams({ limit: '20' })
  if (before) { q.set('beforeAt', String(before.createdAt)); q.set('beforeId', before.id) }
  const res = await fetchFn(`/api/credits?${q}`, { headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const page = (await res.json()) as CreditsPage
  if (!before) await db.ledgerCache.put({ id: CACHE_ID, balance: page.balance, updatedAt: Date.now() })
  return page
}

export async function cachedBalance(): Promise<{ balance: number; updatedAt: number } | null> {
  const row = await db.ledgerCache.get(CACHE_ID)
  return row ? { balance: row.balance, updatedAt: row.updatedAt } : null
}
