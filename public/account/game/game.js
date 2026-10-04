/* One game's statistics.
 *
 * Computed here rather than in SQL: /api/games/:id already returns every turn
 * for the board to be rebuilt from, so a second round trip to have the server
 * count the same rows would buy nothing. The profile's lifetime figures are
 * the opposite case and are aggregated in SQL.
 */

(function () {
  const box = document.getElementById('game');
  if (!box) return;

  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };

  const id = new URLSearchParams(location.search).get('id');

  function card(title, body) {
    const c = el('section', 'prof-card');
    c.append(el('h2', null, title), body);
    return c;
  }

  function tile(label, value, note) {
    if (value == null) return null;
    const t = el('div', 'stat');
    t.append(el('b', null, String(value)), el('span', null, label));
    if (note) t.append(el('small', null, note));
    return t;
  }

  /* One player's figures, from their turns alone. */
  function summarise(turns) {
    let points = 0, darts = 0, busts = 0, best = 0, n180 = 0, n140 = 0, n100 = 0, checkout = null;

    for (const t of turns) {
      points += t.points;
      darts += (t.detail || []).length;
      if (t.bust) busts += 1;
      if (t.points > best) best = t.points;
      if (t.points === 180) n180 += 1;
      if (t.points >= 140) n140 += 1;
      if (t.points >= 100) n100 += 1;
      if (t.score_after === 0) checkout = t.points;
    }

    return {
      turns: turns.length, points, darts, busts, best, n180, n140, n100, checkout,
      // points per dart scaled to a three-dart turn — the standard figure
      average: darts ? Math.round((points / darts) * 3 * 10) / 10 : null,
    };
  }

  function playerCard(name, s, isMe, won) {
    const head = el('div', 'pl-head');
    head.append(el('b', null, name));
    if (isMe) head.append(el('span', 'game-tag', 'You'));
    if (won) head.append(el('span', 'game-tag live', 'Won'));

    const grid = el('div', 'stat-grid');
    [
      tile('3-dart average', s.average),
      tile('Best turn', s.turns ? s.best : null),
      tile('Checkout', s.checkout),
      tile('Turns', s.turns),
      tile('Darts', s.darts),
      tile('180s', s.n180),
      tile('140+', s.n140),
      tile('100+', s.n100),
      tile('Busts', s.busts),
    ].filter(Boolean).forEach((t) => grid.append(t));

    const wrap = el('section', 'prof-card');
    wrap.append(head, grid);
    return wrap;
  }

  /* Turn by turn, newest last, the way the leg was actually played.

     Numbered by round rather than by position in this list: turn_no is each
     player's own count, so both players' entries in a round share a number,
     which is how a darts scoreboard is written. A solo game numbers 1, 2,
     3… either way. */
  function turnList(g, names) {
    const list = el('ol', 'turn-list');

    for (const t of g.turns) {
      const row = el('li', 'turn-row' + (t.bust ? ' is-bust' : ''));
      row.append(el('span', 'turn-no', String(t.turn_no + 1)));
      row.append(el('span', 'turn-who', names[t.player_idx] || '?'));
      row.append(el('span', 'turn-darts', (t.detail || []).map((d) => d.label).join(' ') || '—'));
      row.append(el('span', 'turn-pts', t.bust ? 'bust' : String(t.points)));
      row.append(el('span', 'turn-left', String(t.score_after)));
      list.append(row);
    }
    return list;
  }

  /* Correcting who the account holder was. The darts are a record of what
     happened and stay put; this only relabels whose statistics they land in,
     so the page re-renders from the server afterwards rather than guessing. */
  function whoCard(g, names, why) {
    const row = el('div', 'preset-row');

    names.forEach((name, i) => {
      const btn = el('button', 'seg' + (i === g.me_idx ? ' is-on' : ''), name);
      btn.type = 'button';
      btn.addEventListener('click', async () => {
        if (i === g.me_idx) return;
        [...row.children].forEach((b) => { b.disabled = true; });
        try {
          const res = await fetch('/api/games/' + encodeURIComponent(g.id), {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ me_idx: i }),
          });
          if (!res.ok) throw new Error();
          load();                       // stats are now someone else's; re-read
        } catch (e) {
          [...row.children].forEach((b) => { b.disabled = false; });
          note.textContent = 'Could not change that. Check your connection.';
        }
      });
      row.append(btn);
    });

    const wrap = el('section', 'prof-card');
    const note = el('p', 'prof-note', why || 'Statistics on this game count only this player’s darts.');
    wrap.append(el('h2', null, 'You were'), row, note);
    return wrap;
  }

  /* Two steps rather than a modal: the page has no confirm sheet of its own,
     and deleting a game is not something to do on a mis-tap. */
  function dangerCard(g) {
    const wrap = el('section', 'prof-card');
    wrap.append(el('h2', null, 'Delete'));

    const msg = el('p', 'prof-note', 'Removes this game and every turn in it. This cannot be undone.');
    const first = el('button', 'ghost danger-link', 'Delete this game');
    first.type = 'button';

    const confirmRow = el('div', 'confirm-row');
    confirmRow.hidden = true;
    const yes = el('button', 'danger big', 'Delete permanently');
    yes.type = 'button';
    const no = el('button', 'ghost', 'Cancel');
    no.type = 'button';
    confirmRow.append(yes, no);

    first.addEventListener('click', () => { first.hidden = true; confirmRow.hidden = false; });
    no.addEventListener('click', () => { confirmRow.hidden = true; first.hidden = false; });

    yes.addEventListener('click', async () => {
      yes.disabled = true;
      yes.textContent = 'Deleting…';
      try {
        const res = await fetch('/api/games/' + encodeURIComponent(g.id), { method: 'DELETE' });
        if (!res.ok) throw new Error();
        location.href = '/account/';
      } catch (e) {
        yes.disabled = false;
        yes.textContent = 'Delete permanently';
        msg.textContent = 'Could not delete that. Check your connection and try again.';
      }
    });

    wrap.append(msg, first, confirmRow);
    return wrap;
  }

  /* ---------- builder games ----------
     A builder game carries its rules with it (config.rules), copied when it
     was played, so this page shows the game as it was even if the game it
     came from has since been edited, renamed or deleted. Needs
     /builder/rules.js for describeRules. */

  const signed = (n) => (n > 0 ? '+' : n < 0 ? '−' : '') + Math.abs(n).toLocaleString();

  function showBuilder(g, names) {
    const cfg = g.config || {};
    const rules = { ...defaultRules(), ...(cfg.rules || {}) };

    const head = el('div', 'prof-head');
    const idBox = el('div', 'prof-id');
    idBox.append(el('h1', null, cfg.name || 'Custom game'));
    idBox.append(el('small', null, [
      names.join(' vs ') || 'Solo',
      new Date(g.ended_at || g.updated_at || g.started_at)
        .toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }),
    ].join(' · ')));
    head.append(idBox);

    // In the order played. The API sorts by each player's own turn count,
    // which in a game without turns is not the order anything happened in.
    const turns = g.turns.slice().sort((a, b) => a.created_at - b.created_at);

    // a player's score is their last turn's, or the start if they never scored
    const final = names.map((_, i) => {
      const mine = turns.filter((t) => t.player_idx === i);
      return mine.length ? mine[mine.length - 1].score_after : rules.start;
    });
    const order = names.map((_, i) => i)
      .sort((a, b) => (rules.win === 'low' ? final[a] - final[b] : final[b] - final[a]));

    const standings = el('ol', 'standings-list');
    for (const i of order) {
      const li = el('li', 'standing');
      const who = el('span', 'standing-who');
      who.append(el('b', null, names[i]));
      if (i === g.me_idx && names.length > 1) who.append(el('span', 'game-tag', 'You'));
      if (i === g.winner_idx) who.append(el('span', 'game-tag live', 'Won'));
      li.append(who, el('b', 'standing-score', final[i].toLocaleString()));
      standings.append(li);
    }

    const rulesBody = el('div');
    rulesBody.append(
      el('p', 'rules-played', describeRules(rules)),
      el('p', 'prof-note', 'As they were when this game was played.')
    );

    const list = el('ol', 'turn-list');
    for (const t of turns) {
      const row = el('li', 'turn-row builder-turn');
      row.append(el('span', 'turn-no', String(t.turn_no + 1)));
      row.append(el('span', 'turn-who', names[t.player_idx] || '?'));
      row.append(el('span', 'turn-pts', t.points === 0 ? '0' : signed(t.points)));
      row.append(el('span', 'turn-left', t.score_after.toLocaleString()));
      list.append(row);
    }

    const parts = [head, card('Final scores', standings), card('Rules', rulesBody)];
    if (names.length > 1) parts.push(whoCard(g, names, 'Marks which player was you.'));
    if (turns.length) parts.push(card('Every turn', list));
    parts.push(dangerCard(g));
    box.replaceChildren(...parts);
  }

  /* ---------- cribbage ----------
     Each turn's detail says what it was — play (pegging), heels, hand or
     crib — and which hand of the game, so the game is rebuilt hand by hand
     from the turns alone. The dealer is not stored per hand: it follows from
     the first dealer, since the deal passes left every hand. */

  function showCribbage(g, names) {
    const cfg = g.config || {};
    const n = names.length;
    const turns = g.turns.slice().sort((a, b) => a.created_at - b.created_at);
    const info = (t) => (t.detail && t.detail[0]) || {};

    const head = el('div', 'prof-head');
    const idBox = el('div', 'prof-id');
    idBox.append(el('h1', null, 'Cribbage'));
    idBox.append(el('small', null, [
      names.join(' vs '),
      new Date(g.ended_at || g.updated_at || g.started_at)
        .toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }),
    ].join(' · ')));
    head.append(idBox);

    const final = names.map((_, i) => {
      const mine = turns.filter((t) => t.player_idx === i);
      return mine.length ? Math.min(mine[mine.length - 1].score_after, 121) : 0;
    });
    const standings = el('ol', 'standings-list');
    for (const i of names.map((_, i) => i).sort((a, b) => final[b] - final[a])) {
      const li = el('li', 'standing');
      const who = el('span', 'standing-who');
      who.append(el('b', null, names[i]));
      if (i === g.me_idx) who.append(el('span', 'game-tag', 'You'));
      if (i === g.winner_idx) who.append(el('span', 'game-tag live', 'Won'));
      li.append(who, el('b', 'standing-score', String(final[i])));
      standings.append(li);
    }
    const finalBody = el('div');
    finalBody.append(standings);
    if (cfg.skunk) finalBody.append(el('p', 'prof-note skunk-note', cfg.skunk === 'double' ? 'Double skunk.' : 'Skunk.'));

    // per player: pegging, hands and crib across the game
    const kindOf = (t) => info(t).kind;
    const parts = [head, card('Final scores', finalBody)];
    names.forEach((name, i) => {
      const mine = turns.filter((t) => t.player_idx === i);
      const sum = (k) => mine.filter((t) => kindOf(t) === k).reduce((a, t) => a + t.points, 0);
      const hands = mine.filter((t) => kindOf(t) === 'hand');
      const cribs = mine.filter((t) => kindOf(t) === 'crib');
      const avg = (xs) => (xs.length ? Math.round((xs.reduce((a, t) => a + t.points, 0) / xs.length) * 10) / 10 : null);
      const grid = el('div', 'stat-grid');
      [
        tile('Pegging', sum('play') + sum('heels')),
        tile('Hands', sum('hand')),
        tile('Cribs', cribs.length ? sum('crib') : null),
        tile('Average hand', avg(hands)),
        tile('Best hand', hands.length ? Math.max(...hands.map((t) => t.points)) : null),
        tile('Average crib', avg(cribs)),
      ].filter(Boolean).forEach((t) => grid.append(t));
      const wrap = el('section', 'prof-card');
      const ph = el('div', 'pl-head');
      ph.append(el('b', null, name));
      if (i === g.me_idx) ph.append(el('span', 'game-tag', 'You'));
      if (i === g.winner_idx) ph.append(el('span', 'game-tag live', 'Won'));
      wrap.append(ph, grid);
      parts.push(wrap);
    });

    // hand by hand: what each player made of it
    const handNos = [...new Set(turns.map((t) => info(t).hand))].filter((h) => h != null);
    const table = el('div', 'crib-hands');
    const headRow = el('div', 'crib-row crib-head');
    headRow.style.gridTemplateColumns = `52px repeat(${n}, 1fr)`;
    headRow.append(el('span', null, 'Hand'));
    names.forEach((nm) => headRow.append(el('span', null, nm)));
    table.append(headRow);
    for (const h of handNos) {
      const dealer = ((cfg.firstDealer || 0) + h - 1) % n;
      const row = el('div', 'crib-row');
      row.style.gridTemplateColumns = `52px repeat(${n}, 1fr)`;
      row.append(el('span', 'crib-no', String(h)));
      names.forEach((_, i) => {
        const ts = turns.filter((t) => t.player_idx === i && info(t).hand === h);
        const pick = (...ks) => ts.filter((t) => ks.includes(kindOf(t))).reduce((a, t) => a + t.points, 0);
        const cell = el('span', 'crib-cell' + (i === dealer ? ' is-dealer' : ''));
        const bits = [];
        const peg = pick('play', 'heels');
        if (peg) bits.push(`peg ${peg}`);
        if (ts.some((t) => kindOf(t) === 'hand')) bits.push(`hand ${pick('hand')}`);
        if (ts.some((t) => kindOf(t) === 'crib')) bits.push(`crib ${pick('crib')}`);
        cell.append(el('b', null, String(ts.reduce((a, t) => a + t.points, 0))), el('small', null, bits.join(' · ') || '—'));
        row.append(cell);
      });
      table.append(row);
    }
    const handsBody = el('div');
    handsBody.append(table, el('p', 'prof-note', 'Highlighted: the dealer that hand.'));
    if (handNos.length) parts.push(card('Hand by hand', handsBody));

    parts.push(whoCard(g, names, 'Marks which player was you.'));
    parts.push(dangerCard(g));
    box.replaceChildren(...parts);
  }

  function show(g) {
    const names = (g.players || []).map((p) => p.name);
    if (g.game_type === 'builder') { showBuilder(g, names); return; }
    if (g.game_type === 'cribbage') { showCribbage(g, names); return; }
    const cfg = g.config || {};

    const head = el('div', 'prof-head');
    const idBox = el('div', 'prof-id');
    idBox.append(el('h1', null, names.join(' vs ') || 'Game'));

    const bits = [];
    if (cfg.start) bits.push(String(cfg.start));
    if (cfg.doubleIn) bits.push('double in');
    if (cfg.doubleOut) bits.push('double out');
    bits.push(new Date(g.ended_at || g.updated_at || g.started_at)
      .toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }));
    idBox.append(el('small', null, bits.join(' · ')));
    head.append(idBox);

    const parts = [head];
    names.forEach((name, i) => {
      const mine = g.turns.filter((t) => t.player_idx === i);
      parts.push(playerCard(name, summarise(mine), i === g.me_idx, g.winner_idx === i));
    });

    // an unfinished game is here to be managed, but picking it back up is
    // the likelier reason to have opened it
    if (!g.ended_at) {
      const resume = el('a', 'primary big resume-link', 'Resume this game');
      resume.href = `/${encodeURIComponent(g.game_type)}/?resume=${encodeURIComponent(g.id)}`;
      parts.push(resume);
    }

    if (names.length > 1) parts.push(whoCard(g, names));
    if (g.turns.length) parts.push(card('Every turn', turnList(g, names)));
    parts.push(dangerCard(g));
    box.replaceChildren(...parts);
  }

  if (!id) {
    box.replaceChildren(el('p', 'prof-empty', 'No game specified.'));
    return;
  }

  function load() {
    fetch('/api/games/' + encodeURIComponent(id), { headers: { accept: 'application/json' } })
      .then((r) => {
        if (r.status === 401) throw new Error('Sign in to see this game.');
        if (!r.ok) throw new Error('That game could not be found.');
        return r.json();
      })
      .then((data) => show(data.game))
      .catch((e) => {
        box.replaceChildren(el('p', 'prof-empty', e.message || 'Could not load that game.'));
      });
  }

  load();
})();
