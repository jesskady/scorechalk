-- Errors, from the pages (scripts that failed in someone's browser, sent
-- by /report.js) and from the Worker itself. Nothing about the person: the
-- message, where it happened, the page, the browser. The same error from
-- the same place is one row, counted, so a common one can't fill the table;
-- rows unseen for 30 days are cleared by the daily job.
CREATE TABLE errors (
  key        TEXT PRIMARY KEY,           -- where it came from, the message, the place
  source     TEXT NOT NULL,              -- 'page' or 'worker'
  message    TEXT NOT NULL,
  place      TEXT,                       -- file:line:column, or the route
  stack      TEXT,
  page       TEXT,                       -- the path it last happened on
  agent      TEXT,                       -- the browser it last happened in
  count      INTEGER NOT NULL DEFAULT 1,
  first_seen INTEGER NOT NULL,
  last_seen  INTEGER NOT NULL
);
CREATE INDEX idx_errors_seen ON errors(last_seen DESC);
