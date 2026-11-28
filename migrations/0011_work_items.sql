-- The work board on /admin/#work (worker/work.js): everything there is to
-- do on the site, in one list. Some items are written by hand (a bug, an
-- idea); others come from the scheduled agents' ledgers in the repo
-- (qa/seo/ledger.md and the like), read from GitHub by the daily job or
-- the board's Sync button.
--
-- An agent's item keeps two statuses. `status` is the board's own, and the
-- one shown. `agent_status` is what the ledger last said, kept so a sync
-- can tell when the agent has changed its mind: only then does the agent's
-- word replace the board's. Otherwise a status set on the board stays put
-- however many times the same ledger is read again.
CREATE TABLE work_items (
  id           TEXT PRIMARY KEY,         -- 'SEO-012' from a ledger, 'W-001' by hand
  source       TEXT NOT NULL,            -- 'seo', 'playtest', ... or 'me'
  kind         TEXT NOT NULL,            -- 'seo', 'bug', 'improvement', 'idea', 'task'
  title        TEXT NOT NULL,
  detail       TEXT,                     -- the ledger's whole suggestion, or what was typed
  area         TEXT,
  impact       TEXT,                     -- 'High', 'Med', 'Low', or null
  effort       TEXT,                     -- 'S', 'M', 'L', or null
  status       TEXT NOT NULL,            -- 'new', 'todo', 'doing', 'done', 'dismissed'
  agent_status TEXT,                     -- the ledger's own word, as last read
  agent_notes  TEXT,                     -- the ledger's evidence column, as last read
  notes        TEXT,                     -- the owner's own notes, never touched by a sync
  first_seen   TEXT,                     -- the ledger's date, YYYY-MM-DD
  last_checked TEXT,                     -- the ledger's date, YYYY-MM-DD
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,
  done_at      INTEGER
);
CREATE INDEX idx_work_status ON work_items(status, updated_at DESC);

-- What happened to each item, newest last: made, a status changed (and by
-- whom: an admin's email, or the sync), notes edited. Only ever added to.
CREATE TABLE work_log (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id  TEXT NOT NULL,
  at       INTEGER NOT NULL,
  by       TEXT NOT NULL,                -- an admin's email, or 'sync: seo'
  change   TEXT NOT NULL                 -- in words: "To do → Done"
);
CREATE INDEX idx_work_log_item ON work_log(item_id, id);
