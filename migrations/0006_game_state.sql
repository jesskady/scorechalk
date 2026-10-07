-- Every game, not only darts, is now saved to the profile as it is played,
-- so that it can be picked up again on any device. Rebuilding a game from its
-- turns would take code of its own for each game; instead the game's own
-- state — the same object it keeps in the browser — is stored with it while
-- it is unfinished, and handed back whole to resume it. The turns are still
-- written as before, for history and statistics. NULL once a game ends.
ALTER TABLE games ADD COLUMN state TEXT;
