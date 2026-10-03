-- Sync store and credit ledger.
--
-- Every row is owned by exactly one user (user_id comes from the verified
-- session, never from a payload) and every write statement carries a
-- `user_id = ?` predicate, so a UUID alone grants no access to another
-- user's data.

-- Per-user monotonic cursor shared by sightings and photos. Pull pages on
-- server_seq, which is unique per user by construction.
CREATE TABLE IF NOT EXISTS sync_seq (
  user_id TEXT PRIMARY KEY,
  seq INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sightings (
  id TEXT PRIMARY KEY,                 -- client UUID, identity for life
  user_id TEXT NOT NULL,
  payload TEXT NOT NULL,               -- validated JSON, stripped of unknown keys
  client_version INTEGER NOT NULL,     -- conflict ordering key, owned by the client
  server_seq INTEGER NOT NULL,         -- pull cursor
  updated_at INTEGER NOT NULL,         -- server receive time, observability only
  deleted_at INTEGER                   -- tombstone
);
CREATE INDEX IF NOT EXISTS idx_sightings_user_seq ON sightings(user_id, server_seq);

CREATE TABLE IF NOT EXISTS photos (
  id TEXT PRIMARY KEY,                 -- client capture-time UUID
  user_id TEXT NOT NULL,
  sighting_id TEXT NOT NULL,
  r2_key TEXT NOT NULL,                -- user-photos/<user_id>/<id>.<ext>, never publicly served
  width INTEGER NOT NULL DEFAULT 0,
  height INTEGER NOT NULL DEFAULT 0,
  bytes INTEGER NOT NULL,
  server_seq INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_photos_user_seq ON photos(user_id, server_seq);
CREATE INDEX IF NOT EXISTS idx_photos_sighting ON photos(sighting_id, user_id);

-- Append-only. Corrections are compensating rows, never edits.
CREATE TABLE IF NOT EXISTS credit_ledger (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  delta INTEGER NOT NULL,
  reason TEXT NOT NULL,                -- signup_grant | photo_sync | ai_id | adjustment | founder_grant
  ref_type TEXT,
  ref_id TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_credit_ledger_user ON credit_ledger(user_id, created_at, id);

CREATE TRIGGER IF NOT EXISTS credit_ledger_no_update
BEFORE UPDATE ON credit_ledger
BEGIN
  SELECT RAISE(ABORT, 'credit_ledger is append-only');
END;

CREATE TRIGGER IF NOT EXISTS credit_ledger_no_delete
BEFORE DELETE ON credit_ledger
BEGIN
  SELECT RAISE(ABORT, 'credit_ledger is append-only');
END;

-- Balance cache. Rewritten from SUM(delta) in the same batch as every ledger
-- append, so it always equals the ledger sum.
CREATE TABLE IF NOT EXISTS credit_balance (
  user_id TEXT PRIMARY KEY,
  balance INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
