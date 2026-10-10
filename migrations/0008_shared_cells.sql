-- Scoring together by seat. In a game shared this way — the Builder and
-- Yahtzee, whose scores are a grid — each score is a cell of its own
-- (player × round, player × box), kept here with a version of its own, so
-- two phones only ever clash over the same cell. The game's own state in
-- shared_games is then just where it started: names, rules, and the cells
-- as they were when it was shared.
--
-- A third link joins the game: whoever opens it picks a seat — a player —
-- and is given a seat token that can score that player only. The edit
-- token stays with whoever shared the game, who can score anyone, and free
-- a seat.

ALTER TABLE shared_games ADD COLUMN mode TEXT NOT NULL DEFAULT 'state';   -- 'state' or 'cells'
ALTER TABLE shared_games ADD COLUMN join_token TEXT;
ALTER TABLE shared_games ADD COLUMN seq INTEGER NOT NULL DEFAULT 0;       -- counts cell writes
CREATE UNIQUE INDEX idx_shared_join ON shared_games(join_token);

CREATE TABLE shared_cells (
  game_id     TEXT NOT NULL REFERENCES shared_games(id) ON DELETE CASCADE,
  key         TEXT NOT NULL,             -- '<player>:<round or box>'
  value       TEXT,                      -- JSON; NULL once taken back
  version     INTEGER NOT NULL,
  seq         INTEGER NOT NULL,          -- when it last changed, in the game's count
  updated_at  INTEGER NOT NULL,
  PRIMARY KEY (game_id, key)
);
CREATE INDEX idx_shared_cells_seq ON shared_cells(game_id, seq);

CREATE TABLE shared_seats (
  game_id     TEXT NOT NULL REFERENCES shared_games(id) ON DELETE CASCADE,
  seat        INTEGER NOT NULL,          -- the player's index
  token       TEXT NOT NULL UNIQUE,
  claimed_at  INTEGER NOT NULL,
  PRIMARY KEY (game_id, seat)
);
