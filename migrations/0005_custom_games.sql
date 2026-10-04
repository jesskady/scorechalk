-- Games a user has built with the ScoreChalk Builder and saved to their
-- profile: "My games".
--
-- These are rule sets, not plays — nothing here records a game being played.
-- The rules are JSON for the same reason games.config is: they are the
-- builder's knobs, and those will keep growing. The Worker whitelists the
-- fields it accepts, so the JSON only ever holds keys the builder knows.
--
-- The id is chosen by the client, as for games, so a retried save lands on
-- the same row.
CREATE TABLE custom_games (
  id            TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  rules         TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

-- Serves "my games", listed by name on the home page, builder and profile.
CREATE INDEX idx_custom_games_owner ON custom_games(owner_user_id, name);
