/* Darts games on the profile: what is darts' own about them.

   Saving works as in every game: save() in app.js keeps the game on this
   device and, signed in, on the profile, through /cloud.js. What stays here
   is opening one from the profile, and the setup's list of the ones still
   being played there:

     SCSync.me()          the signed-in user, from one /api/me for the page
     SCSync.unfinished()  darts games in progress on the profile
     SCSync.load(id)      a game from the profile, to play on: its own state
                          when it was saved with one, else rebuilt
     SCSync.rebuild(g)    a game saved before games kept their state, made
                          again from its turns

   localStorage remains the live game. Nothing here is on the way to scoring
   a dart: with no signal, the game carries on as it always has. */

window.SCSync = (function () {
  /* One /api/me for the page however many scripts want it, whichever runs
     first — account.js and this file load in either order. */
  const me = () =>
    (window.SCMe ||
      (window.SCMe = fetch('/api/me', { headers: { accept: 'application/json' } })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null)));

  /* A game saved with no state of its own: the turns as thrown, in order,
     each player's in turn. Everything else is worked out from them, as for
     any darts game (play() in app.js). The server says bust for every
     bust; keepMarkedBusts keeps it only on turns marked bust by hand. */
  function rebuild(g) {
    const cfg = g.config || {};
    const st = {
      id: g.id,
      startedAt: g.started_at,
      names: g.players.map((p) => p.name),
      me: typeof g.me_idx === 'number' ? g.me_idx : 0,
      start: cfg.start,
      doubleIn: !!cfg.doubleIn,
      doubleOut: !!cfg.doubleOut,
      cur: 0,
      log: g.turns.map((t) => ({ p: t.player_idx, darts: t.detail || [], ...(t.bust ? { bust: true } : {}) })),
      edits: [],
      darts: [],
      mult: 1,
      over: g.ended_at != null,
      winner: g.ended_at != null && g.winner_idx != null ? g.winner_idx : null,
    };
    keepMarkedBusts(st);
    // play goes round in order, so the first player with the fewest turns is up next
    const turns = play(st).players.map((p) => p.turns);
    st.cur = turns.indexOf(Math.min(...turns));
    return st;
  }

  async function unfinished() {
    const res = await fetch('/api/games?state=unfinished&limit=10', { headers: { accept: 'application/json' } });
    if (!res.ok) return [];
    return (await res.json()).games || [];
  }

  async function load(id) {
    const res = await fetch('/api/games/' + encodeURIComponent(id), { headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error('could not load that game');
    const g = (await res.json()).game;
    // saved with its state: that is the game, exactly as it was left
    if (g.state && g.ended_at == null) return upgrade(g.state);
    return rebuild(g);
  }

  return { me, unfinished, load, rebuild };
})();
