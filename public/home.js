/* The home page's live parts:
   - Pick up where you left off: every game left in progress on this device,
     read from each game's own saved state, and — signed in — every game in
     progress on the profile, which is where one played on another device
     shows up. Newest first; each
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

  const list = (xs) => xs.join(' · ');
  const many = (n) => ['', 'One player', 'Two players', 'Three players', 'Four players', 'Five players', 'Six players'][n] || `${n} players`;

  /* ---------------- games in progress ----------------

     Every game on this device is kept by id (see /store.js), each kind in its
     own shape; these turn each one into a line worth reading. A finished game is not in progress.
     The profile keeps the same shape (see /cloud.js), so a game saved there
     is read the same way. */

  // room: which look the card takes — 'parlor' chalk, 'living' legal pad, 'workshop' graph paper
  const SPEC = {
    darts: { room: 'parlor', name: 'Darts',
      line: (g) => (g.over ? null : list(g.players.map((p) => `${p.name} ${p.score}`))) },
    cribbage: { room: 'living', name: 'Cribbage',
      line: (g) => (g.over ? null : list([...g.names.map((n, i) => `${n} ${g.scores[i]}`), `hand ${g.hand}`])) },
    yahtzee: { room: 'living', name: 'Yahtzee',
      line: (g) => (g.over ? null : `${many(g.names.length)} · ${g.names[g.cur]}'s turn`) },
    magic: { room: 'living', name: 'Magic',
      line: (g) => (g.won ? null : `${g.format === 'commander' ? 'Commander' : 'Constructed'} · ${list(g.names.map((n, i) => `${n} ${g.life[i]}`))}`) },
    // a builder game takes its own room, as chosen on its setup screen
    builder: {
      room: (g) => themeOf(g.cfg),   // see /builder/rules.js
      name: (g) => (g.cfg && g.cfg.name) || 'Builder game',
      line: (g) => (g.endedAt ? null : list(g.cfg.names.map((n, i) => `${n} ${g.scores[i]}`))) },
  };

  // A game's own address: its page, and its id. Magic shows its table at #play.
  const gameHref = (type, id, param) =>
    `/${type}/?${param || 'g'}=${encodeURIComponent(id)}${type === 'magic' ? '#play' : ''}`;

  const found = [];
  // the ids of games saved unfinished to the profile: discarding one of
  // those, from this device or another, deletes the saved copy too
  const saved = new Set();
  const pick = (v, g) => (typeof v === 'function' ? v(g) : v);
  const moves = (g) => (g && Array.isArray(g.log) ? g.log.length : 0);

  // Every game on this device, any number of each kind (see /store.js).
  function local() {
    for (const k of SCStore.list()) {
      const G = SPEC[k.type], g = k.state;
      if (!G || k.done) continue;
      let line = null;
      try { line = G.line(g); } catch (e) { /* an older shape: skip it rather than break the page */ }
      if (!line) continue;
      found.push({ id: k.id, local: true, href: gameHref(k.type, k.id), room: pick(G.room, g), name: pick(G.name, g), line, at: k.at || g.startedAt || 0, n: moves(g) });
    }
  }

  /* Games in progress on the profile. One played on this device is already
     in the list above — unless it has been played on since somewhere else,
     when the profile's is the newer and takes its place: opening it from
     there brings this device up to date. */
  function fromProfile(games) {
    for (const g of games) {
      saved.add(g.id);
      const G = SPEC[g.game_type];
      if (!G) continue;
      const here = found.findIndex((f) => f.id === g.id);
      if (here >= 0 && !(g.state && moves(g.state) > found[here].n)) continue;
      let line = null;
      if (g.state) {
        try { line = G.line(g.state); } catch (e) { /* an older shape */ }
      } else if (g.game_type === 'darts') {
        // saved before games kept their state: what the list knows
        const turns = g.turn_count === 1 ? '1 turn' : `${g.turn_count} turns`;
        line = list([(g.players || []).map((p) => p.name).join(' vs '), turns, 'saved']);
      }
      if (!line) continue;
      const card = {
        local: here >= 0,
        room: pick(G.room, g.state || {}), name: pick(G.name, g.state || {}), id: g.id,
        // from the profile, as it is newer than any copy here
        href: gameHref(g.game_type, g.id, 'resume'),
        line, at: g.updated_at || g.started_at || 0,
      };
      if (here >= 0) found[here] = card; else found.push(card);
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
    SCStore.remove(f.id);
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
      getJSON('/api/games?state=unfinished&limit=20')
        .then((data) => { if (data) { fromProfile(data.games || []); showResume(); } })
        .catch(() => {});
      return getJSON('/api/custom-games').then((data) => { if (data) mine(data.games || []); });
    })
    .catch(() => { /* offline or signed out: the note stays */ });
})();
