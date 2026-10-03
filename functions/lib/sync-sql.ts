/**
 * Every statement the sync and credits endpoints run, in one place.
 *
 * Keeping them as constants (a) makes the tenant predicate auditable by
 * reading one file, and (b) lets the in-memory D1 used by tests and `npm run
 * dev` dispatch on the exact statement text, so the fake cannot silently
 * drift from what production executes.
 *
 * Rules the statements follow:
 *  - every write to sightings/photos has `user_id = ?` in its predicate;
 *  - server_seq comes from sync_seq, bumped in the same batch;
 *  - nothing ever UPDATEs or DELETEs credit_ledger.
 */

const NEXT_SEQ = '(SELECT seq FROM sync_seq WHERE user_id = ?)'

export const Q = {
  /** args: [userId] */
  bumpSeq:
    'INSERT INTO sync_seq (user_id, seq) VALUES (?, 1) ON CONFLICT(user_id) DO UPDATE SET seq = seq + 1',

  /**
   * args: [id, userId, payload, clientVersion, userId(seq), now]
   * The conflict branch only fires for the same owner AND a strictly newer
   * client_version; otherwise no row changes (changes = 0).
   */
  upsertSighting:
    `INSERT INTO sightings (id, user_id, payload, client_version, server_seq, updated_at, deleted_at)
     VALUES (?, ?, ?, ?, ${NEXT_SEQ}, ?, NULL)
     ON CONFLICT(id) DO UPDATE SET
       payload = excluded.payload, client_version = excluded.client_version,
       server_seq = excluded.server_seq, updated_at = excluded.updated_at, deleted_at = NULL
     WHERE sightings.user_id = excluded.user_id AND sightings.client_version < excluded.client_version`,

  /** args: [id] */
  getSighting:
    'SELECT id, user_id, payload, client_version, server_seq, deleted_at FROM sightings WHERE id = ?',

  /** args: [userId, since, limit] */
  pullSightings:
    `SELECT id, payload, client_version, server_seq, deleted_at FROM sightings
     WHERE user_id = ? AND server_seq > ? ORDER BY server_seq ASC LIMIT ?`,

  /** args: [now, now, userId(seq), id, userId] */
  tombstoneSighting:
    `UPDATE sightings SET deleted_at = ?, updated_at = ?, server_seq = ${NEXT_SEQ}
     WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,

  /** args: [now, userId(seq), sightingId, userId] */
  tombstonePhotosOfSighting:
    `UPDATE photos SET deleted_at = ?, server_seq = ${NEXT_SEQ}
     WHERE sighting_id = ? AND user_id = ? AND deleted_at IS NULL`,

  /** args: [sightingId, userId] */
  liveKeysOfSighting:
    'SELECT r2_key FROM photos WHERE sighting_id = ? AND user_id = ? AND deleted_at IS NULL',

  /** args: [id] */
  getPhoto:
    'SELECT id, user_id, sighting_id, r2_key, bytes, deleted_at FROM photos WHERE id = ?',

  /** args: [id, userId, sightingId, r2Key, width, height, bytes, userId(seq), now] */
  insertPhoto:
    `INSERT INTO photos (id, user_id, sighting_id, r2_key, width, height, bytes, server_seq, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ${NEXT_SEQ}, ?)
     ON CONFLICT(id) DO NOTHING`,

  /** args: [userId, since, limit] */
  pullPhotos:
    `SELECT id, sighting_id, width, height, bytes, created_at, server_seq, deleted_at FROM photos
     WHERE user_id = ? AND server_seq > ? ORDER BY server_seq ASC, id ASC LIMIT ?`,

  /** args: [now, userId(seq), id, userId] */
  tombstonePhoto:
    `UPDATE photos SET deleted_at = ?, server_seq = ${NEXT_SEQ}
     WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
} as const

export const L = {
  /** args: [idempotencyKey] */
  hasKey: 'SELECT 1 AS present FROM credit_ledger WHERE idempotency_key = ?',

  /** args: [id, userId, delta, reason, refType, refId, idempotencyKey, now] */
  append:
    `INSERT INTO credit_ledger (id, user_id, delta, reason, ref_type, ref_id, idempotency_key, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(idempotency_key) DO NOTHING`,

  /** args: [userId, userId, now]. Cache is derived from the ledger, never incremented. */
  refreshBalance:
    `INSERT INTO credit_balance (user_id, balance, updated_at)
     VALUES (?, (SELECT COALESCE(SUM(delta), 0) FROM credit_ledger WHERE user_id = ?), ?)
     ON CONFLICT(user_id) DO UPDATE SET balance = excluded.balance, updated_at = excluded.updated_at`,

  /** args: [userId] */
  balance: 'SELECT balance FROM credit_balance WHERE user_id = ?',

  /** args: [userId, beforeCreatedAt, beforeCreatedAt, beforeId, limit] */
  history:
    `SELECT id, delta, reason, ref_type, ref_id, created_at FROM credit_ledger
     WHERE user_id = ? AND (created_at < ? OR (created_at = ? AND id < ?))
     ORDER BY created_at DESC, id DESC LIMIT ?`,
} as const
