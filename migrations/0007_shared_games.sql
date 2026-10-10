-- Sharing a game by link, signed in or not. A shared game is kept here
-- whole, under its own id, with two tokens: anyone holding the view token
-- can follow it, anyone holding the edit token can score in it. The tokens
-- are long and random, and are the only way in: neither is derived from the
-- game's id, which a viewer can see. version counts the writes, so two
-- phones scoring at once can't silently overwrite each other.
CREATE TABLE shared_games (
  id          TEXT PRIMARY KEY,
  game_type   TEXT NOT NULL,
  state       TEXT NOT NULL,
  version     INTEGER NOT NULL DEFAULT 1,
  view_token  TEXT NOT NULL UNIQUE,
  edit_token  TEXT NOT NULL UNIQUE,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
