/* Saving darts games to a profile.
 *
 * Every turn is saved when signed in (autoSave in app.js), as is the Save
 * button, which says whether it worked. They go through /cloud.js, which
 * sends one save at a time; each carries the game's own state too, which is
 * what resuming it hands back.
 * Both send the whole game, so a failed save is retried rather than
 * reconciled, and the game id is chosen here so a retry is idempotent.
 *
 * localStorage remains the live state. Nothing here is on the critical path
 * of scoring a dart: if the network is down, the game carries on exactly as
 * it did before accounts existed.
 */

window.SCSync = (function () {
  /* One /api/me for the page however many scripts want it, whichever runs
     first — account.js and this file load in either order. */
  const me = () =>
    (window.SCMe ||
      (window.SCMe = fetch('/api/me', { headers: { accept: 'application/json' } })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null)));

  /* ---------------- payload ---------------- */

  /* S.log holds turns in the order they were played, so a player's turn
     number is simply how many of their own turns came before it. */
  function toPayload(S) {
    const counts = [];
    const turns = S.log.map((t, i) => {
      const n = counts[t.player] || 0;
      counts[t.player] = n + 1;
      return {
        player_idx: t.player,
        turn_no: n,
        // whatever the scoring event was made of; for darts, the throws
        detail: t.darts,
        points: t.bust ? 0 : t.pts,
        bust: !!t.bust,
        score_after: t.bust ? t.before : t.before - t.pts,
        created_at: S.startedAt + i,   // ordering only; the app records no clock per turn
      };
    });

    return {
      id: S.id,
      game_type: 'darts',
      config: {
        start: S.start,
        doubleIn: !!S.doubleIn,
        doubleOut: !!S.doubleOut,
        solo: S.players.length === 1,
      },
      started_at: S.startedAt,
      // chosen on the setup screen, not inferred from names
      me_idx: typeof S.meIdx === 'number' ? S.meIdx : 0,
      ended_at: S.over ? Date.now() : null,
      winner_idx: S.over && S.winner != null ? S.winner : null,
      players: S.players.map((p, idx) => ({ idx, name: p.name })),
      turns,
      state: S,
    };
  }

  /* ---------------- rebuilding a game from the server ---------------- */

  /* Turns carry score_after, so scores are read rather than recomputed. What
     has to be replayed is `opened` under the double-in rule, which depends on
     the order darts landed in — and the log, so Undo still works after a
     game is picked up on another device. */
  function rebuild(g) {
    const cfg = g.config || {};
    const S = {
      id: g.id,
      startedAt: g.started_at,
      players: g.players.map((p) => ({ name: p.name, score: cfg.start, points: 0, turns: 0, opened: !cfg.doubleIn })),
      start: cfg.start,
      doubleIn: !!cfg.doubleIn,
      doubleOut: !!cfg.doubleOut,
      cur: 0,
      darts: [],
      mult: 1,
      log: [],
      over: g.ended_at != null,
      // the choice made when the game was set up, not re-decided here
      meIdx: typeof g.me_idx === 'number' ? g.me_idx : 0,
      // it came from the profile, so every turn on it is already there
      savedTurns: g.turns.length,
    };
    if (g.winner_idx != null) S.winner = g.winner_idx;

    const open = S.players.map((p) => p.opened);

    for (const t of g.turns) {
      const p = S.players[t.player_idx];
      if (!p) continue;

      const wasOpen = open[t.player_idx];
      const thrown = t.detail || [];
      // mirrors breakdown(): the first double a player lands opens them
      if (!open[t.player_idx]) {
        for (const d of thrown) {
          if (d && d.dbl) { open[t.player_idx] = true; break; }
        }
      }

      const pts = t.bust ? 0 : t.points;
      S.log.push({
        player: t.player_idx,
        before: t.bust ? t.score_after : t.score_after + pts,
        wasOpen,
        pts,
        bust: !!t.bust,
        darts: thrown,
      });

      p.turns += 1;
      p.score = t.score_after;
      if (!t.bust) p.points += pts;
    }

    S.players.forEach((p, i) => { p.opened = open[i]; });

    // play goes round in order, so the first player with the fewest turns is up next
    const fewest = Math.min(...S.players.map((p) => p.turns));
    S.cur = S.players.findIndex((p) => p.turns === fewest);

    return S;
  }

  /* ---------------- public ---------------- */

  return {
    me,
    toPayload,
    rebuild,

    /* Called when a game is won. Silent on failure by design — the game is
       over and already safe in localStorage; an error toast here would just
       be noise at the moment someone has won. */
    async onGameOver(S) {
      const data = await me();
      if (!data || !data.user) return;
      try {
        if (await window.SCCloud.now(() => toPayload(S))) S.savedTurns = S.log.length;
      } catch (e) { /* the win is not lost, only unsynced */ }
    },

    /* Called by the Save button, where the user asked for this explicitly and
       so must be told whether it worked. */
    async saveNow(S) {
      if (!(await window.SCCloud.now(() => toPayload(S)))) throw new Error('not signed in');
      // records what the profile now holds, so the warnings before clearing
      // this game can tell the truth about what is at risk
      S.savedTurns = S.log.length;
    },

    async unfinished() {
      const res = await fetch('/api/games?state=unfinished&limit=10', { headers: { accept: 'application/json' } });
      if (!res.ok) return [];
      return (await res.json()).games || [];
    },

    async load(id) {
      const res = await fetch('/api/games/' + encodeURIComponent(id), { headers: { accept: 'application/json' } });
      if (!res.ok) throw new Error('could not load that game');
      const g = (await res.json()).game;
      // saved with its state: that is the game, exactly as it was left
      if (g.state && g.ended_at == null) return { ...g.state, savedTurns: g.turns.length };
      return rebuild(g);
    },
  };
})();
