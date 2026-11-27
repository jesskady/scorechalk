/* Edit game: what may still change about a game once it has started, in a
   sheet of its own over the game rather than on the score screen, which
   has no room to spare and shouldn't be changed by a stray tap.

     SCEditGame.open({ names, locked, fixed, hint, labels, warn })
         resolves { order, names } on Save, or null on Cancel.
         names   the players, in the order of play
         locked  a sentence saying why the game can't be edited now (a
                 shared game, whose other phones know the players by their
                 place), or nothing; locked, the sheet only says so
         fixed   a sentence saying why the order can't change, now or in
                 this game (Bridge's seats are its partnerships); the names
                 can still be changed
         hint    what moving a player does in this game, after the line
                 on how to: who keeps the turn, or the deal
         labels  what each place is called, if not its number (Bridge's
                 seats: N, E, S, W)
         warn    warn(order, names): something to say before the new order
                 is saved (see skipWarning), or null; said, Save asks again
                 and Go back returns to the list as it was left
         order   for each place in the new order, the place that player
                 had before: [2, 0, 1] puts the third player first
         names   the players' names in the new order, any renamed

     SCEditGame.moves(order)
         for the page applying it: list(a) puts an array kept per player
         in the new order, and place(p) says where player p went (anything
         not a player's place, such as null, comes back as it was)

     SCEditGame.nextTurn(from, counts, playing)
         whose turn follows player from's: { next, skipped }. counts is how
         many turns each player has had, playing(i) whether player i is
         still in. See below.

     SCEditGame.skipNote(names, skipped, next)
         the line a game shows when nextTurn passed over anyone

     SCEditGame.skipWarning({ names, counts, cur, playing })
         for warn: who a new order would pass over for the rest of this
         round, said aloud, or null when no one. Everything in the new
         order, cur whose turn it is.

   The game itself is changed by the page, once, on Save: each game knows
   what it keeps per player and has to move all of it together (every game
   has Edit: see editGame in each). For now the players are what can
   change; the next setting a game allows goes here as a section of its
   own. The list is the shared .roster, dragged by its grips (/roster.js,
   which a page using this loads too). */

window.SCEditGame = (function () {
  const el = (tag, css, text) => {
    const e = document.createElement(tag);
    if (css) e.className = css;
    if (text != null) e.textContent = text;
    return e;
  };

  function open({ names, locked, fixed, hint, labels, warn }) {
    return new Promise((resolve) => {
      const veil = el('div', 'overlay edit-game');
      const card = el('div', 'win-card');
      card.setAttribute('role', 'dialog');
      card.setAttribute('aria-modal', 'true');
      card.setAttribute('aria-label', 'Edit game');
      card.append(el('h2', null, 'Edit game'));
      veil.append(card);

      const close = (result) => {
        document.removeEventListener('keydown', onKey);
        veil.remove();
        resolve(result);
      };
      const onKey = (e) => { if (e.key === 'Escape') close(null); };
      document.addEventListener('keydown', onKey);
      veil.addEventListener('click', (e) => { if (e.target === veil) close(null); });

      if (locked) {
        card.append(el('p', null, locked));
        const ok = el('button', 'primary big', 'OK');
        ok.type = 'button';
        ok.onclick = () => close(null);
        card.append(ok);
        document.body.append(veil);
        ok.focus();
        return;
      }

      // the players as they will be: each row remembers the place it came from
      const rows = names.map((name, from) => ({ from, name }));
      card.append(el('p', 'edit-hint', fixed
        ? `${fixed} Tap a name to change it.`
        : `Drag a player by the grip to change the order of play, or tap a name to change it.${hint ? ' ' + hint : ''}`));
      const list = el('ol', 'roster edit-players');
      card.append(list);

      const draw = () => {
        list.innerHTML = '';
        rows.forEach((r, i) => {
          const li = el('li');
          const inp = el('input', 'roster-name');
          inp.type = 'text'; inp.maxLength = 14; inp.autocomplete = 'off';
          inp.value = r.name;
          inp.placeholder = names[r.from];
          inp.setAttribute('aria-label', `Player ${i + 1}'s name`);
          inp.addEventListener('input', () => { r.name = inp.value; });
          li.append(el('i', null, labels ? labels[i] : `${i + 1}.`), inp);
          if (!fixed && rows.length > 1) li.append(SCRoster.grip(`Move ${r.name.trim() || names[r.from]}`));
          list.append(li);
        });
      };
      SCRoster.sortable(list, (from, to) => { rows.splice(to, 0, rows.splice(from, 1)[0]); draw(); });
      draw();

      const save = el('button', 'primary big', 'Save');
      save.type = 'button';
      const cancel = el('button', 'ghost', 'Cancel');
      cancel.type = 'button';
      cancel.onclick = () => close(null);
      const editing = [card.querySelector('.edit-hint'), list, save, cancel];

      // A warning, when the game has one for this order: the list makes way
      // for it, and Save asks again. Go back brings the list back as it was.
      const ask = el('div', 'edit-warn');
      ask.hidden = true;
      const askText = el('p');
      const sure = el('button', 'primary big', 'Save');
      sure.type = 'button';
      const back = el('button', 'ghost', 'Go back');
      back.type = 'button';
      ask.append(askText, sure, back);
      const showing = (warned) => {
        ask.hidden = !warned;
        editing.forEach((x) => { x.hidden = warned; });
      };
      back.onclick = () => showing(false);

      // a name emptied keeps the one it had
      const result = () => ({ order: rows.map((r) => r.from), names: rows.map((r) => r.name.trim() || names[r.from]) });
      save.onclick = () => {
        const got = result();
        const said = warn && got.order.some((from, i) => from !== i) ? warn(got.order, got.names) : null;
        if (!said) { close(got); return; }
        askText.textContent = said;
        showing(true);
      };
      sure.onclick = () => close(result());
      card.append(save, cancel, ask);
      document.body.append(veil);
    });
  }

  function moves(order) {
    const at = [];
    order.forEach((from, i) => { at[from] = i; });
    return {
      list: (a) => (Array.isArray(a) ? order.map((from) => a[from]) : a),
      place: (p) => (Number.isInteger(p) && at[p] !== undefined ? at[p] : p),
    };
  }

  /* Turns, in a game taken in turns: the next goes to the next player down
     the list who has had the fewest, so a round always finishes before
     anyone plays again. In play as usual that is simply the next player;
     it matters once the order has changed part-way through a round, or a
     turn was taken out of order, when it passes over whoever has already
     played this round (skipped, for saying so). Once everyone still in is
     level, a new round starts at the top of the list, so a new order
     starts there too. */
  function nextTurn(from, counts, playing = () => true) {
    const n = counts.length;
    const live = counts.map((_, i) => i).filter((i) => playing(i));
    if (!live.length) return { next: from, skipped: [] };
    const fewest = Math.min(...live.map((i) => counts[i]));
    if (live.every((i) => counts[i] === fewest)) return { next: live[0], skipped: [] };
    const skipped = [];
    for (let k = 1; k <= n; k++) {
      const i = (from + k) % n;
      if (!playing(i)) continue;
      if (counts[i] === fewest) return { next: i, skipped };
      skipped.push(i);
    }
    return { next: from, skipped: [] };
  }

  const andList = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

  /* Whoever has already played this round and sits, in the new order,
     ahead of someone still to play would be passed over by nextTurn until
     the round is done. Said before Save, so it isn't a surprise. */
  function skipWarning({ names, counts, cur, playing = () => true }) {
    const n = counts.length;
    const live = counts.map((_, i) => i).filter((i) => playing(i));
    if (live.length < 2) return null;
    const fewest = Math.min(...live.map((i) => counts[i]));
    // round the table from whoever is on turn: the last still to play
    let last = 0;
    for (let k = 1; k < n; k++) {
      const i = (cur + k) % n;
      if (playing(i) && counts[i] === fewest) last = k;
    }
    const skipped = [];
    for (let k = 1; k < last; k++) {
      const i = (cur + k) % n;
      if (playing(i) && counts[i] > fewest) skipped.push(i);
    }
    if (!skipped.length) return null;
    // who follows whoever is on turn, once they have played
    const after = counts.slice();
    after[cur] += 1;
    const { next } = nextTurn(cur, after, playing);
    const who = andList(skipped.map((i) => names[i]));
    return `${who} ${skipped.length > 1 ? 'have' : 'has'} already played this round, so they’ll be skipped until it’s over: after ${names[cur]}, it’s ${names[next]}’s turn. The new order starts next round.`;
  }

  // Said in play, as the turn passes over someone (see nextTurn).
  const skipNote = (names, skipped, next) =>
    `${andList(skipped.map((i) => names[i]))} already played this round: ${names[next]}’s turn`;

  return { open, moves, nextTurn, skipWarning, skipNote };
})();
