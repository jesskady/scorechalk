/* The home page's live parts:
   - Pick up where you left off: every game left in progress on this device,
     read from each game's own saved state, and — signed in — darts games
     saved unfinished to the profile from another device. Newest first; each
     card dressed in its room's style. Hidden when there are none.
   - My games: builder games saved to the profile, when signed in.
   Needs /builder/rules.js for defaultRules and describeRules. */

(function () {
  const $ = (id) => document.getElementById(id);

  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };

  const read = (key) => {
    try { return JSON.parse(localStorage.getItem(key)); } catch (e) { return null; }
  };

  const list = (xs) => xs.join(' · ');
  const many = (n) => ['', 'One player', 'Two players', 'Three players', 'Four players', 'Five players', 'Six players'][n] || `${n} players`;

  /* ---------------- games in progress ----------------

     Each game keeps its game under its own key, in its own shape; these turn
     each one into a line worth reading. A finished game is not in progress. */

  // room: which look the card takes — 'parlor' chalk, 'living' legal pad, 'workshop' graph paper
  const GAMES = [
    { key: 'dart-tracker-v1', room: 'parlor', name: 'Darts', href: '/darts/',
      line: (g) => (g.over ? null : list(g.players.map((p) => `${p.name} ${p.score}`))) },
    { key: 'cribbage-v1', room: 'living', name: 'Cribbage', href: '/cribbage/',
      line: (g) => (g.over ? null : list([...g.names.map((n, i) => `${n} ${g.scores[i]}`), `hand ${g.hand}`])) },
    { key: 'yahtzee-v1', room: 'living', name: 'Yahtzee', href: '/yahtzee/',
      line: (g) => (g.over ? null : `${many(g.names.length)} · ${g.names[g.cur]}'s turn`) },
    { key: 'magic-v1', room: 'living', name: 'Magic', href: '/magic/#play',
      line: (g) => (g.won ? null : `${g.format === 'commander' ? 'Commander' : 'Constructed'} · ${list(g.names.map((n, i) => `${n} ${g.life[i]}`))}`) },
    // a builder game takes its template's room — Farkle the living room,
    // Canasta the parlor — and anything built from scratch the workshop's
    { key: 'builder-v1', href: '/builder/#play',
      room: (g) => ({ farkle: 'living', canasta: 'parlor' })[g.cfg && g.cfg.source] || 'workshop',
      name: (g) => (g.cfg && g.cfg.name) || 'Builder game',
      line: (g) => list(g.cfg.names.map((n, i) => `${n} ${g.scores[i]}`)) },
  ];

  const found = [];

  function local() {
    for (const G of GAMES) {
      const g = read(G.key);
      if (!g) continue;
      let line = null;
      try { line = G.line(g); } catch (e) { /* an older shape: skip it rather than break the page */ }
      if (!line) continue;
      const pick = (v) => (typeof v === 'function' ? v(g) : v);
      found.push({ ...G, id: g.id, room: pick(G.room), name: pick(G.name), line, at: g.startedAt || 0 });
    }
  }

  /* Darts games saved unfinished to the profile — from another device, as a
     rule, since the one on this device is already in the list above. The
     other games only reach the profile once they are finished. */
  function fromProfile(games) {
    for (const g of games) {
      if (g.game_type !== 'darts' || found.some((f) => f.id === g.id)) continue;
      const turns = g.turn_count === 1 ? '1 turn' : `${g.turn_count} turns`;
      found.push({
        room: 'parlor', name: 'Darts', id: g.id,
        href: '/darts/?resume=' + encodeURIComponent(g.id),
        line: list([(g.players || []).map((p) => p.name).join(' vs '), turns, 'saved']),
        at: g.updated_at || g.started_at || 0,
      });
    }
  }

  function showResume() {
    const row = $('resumeRow');
    row.innerHTML = '';
    if (!found.length) { $('resume').hidden = true; return; }
    found.sort((a, b) => b.at - a.at);
    for (const f of found) {
      const a = el('a', 'rc rc-' + f.room);
      a.href = f.href;
      a.append(el('b', null, f.name), el('span', null, f.line));
      a.title = `${f.name}: ${f.line}`;
      row.append(a);
    }
    $('resume').hidden = false;
  }

  /* ---------------- My games ---------------- */

  function mine(games) {
    const box = $('mineList');
    box.innerHTML = '';
    if (!games.length) {
      box.append(el('p', 'mine-note', 'Games you save from the Builder will be listed here.'));
      return;
    }
    for (const g of games) {
      const a = el('a');
      a.href = '/builder/#my/' + encodeURIComponent(g.id);
      const rules = { ...defaultRules(), ...g.rules };
      // the summary without the player count, which the row has no room for
      const sum = describeRules(rules).split(' · ').slice(1, 3).join(' · ');
      a.append(el('b', null, g.name), el('span', null, sum));
      box.append(a);
    }
  }

  const getJSON = (url) =>
    fetch(url, { headers: { accept: 'application/json' } }).then((r) => (r.ok ? r.json() : null));

  local();
  showResume();
  getJSON('/api/me')
    .then((me) => {
      if (!me || !me.user) return;
      getJSON('/api/games?state=unfinished&limit=10')
        .then((data) => { if (data) { fromProfile(data.games || []); showResume(); } })
        .catch(() => {});
      return getJSON('/api/custom-games').then((data) => { if (data) mine(data.games || []); });
    })
    .catch(() => { /* offline or signed out: the note stays */ });
})();
