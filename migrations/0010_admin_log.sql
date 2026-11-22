-- What admins have done from /admin/ (worker/admin.js): every delete, who
-- did it, and what it was, written before the delete itself so the record
-- outlives the row. The admin is kept by email as well as id, and with no
-- foreign key, so the entry stays readable after that account is gone.
-- Only ever added to: nothing in the Worker updates or deletes it.
CREATE TABLE admin_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  at          INTEGER NOT NULL,
  admin_id    TEXT NOT NULL,
  admin_email TEXT,
  action      TEXT NOT NULL,             -- 'delete'
  target      TEXT NOT NULL,             -- the table: 'users', 'games', ...
  target_id   TEXT NOT NULL,
  summary     TEXT                       -- what it was, in words: "Ann (ann@x.com), 3 games"
);
CREATE INDEX idx_admin_log_at ON admin_log(at DESC);
