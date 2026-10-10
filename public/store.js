/* The games kept on this device, every kind, each under its own id.

   A game gets its id the moment it starts, signed in or out, and its
   address carries it — /cribbage/?g=<id> — so a link to a game opens that
   game, and any number of games of a kind can be in progress at once.

     SCStore.put(type, state, done)  keep a game; done once it is finished
     SCStore.get(id)                 { id, type, done, at, state }, or null
     SCStore.remove(id)
     SCStore.list(type?)             newest first
     SCStore.latest(type, match?)    the newest game in progress of a kind
     SCStore.urlId()                 { id, fresh } from ?g=<id>, or from
                                     ?resume=<id>, where fresh means the
                                     profile's copy is wanted over this
                                     device's — it was played on since
     SCStore.show(id, hash?)         put a game's id in the address
     SCStore.leave(hash?)            take it out again
     SCStore.open(type, id, fresh)   a game's state: from this device, or
                                     from the profile when signed in
     SCStore.notice(text)            a passing note at the top of the page

   Each game used to keep one game in progress under a key of its own;
   those move in here the first time any page loads this file. A finished
   game is kept a few days, so a link to it still opens it, then let go. */

window.SCStore = (function () {
  const PREFIX = 'sc-game:';
  const KEEP_DONE = 3 * 24 * 3600e3;

  const read = (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } };
  const write = (k, v) => {
    try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); }
    catch (e) { /* private mode, or full: the game carries on in memory */ }
  };
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID()
    : 'g' + Date.now().toString(36) + Math.random().toString(36).slice(2));

  function all() {
    const out = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k || !k.startsWith(PREFIX)) continue;
        const g = read(k);
        if (g && g.state && g.type) out.push(g);
      }
    } catch (e) { /* storage unavailable */ }
    return out.sort((a, b) => b.at - a.at);
  }

  function put(type, state, done) {
    if (!state || !state.id) return;
    write(PREFIX + state.id, { id: state.id, type, done: !!done, at: Date.now(), state });
  }

  /* ---------------- moving the old one-a-kind keys in ---------------- */
  (function migrate() {
    const legacy = [
      ['dart-tracker-v1', 'darts', (s) => s.over],
      ['cribbage-v1', 'cribbage', (s) => s.over],
      ['yahtzee-v1', 'yahtzee', (s) => s.over],
      ['magic-v1', 'magic', (s) => s.won],
      ['builder-v1', 'builder', (s) => s.endedAt],
    ];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith('builder-game-v1:')) legacy.push([k, 'builder', (s) => s.endedAt]);
      }
    } catch (e) { return; }
    for (const [key, type, isDone] of legacy) {
      const s = read(key);
      if (s && typeof s === 'object') {
        // games from before ids get one now, kept with them from here on
        if (!s.id) { s.id = uuid(); s.startedAt = s.startedAt || Date.now(); }
        if (!read(PREFIX + s.id)) put(type, s, !!isDone(s));
      }
      write(key, null);
    }
    // finished games are let go after a few days
    const now = Date.now();
    for (const g of all()) if (g.done && now - g.at > KEEP_DONE) write(PREFIX + g.id, null);
  })();

  function notice(text) {
    const n = document.createElement('div');
    n.textContent = text;
    n.setAttribute('role', 'status');
    n.style.cssText = 'position:fixed;left:50%;top:12px;transform:translateX(-50%);z-index:50;' +
      'max-width:calc(100vw - 24px);padding:10px 14px;border-radius:10px;font-size:14px;line-height:1.35;' +
      'background:var(--card,#1d2530);color:var(--txt,#eee);border:1px solid var(--gold,#c9a35a);' +
      'box-shadow:0 8px 20px var(--shadow,#0008);text-align:center';
    document.body.appendChild(n);
    setTimeout(() => n.remove(), 4500);
  }

  return {
    put,
    get: (id) => (id ? read(PREFIX + id) : null),
    remove: (id) => { if (id) write(PREFIX + id, null); },
    list: (type) => all().filter((g) => !type || g.type === type),
    latest: (type, match) => all().find((g) => g.type === type && !g.done && (!match || match(g.state))) || null,

    urlId() {
      const q = new URLSearchParams(location.search);
      if (q.get('g')) return { id: q.get('g'), fresh: false };
      if (q.get('resume')) return { id: q.get('resume'), fresh: true };
      return null;
    },
    show(id, hash) {
      history.replaceState(null, '', location.pathname + '?g=' + encodeURIComponent(id) + (hash || ''));
    },
    leave(hash) {
      history.replaceState(null, '', location.pathname + (hash || ''));
    },

    // fetch: how to get the game from the profile, when it isn't the usual
    // state (darts rebuilds older games from their turns)
    async open(type, id, fresh, fetch) {
      const here = read(PREFIX + id);
      const local = here && here.type === type ? here.state : null;
      if (local && !fresh) return local;
      if (window.SCCloud) {
        try {
          const st = fetch ? await fetch(id) : await (async () => {
            const g = await SCCloud.load(id);
            return g && g.game_type === type ? g.state : null;
          })();
          if (st) { put(type, st, false); return st; }
        } catch (e) { /* offline, signed out, or not on the profile */ }
      }
      return local;
    },

    notice,
  };
})();
