/* Sharing a game by link, signed in or not (see worker/share.js).

   Watching: the game is shown, not kept; every tap that would change it is
   stopped, and it is fetched again every few seconds.

   Scoring together comes in two kinds, chosen by the game:

   - Whole game (Darts, Cribbage, Magic). Each phone keeps the game like any
     other (see /store.js) and sends the whole of it on as it is saved;
     every few seconds each asks for anything newer. A change made on an old
     version is refused, and its phone takes the game as it now stands.

   - By seat (the Builder, Yahtzee), for a game whose scores are a grid.
     The game hands over `cells`: how to turn it into cells — one score
     each, keyed '<player>:<round or box>' — and how to build it back from
     them. Each phone sends only the cells it changed, each with the version
     it was changed from, so only two changes to the same cell clash. Each
     person who joins picks a seat, a player, and scores that player only;
     whoever shared the game can score anyone, and free a seat.

     SCShare.attach({ type, get, apply, cells?, seats?, names?, me?, rebase?, pollEvery? })
                            the page's game: get() the game on screen,
                            apply(state) shows a newer one; cells, for a
                            game shared by seat: { of(S) → { key: value },
                            build(S, list) → S, names(S) → [name] }, where
                            list is [{ key, value }] in the order they came;
                            seats, for a game shared whole that players
                            still join by seat (Cribbage), with names(S);
                            rebase(theirs, mine, base), for a game shared
                            whole: a refused change made again on the game
                            as it now stands, when that can be done safely
                            — or null, when the change has to give way;
                            pollEvery(), how often to look for news, in ms;
                            me(S), the player whoever set the game up said
                            they are, taken for them when it is shared
     SCShare.youAre(box, names, current, onPick)
                            the setup screens' "You are" row; lastMe() and
                            rememberMe(i) keep the choice for the next game
     SCShare.fromUrl(type)  a page opened with ?s=<token>: resolves
                            { kind: 'edit' | 'view', state }, or null
     SCShare.open()         the share sheet for the game on screen
     SCShare.seat()         the player this phone scores, or null for any:
                            a phone that joined, or whoever shared the game
                            once they have taken a player and chosen to
                            score only them
     SCShare.canScore(p)    whether this phone may score player p
     SCShare.changed(id)    from SCStore.put: send the game on
     SCShare.stop(editToken) stop sharing */

window.SCShare = (function () {
  const POLL = 3000;
  let page = null;          // { type, get, apply, cells? }
  let applying = false;     // a newer game is being shown: not a change to send on
  let watch = null;         // while watching: { token, mode, version | seq, base, known }
  const pending = {};       // game id → timer, a change about to be sent

  const api = (path, opts) => fetch('/api/share' + path, {
    headers: { 'content-type': 'application/json', accept: 'application/json' }, ...opts,
  });
  const linkFor = (type, token) =>
    `${location.origin}/${type}/?s=${encodeURIComponent(token)}${type === 'magic' ? '#play' : ''}`;
  const shareOf = (id) => { const g = SCStore.get(id); return g && g.share; };
  const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  const seatOfKey = (key) => Number(key.split(':')[0]);
  const onScreen = (id) => { const s = page && page.get(); return !!s && s.id === id; };
  const namesOf = (st) => (page.cells ? page.cells.names(st) : page.names(st));
  // the token this phone writes with: whoever shared the game's, or its seat's
  const writer = (sh) => sh && (sh.edit || sh.seatToken);

  function show(state) {
    if (!page || !state) return;
    applying = true;
    try { page.apply(state); } finally { applying = false; }
    renderSlots();
  }

  /* ---------------- whoever shared the game: all players, or theirs only ----------------

     On the game screen, for whoever shared the game once they have a player:
     score every player, or only their own, as everyone who joins does. The
     page puts an empty .sc-edit-slot where the switch belongs. */
  function renderSlots() {
    const slots = document.querySelectorAll('.sc-edit-slot');
    if (!slots.length || !page) return;
    const st = page.get(), sh = st && shareOf(st.id);
    const on = !!(sh && sh.owner && Number.isInteger(sh.seat) && !window.SCWatching);
    for (const slot of slots) {
      if (!on) { slot.style.display = 'none'; slot.dataset.key = ''; continue; }
      const name = namesOf(st)[sh.seat] || 'Player ' + (sh.seat + 1);
      const key = `${sh.seat}:${!!sh.restricted}:${name}`;
      slot.style.cssText = 'display:flex;justify-content:center;align-items:center;gap:8px;font-size:12px;color:var(--dim,#aaa)';
      if (slot.dataset.key === key) continue;
      slot.dataset.key = key;
      slot.replaceChildren(el('span', null, 'Scoring'));
      const seg = el('div', 'display:flex;border:1px solid var(--line,#444);border-radius:999px;overflow:hidden');
      [[false, 'All players'], [true, `Only ${name}`]].forEach(([restricted, label]) => {
        const lit = !!sh.restricted === restricted;
        const b = el('button', 'font-size:12px;font-weight:700;padding:5px 11px;border:none;cursor:pointer;' +
          (lit ? 'background:var(--green-d,#1f5e41);color:var(--on-primary,#fff)' : 'background:none;color:var(--dim,#aaa)'), label);
        b.type = 'button';
        b.onclick = () => {
          SCStore.setShare(st.id, { ...shareOf(st.id), restricted });
          show(page.get());
        };
        seg.append(b);
      });
      slot.append(seg);
    }
  }

  /* ---------------- the setup screens: who you are ---------------- */

  const ME_KEY = 'sc-me-v1';
  // the last choice, or the first player until there has been one
  function lastMe() {
    try {
      const raw = localStorage.getItem(ME_KEY);
      if (raw === null) return 0;
      const v = JSON.parse(raw);
      return v === null || Number.isInteger(v) ? v : 0;
    } catch (e) { return 0; }
  }
  function rememberMe(i) { try { localStorage.setItem(ME_KEY, JSON.stringify(i)); } catch (e) { /* private mode */ } }
  function youAre(box, names, current, onPick) {
    box.innerHTML = '';
    [...names.map((_, i) => i), null].forEach((i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'seg' + (i === current ? ' is-on' : '');
      b.textContent = i === null ? 'No one' : names[i];
      b.onclick = () => onPick(i);
      box.append(b);
    });
  }

  // Keep a newer game: shown when it is the one on screen, else just kept.
  function take(type, id, state) {
    if (onScreen(id)) show(state);
    else { applying = true; SCStore.put(type, state, false); applying = false; }
  }

  /* ---------------- cells: a game shared by seat ---------------- */

  // what is known of the shared cells: { key: { v, ver, seq } }
  const listOf = (known) => Object.entries(known)
    .filter(([, c]) => c.v !== null && c.v !== undefined)
    .sort((a, b) => a[1].seq - b[1].seq)
    .map(([key, c]) => ({ key, value: c.v }));

  function merge(known, cells) {
    let moved = false;
    for (const c of cells) {
      if (!known[c.key] || !same(known[c.key].v, c.value) || known[c.key].ver !== c.version) moved = true;
      known[c.key] = { v: c.value, ver: c.version, seq: c.seq };
    }
    return moved;
  }

  async function sendCells(id) {
    const g = SCStore.get(id), sh = g && g.share;
    if (!sh || !page || !page.cells || page.type !== g.type) return;
    const write = sh.owner ? sh.edit : sh.seatToken;
    if (!write) return;
    const now = page.cells.of(g.state), known = sh.known || {};
    const changes = [];
    for (const key of new Set([...Object.keys(now), ...Object.keys(known)])) {
      const was = known[key] ? known[key].v : null, is = now[key] ?? null;
      if (same(was, is)) continue;
      if (!sh.owner && seatOfKey(key) !== sh.seat) continue;    // only one's own player
      changes.push({ key, value: is, base: known[key] ? known[key].ver : 0 });
    }
    if (!changes.length) return;
    try {
      const res = await api('/' + encodeURIComponent(write) + '/cells', { method: 'PUT', body: JSON.stringify({ cells: changes }) });
      if (res.status === 404) { gone(id); return; }
      if (!res.ok) return;
      const data = await res.json();
      const sh2 = { ...shareOf(id) }, k2 = { ...(sh2.known || {}) };
      for (const a of data.applied) {
        const c = changes.find((x) => x.key === a.key);
        k2[a.key] = { v: c.value, ver: a.version, seq: a.seq };
      }
      merge(k2, data.conflicts);
      sh2.known = k2;
      SCStore.setShare(id, sh2);
      if (data.conflicts.length) {
        const g2 = SCStore.get(id);
        take(g2.type, id, page.cells.build(g2.state, listOf(k2)));
        SCStore.notice('Someone changed the same score at the same moment. Showing theirs.');
      }
    } catch (e) { /* offline: the next change sends what is still different */ }
  }

  async function pollCells(id, sh) {
    try {
      const res = await api('/' + encodeURIComponent(sh.owner ? sh.edit : sh.seatToken) + '?since=' + (sh.seq || 0));
      if (res.status === 404) { gone(id); return; }
      const data = await res.json();
      if (pending[id]) return;
      const sh2 = { ...shareOf(id) }, k2 = { ...(sh2.known || {}) };
      sh2.seats = data.seats;
      if (data.unchanged) { SCStore.setShare(id, sh2); return; }
      const moved = merge(k2, data.cells || []);
      sh2.known = k2;
      sh2.seq = data.seq;
      SCStore.setShare(id, sh2);
      if (moved) {
        const g = SCStore.get(id);
        take(g.type, id, page.cells.build(g.state, listOf(k2)));
      }
    } catch (e) { /* offline: try again next time */ }
  }

  /* ---------------- the whole game ---------------- */

  function changed(id) {
    if (applying) return;
    clearTimeout(pending[id]);
    pending[id] = setTimeout(() => {
      delete pending[id];
      const sh = shareOf(id);
      if (sh && sh.mode === 'cells') sendCells(id); else send(id);
    }, 600);
  }

  async function send(id) {
    const g = SCStore.get(id), sh = g && g.share;
    if (!writer(sh)) return;
    try {
      const res = await api('/' + encodeURIComponent(writer(sh)), {
        method: 'PUT', body: JSON.stringify({ state: g.state, base: sh.version || 1 }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) { SCStore.setShare(id, { ...shareOf(id), version: data.version, base: g.state }); return; }
      if (res.status === 409 && data.state) {
        // what this phone did, made again on the game as it now stands
        const merged = page && page.rebase && sh.base && onScreen(id) ? page.rebase(data.state, g.state, sh.base) : null;
        SCStore.setShare(id, { ...shareOf(id), version: data.version, base: data.state });
        if (merged) { take(g.type, id, merged); send(id); return; }
        take(g.type, id, data.state);
        SCStore.notice("Someone else changed the game at the same moment. Your last change didn't go in. Showing the latest scores.");
        return;
      }
      if (res.status === 404) gone(id);
    } catch (e) { /* offline: the next change sends the whole game again */ }
  }

  function gone(id) {
    SCStore.setShare(id, null);
    SCStore.notice('This game is no longer shared. It carries on here as your own.');
  }

  async function poll() {
    renderSlots();
    if (document.visibilityState !== 'visible' || !page) return;
    if (watch) { await pollWatch(); return; }
    const cur = page.get(), sh = cur && shareOf(cur.id);
    if (!sh || pending[cur.id]) return;
    if (sh.mode === 'cells') { if (page.cells) await pollCells(cur.id, sh); return; }
    if (!writer(sh)) return;
    try {
      const res = await api('/' + encodeURIComponent(writer(sh)) + '?since=' + (sh.version || 1));
      if (res.status === 404) { gone(cur.id); return; }
      const data = await res.json();
      if (data.unchanged || !data.state || pending[cur.id]) return;
      SCStore.setShare(cur.id, { ...shareOf(cur.id), version: data.version, base: data.state });
      show(data.state);
    } catch (e) { /* offline: try again next time */ }
  }
  // every few seconds — or as often as the game asks, as Cribbage does in the play
  (function tick() {
    poll().catch(() => {}).finally(() => setTimeout(tick, page && page.pollEvery ? page.pollEvery() : POLL));
  })();
  document.addEventListener('visibilitychange', poll);

  /* ---------------- watching ---------------- */

  // what a watcher has no use for, by game: the ways of entering a score
  const HIDE = {
    darts: '#dartsPad, #game .actions',
    cribbage: '#countBox, #game .actions, #playModeRow',
    yahtzee: '.topbtns',
    magic: '#hubBtn',
    builder: '#entry, #game .actions',
  };
  // what still works: leaving, the views, closing a result
  const ALLOW = 'a, #viewRow, .flipbtn, .sc-share-ui, #keepBtn, .backlink';

  function startWatching(type, w) {
    watch = w;
    window.SCWatching = true;
    const style = document.createElement('style');
    style.textContent = `${HIDE[type] || ''}{display:none !important}`;
    document.head.appendChild(style);
    const stop = (e) => {
      if (!window.SCWatching || e.target.closest(ALLOW)) return;
      e.preventDefault();
      e.stopPropagation();
    };
    for (const ev of ['click', 'pointerdown', 'keydown', 'input']) window.addEventListener(ev, stop, true);
    banner('● Watching live: the scores update by themselves');
  }

  async function pollWatch() {
    try {
      const since = watch.mode === 'cells' ? watch.seq : watch.version;
      const res = await api('/' + encodeURIComponent(watch.token) + '?since=' + since);
      if (res.status === 404) { watch = null; banner('This game is no longer shared.'); return; }
      const data = await res.json();
      if (data.unchanged) return;
      if (watch.mode === 'cells') {
        watch.seq = data.seq;
        if (merge(watch.known, data.cells || [])) show(page.cells.build(watch.base, listOf(watch.known)));
      } else if (data.state) {
        watch.version = data.version;
        show(data.state);
      }
    } catch (e) { /* offline: try again next time */ }
  }

  function banner(text) {
    let b = document.querySelector('.sc-watch');
    if (!b) {
      b = document.createElement('div');
      b.className = 'sc-watch sc-share-ui';
      b.style.cssText = 'position:fixed;left:50%;bottom:10px;transform:translateX(-50%);z-index:40;' +
        'max-width:calc(100vw - 24px);padding:7px 14px;border-radius:999px;font-size:12.5px;font-weight:600;' +
        'background:var(--card,#1d2530);color:var(--gold,#c9a35a);border:1px solid var(--line,#333);' +
        'box-shadow:0 6px 16px var(--shadow,#0008);white-space:nowrap;overflow:hidden;text-overflow:ellipsis';
      document.body.appendChild(b);
    }
    b.textContent = text;
  }

  /* ---------------- arriving by link ---------------- */

  async function fromUrl(type) {
    const t = new URLSearchParams(location.search).get('s');
    if (!t) return null;
    try {
      const res = await api('/' + encodeURIComponent(t));
      if (!res.ok) throw new Error();
      const data = await res.json();
      if (data.type !== type || !data.state) throw new Error();

      if (data.mode !== 'cells') {
        const watchWhole = (token) => {
          startWatching(type, { token, mode: 'state', version: data.version });
          return { kind: 'view', state: data.state };
        };
        if (data.kind === 'view') return watchWhole(t);
        const had = shareOf(data.state.id);
        let sh;
        if (data.kind === 'edit') sh = { edit: t, view: data.view, join: data.join, version: data.version, owner: !!(had || {}).owner };
        else {
          // by seat: a seat this phone already holds, or the one picked now
          if (had && had.seatToken) return { kind: 'edit', state: SCStore.get(data.state.id).state };
          let seat = data.seat, seatToken = t;
          if (data.kind === 'join') {
            const pick = await pickSeat(page.names(data.state), data.seats || [], t);
            if (!pick) { history.replaceState(null, '', location.pathname + '?s=' + encodeURIComponent(data.view) + location.hash); return watchWhole(data.view); }
            seat = pick.seat; seatToken = pick.token;
          }
          sh = { view: data.view, join: data.kind === 'join' ? t : undefined, seat, seatToken, version: data.version };
        }
        // scoring together: kept here like any other game, and sent on
        applying = true;
        SCStore.put(type, data.state, false);
        applying = false;
        SCStore.setShare(data.state.id, { ...sh, base: data.state });
        return { kind: 'edit', state: data.state };
      }

      // by seat
      if (!page || !page.cells) throw new Error();
      const known = {};
      merge(known, data.cells);
      const state = page.cells.build(data.state, listOf(known));
      const watchIt = () => {
        startWatching(type, { token: data.view || t, mode: 'cells', seq: data.seq, base: data.state, known });
        return { kind: 'view', state };
      };
      if (data.kind === 'view') return watchIt();

      // a seat this phone already holds in this game: straight back to it
      const had = shareOf(data.state.id);
      if (had && had.mode === 'cells' && (had.owner || had.seatToken)) {
        const g = SCStore.get(data.state.id);
        return { kind: 'edit', state: g.state };
      }

      let sh = { mode: 'cells', view: data.view, seq: data.seq, known, seats: data.seats };
      if (data.kind === 'edit') sh = { ...sh, owner: true, edit: t, join: data.join };
      else if (data.kind === 'seat') sh = { ...sh, seat: data.seat, seatToken: t };
      else {
        const pick = await pickSeat(page.cells.names(state), data.seats, t);
        if (!pick) { history.replaceState(null, '', location.pathname + '?s=' + encodeURIComponent(data.view) + location.hash); return watchIt(); }
        sh = { ...sh, seat: pick.seat, seatToken: pick.token, join: t };
      }
      applying = true;
      SCStore.put(type, state, false);
      applying = false;
      SCStore.setShare(state.id, sh);
      return { kind: 'edit', state: SCStore.get(state.id).state };
    } catch (e) {
      history.replaceState(null, '', location.pathname);
      SCStore.notice("That link doesn't open a game any more. It may have stopped being shared.");
      return null;
    }
  }

  /* ---------------- sheets ---------------- */

  function el(tag, css, text) {
    const n = document.createElement(tag);
    if (css) n.style.cssText = css;
    if (text != null) n.textContent = text;
    return n;
  }
  const BTN = 'flex:1;padding:10px 8px;border-radius:10px;font-size:14px;font-weight:700;' +
    'background:var(--bg2,#222);color:var(--txt,#eee);border:1px solid var(--line,#444);cursor:pointer';

  function sheet(titleText) {
    const veil = el('div', 'position:fixed;inset:0;z-index:60;background:var(--veil,#000c);display:flex;' +
      'align-items:center;justify-content:center;padding:18px');
    veil.className = 'sc-share-ui';
    const card = el('div', 'width:100%;max-width:380px;max-height:calc(100dvh - 36px);overflow:auto;' +
      'background:var(--card,#1d2530);color:var(--txt,#eee);border:1px solid var(--line,#444);border-radius:16px;' +
      'padding:18px;display:flex;flex-direction:column;gap:14px;font-family:inherit;box-shadow:0 14px 34px var(--shadow,#000c)');
    const body = el('div', 'display:flex;flex-direction:column;gap:14px', null);
    card.append(el('h2', 'margin:0;font-size:20px;color:var(--txt,#eee)', titleText), body);
    veil.append(card);
    document.body.append(veil);
    return { veil, card, body };
  }

  // Which player is this phone? Resolves { seat, token }, or null to watch.
  function pickSeat(names, taken, joinToken) {
    return new Promise((resolve) => {
      const { veil, body } = sheet('Which player are you?');
      body.append(el('p', 'margin:0;color:var(--dim,#aaa);font-size:14px;line-height:1.4',
        'You score your own player. Everyone sees every score as it goes in.'));
      const list = el('div', 'display:flex;flex-direction:column;gap:6px');
      const note = el('p', 'margin:0;color:var(--neg,#e2857a);font-size:13px;min-height:0');
      names.forEach((name, seat) => {
        const b = el('button', BTN + ';text-align:left', name);
        if (taken.includes(seat)) { b.disabled = true; b.style.opacity = '.45'; b.textContent = name + ' · taken'; }
        b.onclick = async () => {
          b.disabled = true;
          try {
            const res = await api('/' + encodeURIComponent(joinToken) + '/seat', { method: 'POST', body: JSON.stringify({ seat }) });
            if (res.status === 409) { b.textContent = name + ' · taken'; b.style.opacity = '.45'; note.textContent = 'Someone just took that player.'; return; }
            if (!res.ok) throw new Error();
            const data = await res.json();
            veil.remove();
            resolve({ seat, token: data.token });
          } catch (e) { b.disabled = false; note.textContent = "Couldn't join. Check your connection and try again."; }
        };
        list.append(b);
      });
      const watchBtn = el('button', 'background:none;border:none;color:var(--dim,#aaa);font-size:14px;font-weight:600;padding:6px;cursor:pointer', 'Just watch');
      watchBtn.onclick = () => { veil.remove(); resolve(null); };
      body.append(list, note, watchBtn);
    });
  }

  async function open() {
    const st = page && page.get();
    if (!st || !st.id) return;
    const { veil, card, body } = sheet('Share this game');
    body.append(el('p', 'margin:0;color:var(--dim,#aaa);font-size:14px', 'Making links…'));
    const done = el('button', BTN, 'Done');
    done.onclick = () => veil.remove();
    veil.onclick = (e) => { if (e.target === veil) veil.remove(); };
    card.append(done);

    let sh = shareOf(st.id);
    const seatPhone = sh && sh.mode === 'cells' && !sh.owner;
    if (!sh || (!sh.edit && !seatPhone)) {
      try {
        const cells = page.cells ? page.cells.of(st) : null;
        const res = await api('', { method: 'POST', body: JSON.stringify({
          id: st.id, type: page.type, state: st, ...(cells ? { mode: 'cells', cells } : {}), ...(page.seats ? { seats: true } : {}),
        }) });
        if (!res.ok) throw new Error();
        const data = await res.json();
        // the player whoever set the game up said they are: taken for them
        const me = page.me ? page.me(st) : null;
        let mySeat;
        if (data.join && Number.isInteger(me) && me >= 0 && me < namesOf(st).length) {
          try {
            const r = await api('/' + encodeURIComponent(data.edit) + '/seat', { method: 'POST', body: JSON.stringify({ seat: me }) });
            if (r.ok) mySeat = me;
          } catch (e) { /* offline: chosen in the sheet instead */ }
        }
        if (data.mode === 'cells') {
          const known = {};
          let seq = 0;
          for (const [key, v] of Object.entries(cells)) if (v !== null && v !== undefined) known[key] = { v, ver: 1, seq: ++seq };
          sh = { mode: 'cells', owner: true, edit: data.edit, view: data.view, join: data.join, seq: data.seq, known, seats: [] };
          if (mySeat !== undefined) sh.seat = mySeat;
        } else {
          sh = { view: data.view, edit: data.edit, join: data.join, version: data.version, owner: true, base: st };
          if (mySeat !== undefined) sh.seat = mySeat;
        }
        SCStore.setShare(st.id, sh);
        renderSlots();
      } catch (e) {
        body.replaceChildren(el('p', 'margin:0;color:var(--neg,#e2857a);font-size:14px',
          "Couldn't make the links. Check your connection and try again."));
        return;
      }
    }

    const row = (name, hint, url) => {
      const box = el('div', 'display:flex;flex-direction:column;gap:6px');
      box.append(el('b', 'font-size:15px', name), el('span', 'font-size:13px;color:var(--dim,#aaa);line-height:1.35', hint));
      const btns = el('div', 'display:flex;gap:6px');
      const copy = el('button', BTN, 'Copy link');
      copy.onclick = async () => {
        try { await navigator.clipboard.writeText(url); copy.textContent = 'Copied'; }
        catch (e) { window.prompt('Copy this link:', url); }
        setTimeout(() => { copy.textContent = 'Copy link'; }, 1600);
      };
      btns.append(copy);
      if (navigator.share) {
        const send = el('button', BTN, 'Send…');
        send.onclick = () => navigator.share({ title: 'Score Chalk', url }).catch(() => {});
        btns.append(send);
      }
      box.append(btns);
      return box;
    };
    const parts = [];
    if (sh.view) parts.push(row('Watch', 'Follow the scores live. Nothing can be changed from this link.', linkFor(page.type, sh.view)));
    if (sh.mode === 'cells' || sh.join) {
      if (sh.join) {
        parts.push(row('Join as a player',
          sh.owner ? 'Each person picks their player and scores only them, at any time. Your own player is taken for you.'
            : 'Each person picks their player and scores only them, at any time.',
          linkFor(page.type, sh.join)));
      }
      if (sh.owner) parts.push(await seatList(st, sh, () => { veil.remove(); open(); }));
    } else {
      parts.push(row('Keep score together', 'Enter and change scores from another phone. Share it only with people at the table.', linkFor(page.type, sh.edit)));
    }
    if (sh.owner) {
      const stopBtn = el('button', 'background:none;border:none;color:var(--neg,#e2857a);font-size:13.5px;font-weight:600;' +
        'padding:4px;cursor:pointer;align-self:center', 'Stop sharing');
      stopBtn.onclick = async () => {
        if (!window.confirm('Stop sharing? Every link to this game stops working. The game carries on here.')) return;
        await stop(sh.edit);
        SCStore.setShare(st.id, null);
        veil.remove();
        SCStore.notice('Stopped sharing. The game carries on here.');
      };
      parts.push(stopBtn);
    }
    body.replaceChildren(...parts);
  }

  /* For whoever shared the game: which player they are — taken for them,
     so no one else can join as that player — and whether they score only
     that player, as everyone who joins does, or everyone; and who has
     joined as whom, so a seat taken by mistake can be freed. */
  async function seatList(st, sh, reopen) {
    const box = el('div', 'display:flex;flex-direction:column;gap:14px');
    const edit = encodeURIComponent(sh.edit);
    let seats = sh.seats || [];
    try {
      const res = await api('/' + edit + '?since=' + (sh.mode === 'cells' ? (sh.seq || 0) : (sh.version || 1)));
      if (res.ok) seats = (await res.json()).seats || seats;
    } catch (e) { /* offline: what was last known */ }
    const names = namesOf(st);
    const mine = Number.isInteger(sh.seat) ? sh.seat : null;
    const HINT = 'font-size:13px;color:var(--dim,#aaa);line-height:1.35';
    const ON = ';border-color:var(--green,#2a7d56);box-shadow:0 0 0 1px var(--green,#2a7d56) inset';

    // the game on screen redrawn as this phone may now score it
    const refresh = () => { const s = page.get(); if (s) show(s); };

    const choose = async (to) => {
      if (to === mine) return;
      try {
        if (to !== null) {
          const res = await api('/' + edit + '/seat', { method: 'POST', body: JSON.stringify({ seat: to }) });
          if (res.status === 409) { SCStore.notice(`${names[to]} has already joined. Free them below first.`); return; }
          if (!res.ok) throw new Error();
        }
        if (mine !== null) await api('/' + edit + '/seat/' + mine, { method: 'DELETE' });
        const cur = { ...shareOf(st.id) };
        if (to === null) { delete cur.seat; cur.restricted = false; }
        else cur.seat = to;
        SCStore.setShare(st.id, cur);
        refresh();
        reopen();
      } catch (e) { SCStore.notice("Couldn't change that. Check your connection and try again."); }
    };

    const you = el('div', 'display:flex;flex-direction:column;gap:6px');
    you.append(el('b', 'font-size:15px', 'You are'),
      el('span', HINT, 'Your player is taken for you, so no one else can join as them. You can still score everyone; the switch on the game screen limits you to your own.'));
    const youRow = el('div', 'display:flex;flex-wrap:wrap;gap:6px');
    [...names.map((n, i) => i), null].forEach((seat) => {
      const taken = seat !== null && seats.includes(seat) && seat !== mine;
      const b = el('button', BTN + ';flex:1 1 40%' + (seat === mine ? ON : ''),
        seat === null ? 'No one' : (names[seat] || 'Player ' + (seat + 1)) + (taken ? ' · taken' : ''));
      if (taken) { b.disabled = true; b.style.opacity = '.45'; }
      b.onclick = () => choose(seat);
      youRow.append(b);
    });
    you.append(youRow);
    box.append(you);


    const joined = el('div', 'display:flex;flex-direction:column;gap:6px');
    joined.append(el('b', 'font-size:15px', 'Players joined'));
    box.append(joined);
    const others = seats.filter((s) => s !== mine);
    if (!others.length) {
      joined.append(el('span', 'font-size:13px;color:var(--dim,#aaa)', 'No one yet.'));
      return box;
    }
    for (const seat of others) {
      const line = el('div', 'display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:14px');
      const free = el('button', 'background:none;border:1px solid var(--line,#444);border-radius:8px;color:var(--dim,#aaa);' +
        'font-size:12.5px;font-weight:600;padding:5px 9px;cursor:pointer', 'Free');
      free.onclick = async () => {
        free.disabled = true;
        try { await api('/' + edit + '/seat/' + seat, { method: 'DELETE' }); line.remove(); }
        catch (e) { free.disabled = false; }
      };
      line.append(el('span', null, names[seat] || 'Player ' + (seat + 1)), free);
      joined.append(line);
    }
    return box;
  }

  async function stop(editToken) {
    try { await api('/' + encodeURIComponent(editToken), { method: 'DELETE' }); } catch (e) { /* offline */ }
  }

  function seat() {
    const s = page && page.get(), sh = s && shareOf(s.id);
    if (!sh || !Number.isInteger(sh.seat)) return null;
    // whoever shared the game scores everyone, unless they chose their own only
    return sh.owner && !sh.restricted ? null : sh.seat;
  }

  return {
    attach(p) { page = p; },
    youAre, lastMe, rememberMe,
    fromUrl, open, changed, stop, seat,
    canScore: (p) => { const s = seat(); return s === null || s === p; },
    get watching() { return !!watch; },
  };
})();
