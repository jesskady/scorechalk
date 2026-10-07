/* The home page's live parts:
   - Pick up where you left off: every game left in progress on this device,
     read from each game's own saved state, and — signed in — darts games
     saved unfinished to the profile from another device. Newest first; each
     card dressed in its room's style, with an × to discard it. Hidden when
     there are none.
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
    { key: 'dart-tracker-v1', room: 'parlor', name: 'Darts', href: '/darts/#play',
      line: (g) => (g.over ? null : list(g.players.map((p) => `${p.name} ${p.score}`))) },
    { key: 'cribbage-v1', room: 'living', name: 'Cribbage', href: '/cribbage/#play',
      line: (g) => (g.over ? null : list([...g.names.map((n, i) => `${n} ${g.scores[i]}`), `hand ${g.hand}`])) },
    { key: 'yahtzee-v1', room: 'living', name: 'Yahtzee', href: '/yahtzee/#play',
      line: (g) => (g.over ? null : `${many(g.names.length)} · ${g.names[g.cur]}'s turn`) },
    { key: 'magic-v1', room: 'living', name: 'Magic', href: '/magic/#play',
      line: (g) => (g.won ? null : `${g.format === 'commander' ? 'Commander' : 'Constructed'} · ${list(g.names.map((n, i) => `${n} ${g.life[i]}`))}`) },
  ];

  /* Builder games, one in progress per game: 'builder-game-v1:<source>' —
     custom, a template's id, or 'my:<id>' — and 'builder-v1', the one game
     kept before each had its own. Each takes its own room, as chosen on its
     setup screen. */
  const playHash = (src) =>
    'play/' + (src === 'custom' ? 'custom' : src.startsWith('my:') ? 'my/' + src.slice(3) : src);
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key.startsWith('builder-game-v1:') && key !== 'builder-v1') continue;
    const src = key === 'builder-v1' ? null : key.slice('builder-game-v1:'.length);
    GAMES.push({
      key, href: (g) => '/builder/#' + playHash(src || (g.cfg && g.cfg.source) || 'custom'),
      room: (g) => themeOf(g.cfg),   // see /builder/rules.js
      name: (g) => (g.cfg && g.cfg.name) || 'Builder game',
      line: (g) => list(g.cfg.names.map((n, i) => `${n} ${g.scores[i]}`)),
    });
  }

  const found = [];
  // the ids of darts games saved unfinished to the profile: discarding one
  // of those, from this device or another, deletes the saved copy too
  const saved = new Set();

  function local() {
    for (const G of GAMES) {
      const g = read(G.key);
      if (!g) continue;
      let line = null;
      try { line = G.line(g); } catch (e) { /* an older shape: skip it rather than break the page */ }
      if (!line) continue;
      const pick = (v) => (typeof v === 'function' ? v(g) : v);
      found.push({ ...G, id: g.id, href: pick(G.href), room: pick(G.room), name: pick(G.name), line, at: g.startedAt || 0 });
    }
  }

  /* Darts games saved unfinished to the profile — from another device, as a
     rule, since the one on this device is already in the list above. The
     other games only reach the profile once they are finished. */
  function fromProfile(games) {
    for (const g of games) {
      if (g.game_type === 'darts') saved.add(g.id);
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
      const pin = el('div', 'rc-pin');
      const a = el('a', 'rc rc-' + f.room);
      a.href = f.href;
      a.append(el('b', null, f.name), el('span', null, f.line));
      a.title = `${f.name}: ${f.line}`;
      const x = el('button', 'rc-x', '×');
      x.type = 'button';
      x.setAttribute('aria-label', `Discard ${f.name}`);
      x.onclick = () => ask(pin, f);
      pin.append(a, x);
      row.append(pin);
    }
    $('resume').hidden = false;
  }

  // Asks on the card itself before a game is thrown away.
  function ask(pin, f) {
    if (pin.querySelector('.rc-ask')) return;
    const box = el('div', 'rc-ask');
    const yes = el('button', 'rc-yes', 'Discard');
    const no = el('button', 'rc-no', 'Keep');
    yes.type = no.type = 'button';
    box.append(el('p', null, saved.has(f.id) ? `Discard this game of ${f.name}? Its copy on your profile goes too.` : `Discard this game of ${f.name}?`), yes, no);
    no.onclick = () => box.remove();
    yes.onclick = () => discard(f);
    pin.append(box);
    no.focus();
  }

  function discard(f) {
    if (f.key) { try { localStorage.removeItem(f.key); } catch (e) { /* private mode */ } }
    if (f.id && saved.has(f.id)) {
      fetch('/api/games/' + encodeURIComponent(f.id), { method: 'DELETE' }).catch(() => {});
      saved.delete(f.id);
    }
    found.splice(found.indexOf(f), 1);
    showResume();
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
