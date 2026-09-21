-- Admin resource store.
--
-- One generic table covers every resource kind the console manages:
--   kind = 'pack'      → publish flags for the public pack catalogue
--                        (row id IS the pack id; published=0 hides it from
--                        /packs/index.json)
--   kind = 'checklist' → source checklists under data/checklists/
--   kind = 'dataset'   → compiled datasets (voices, model comparisons…)
--   kind = 'audio'     → bird-voice collections per pack
--   kind = 'note'      → free-form ops notes
--
-- meta is JSON: licence, source URL, counts, whatever the kind needs.

CREATE TABLE IF NOT EXISTS admin_resources (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  meta TEXT NOT NULL DEFAULT '{}',
  published INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_admin_resources_kind ON admin_resources(kind, sort);

CREATE TABLE IF NOT EXISTS admin_audit (
  id TEXT PRIMARY KEY,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  detail TEXT,
  at INTEGER NOT NULL
);
