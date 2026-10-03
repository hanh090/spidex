/**
 * GET /api/credits?limit=&beforeAt=&beforeId= — balance and a page of history.
 *
 * Read-only. The ledger is written only by the sync paths (signup grant on
 * first authenticated use, photo-sync metering); browsing, search, viewing and
 * export are never metered. Credits are recorded but not charged unless
 * CREDITS_ENFORCED is on, which the response reports so the UI can say so.
 */
import { readSession } from '../../lib/session'
import { json } from '../../lib/http'
import type { D1Like } from '../../lib/d1'
import {
  PHOTO_SYNC_COST, creditsEnforced, ensureSignupGrant, getBalance, getHistory, type HistoryCursor,
} from '../../lib/ledger'

interface Env {
  SESSION_SECRET?: string
  WORKOS_API_KEY?: string
  CREDITS_ENFORCED?: string
  DB?: D1Like
}

const PAGE_DEFAULT = 20
const PAGE_MAX = 100

export const onRequest = async (context: { request: Request; env: Env }) => {
  const { request, env } = context
  const url = new URL(request.url)
  if (url.pathname !== '/api/credits') return json({ error: 'Not found' }, 404)
  if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405)

  const session = await readSession(request, env as unknown as Record<string, unknown>)
  if (!session) return json({ error: 'Sign in required' }, 401)
  if (!env.DB) return json({ error: 'Credits are not configured on this deployment' }, 503)

  const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || PAGE_DEFAULT, 1), PAGE_MAX)
  const beforeAt = url.searchParams.get('beforeAt')
  const beforeId = url.searchParams.get('beforeId')
  let before: HistoryCursor | undefined
  if (beforeAt !== null || beforeId !== null) {
    const at = Number(beforeAt)
    if (!Number.isSafeInteger(at) || at < 0 || !beforeId || beforeId.length > 64) return json({ error: 'beforeAt (integer) and beforeId must be given together' }, 400)
    before = { createdAt: at, id: beforeId }
  }

  try {
    await ensureSignupGrant(env.DB, session.userId)
    const [balance, page] = await Promise.all([
      getBalance(env.DB, session.userId),
      getHistory(env.DB, session.userId, limit, before),
    ])
    return json({
      balance,
      enforced: creditsEnforced(env),
      photoSyncCost: PHOTO_SYNC_COST,
      history: page.rows.map((r) => ({
        id: r.id, delta: r.delta, reason: r.reason, refType: r.ref_type, refId: r.ref_id, createdAt: r.created_at,
      })),
      next: page.next,
    })
  } catch (err) {
    console.error('credits error', err)
    return json({ error: 'Credits error' }, 500)
  }
}
