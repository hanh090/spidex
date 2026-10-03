-- Fixed-window attempt counters for credential endpoints (login, register).
-- key = '<action>:email:<sha256>' or '<action>:ip:<address>'; window = epoch
-- seconds at the start of the 15-minute window. Rows from past windows are
-- deleted whenever a new window opens, so the table stays small.
CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT NOT NULL,
  window INTEGER NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (key, window)
);
CREATE INDEX IF NOT EXISTS idx_rate_limits_window ON rate_limits(window);
