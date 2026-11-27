/* Edit game: what may still change about a game once it has started, in a
   sheet of its own over the game rather than on the score screen, which
   has no room to spare and shouldn't be changed by a stray tap.

     SCEditGame.open({ names, locked, fixed, hint, labels })
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
         order   for each place in the new order, the place that player
                 had before: [2, 0, 1] puts the third player first
         names   the players' names in the new order, any renamed

     SCEditGame.moves(order)
         for the page applying it: list(a) puts an array kept per player
         in the new order, and place(p) says where player p went (anything
         not a player's place, such as null, comes back as it was)

   The game itself is changed by the page, once, on Save: each game knows
   what it keeps per player and has to move all of it together (every game
   has Edit: see editGame in each). For now the players are what can
   change; the next setting a game allows goes here as a section of its own. The list is the shared .roster, dragged
   by its grips (/roster.js, which a page using this loads too). */

window.SCEditGame = (function () {
  const el = (tag, css, text) => {
    const e = document.createElement(tag);
    if (css) e.className = css;
    if (text != null) e.textContent = text;
    return e;
  };

  function open({ names, locked, fixed, hint, labels }) {
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
      // a name emptied keeps the one it had
      save.onclick = () => close({ order: rows.map((r) => r.from), names: rows.map((r) => r.name.trim() || names[r.from]) });
      const cancel = el('button', 'ghost', 'Cancel');
      cancel.type = 'button';
      cancel.onclick = () => close(null);
      card.append(save, cancel);
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

  return { open, moves };
})();
