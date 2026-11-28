/* Score Chalk — countdown scoring for one to four players */

// games are kept by id, every kind together: see /store.js
const TYPE = 'darts';
const MAX_DARTS = 3;

const $ = (id) => document.getElementById(id);

let S = null;      // game state, null until a game starts
let msgTimer = null;
let signedIn = false;   // set once /api/me answers; see buildSetup

/* ---------------- state ----------------

   A game is the turns as they were thrown, and the rules, as in the other
   games. Everything else is worked out from the turns by play(): each
   player's score, turns and average, whether they are in under double in,
   which turns bust, and who has checked out. So Undo takes a turn off, a
   correction changes one, and the game is simply played through again,
   later busts and checkouts and all.

     id, startedAt       chosen here, so saving the game twice updates one
                         row on the profile rather than adding a second
     names, me           the players in order of throwing; which is you
     start, doubleIn, doubleOut
     cur                 whose turn it is
     log                 the turns in the order thrown: { p, darts, ts },
                         darts as { label, val, dbl }, and bust: true on a
                         turn marked bust with the Bust button (the rules'
                         own busts are worked out, not kept)
     edits               turns changed since: { i, p, n, from, to, after,
                         ts }, from and to as { darts, bust }; see fixTurn
     darts, mult         the turn being thrown
     over, winner        ended with End game, and who won
     sum                 each player's score, turns and points, for the
                         pages that read a game without playing it through
                         (the home page, a tournament, a shared link's card);
                         written by save()
     tid                 the tournament this is a match of, if it is one */

function newGame(names, start, rules) {
  return {
    id: crypto.randomUUID(),
    startedAt: Date.now(),
    names,
    me: rules.me || 0,
    start,
    doubleIn: !!rules.doubleIn,
    doubleOut: !!rules.doubleOut,
    cur: 0,
    log: [],
    edits: [],
    darts: [],
    mult: 1,
    over: false,
    winner: null,
  };
}

/* One turn's darts, thrown from `score` by a player in (`opened`) or not
   yet, under game st's rules: what they score, which count (under double
   in, darts before the opening double score nothing), whether the player is
   in afterwards, and whether the turn busts, and why, or checks out. A
   landed double opens a player even on a turn that busts. `left` is where
   the turn leaves them: where they were, on a bust. */
function throwOf(st, score, opened, darts, marked) {
  let open = opened, pts = 0;
  const counted = [];
  for (const d of darts) {
    if (!open) {
      if (!d.dbl) { counted.push(false); continue; }  // still not in
      open = true;
    }
    counted.push(true);
    pts += d.val;
  }
  const after = score - pts;
  let why = marked ? 'marked bust' : '';
  if (!why && after < 0) why = 'overshot';
  if (!why && st.doubleOut && after === 1) why = 'left 1';
  if (!why && st.doubleOut && after === 0 && !(darts.length && darts[darts.length - 1].dbl)) why = 'no double to finish';
  const bust = !!why;
  return { pts, counted, open, after, bust, why, left: bust ? score : after, win: !bust && after === 0 };
}

/* The game played through from its turns (the first `upto` of them): each
   player as they now stand, each turn as it went, and who checked out
   first, if anyone has. A player who has checked out is on 0, so any turn
   of theirs after it busts. */
function play(st = S, upto = st.log.length) {
  const players = st.names.map(() => ({ score: st.start, points: 0, turns: 0, opened: !st.doubleIn }));
  const turns = [];
  let winner = null;
  for (const e of st.log.slice(0, upto)) {
    const p = players[e.p];
    if (!p) { turns.push(null); continue; }
    const t = throwOf(st, p.score, p.opened, e.darts || [], !!e.bust);
    turns.push({ ...t, before: p.score, n: p.turns + 1 });
    p.turns += 1;
    p.opened = t.open;
    if (!t.bust) { p.score = t.left; p.points += t.pts; }
    if (t.win && winner === null) winner = e.p;
  }
  return { players, turns, winner };
}

/* A turn kept with bust: true is one marked bust by hand. Games kept before
   this shape, and older phones, said bust for every bust: the ones the
   rules make anyway are worked out, so only the ones marked by hand keep
   the mark, and a turn changed later busts or not by the rules. */
function keepMarkedBusts(st) {
  st.log.forEach((e, i) => {
    if (!e.bust) return;
    delete e.bust;
    if (!play(st, i + 1).turns[i].bust) e.bust = true;
  });
  return st;
}

/* A game kept in darts' first shape (players with their scores kept as
   they went, the turns with them; meIdx) in this one: its names, and the
   turns as thrown. Games on a device, on the profile, in a shared link or a
   tournament may be in it. Anything already in this shape comes back as it
   was. */
function upgrade(st) {
  if (!st) return st;
  if (!st.players) {
    if (!st.edits) st.edits = [];
    return st;
  }
  const { players, meIdx, log, winner, savedTurns, ...rest } = st;
  return keepMarkedBusts({
    ...rest,
    names: players.map((p) => p.name),
    me: typeof meIdx === 'number' ? meIdx : 0,
    log: (log || []).map((t) => ({ p: t.player, darts: t.darts || [], ...(t.bust ? { bust: true } : {}) })),
    edits: [],
    darts: st.darts || [],
    mult: st.mult || 1,
    over: !!st.over,
    winner: st.over && winner != null ? winner : null,
  });
}

/* Kept on this device and, signed in, on the profile (see /cloud.js), as
   every game is: a moment after each change, all of it. The summary goes
   with it for the pages that read a game without playing it through. */
function save() {
  if (!S) return;
  S.sum = play().players.map((p) => ({ score: p.score, turns: p.turns, points: p.points }));
  SCStore.put(TYPE, S, !!S.over);
  if (window.SCCloud) SCCloud.keep(cloudGame);
}

/* The game as the profile keeps it: every turn, with the score it left,
   for the statistics and the game's page there, and the game's own state
   to pick it up again by. Nothing until a turn has been thrown. */
const cloudGame = () => (S && S.log.length ? toPayload() : null);

function toPayload() {
  const G = play(), counts = [];
  const turns = S.log.map((e, i) => {
    const t = G.turns[i];
    const n = counts[e.p] || 0;
    counts[e.p] = n + 1;
    return {
      player_idx: e.p,
      turn_no: n,
      detail: e.darts || [],            // the throws
      points: t.bust ? 0 : t.pts,
      bust: t.bust,
      score_after: t.left,
      created_at: S.startedAt + i,      // ordering only; no clock is kept per turn
    };
  });
  return {
    id: S.id,
    game_type: 'darts',
    config: { start: S.start, doubleIn: S.doubleIn, doubleOut: S.doubleOut, solo: S.names.length === 1 },
    started_at: S.startedAt,
    // chosen on the setup screen, not inferred from names
    me_idx: Number.isInteger(S.me) ? S.me : 0,
    ended_at: S.over ? Date.now() : null,
    winner_idx: S.over && S.winner != null ? S.winner : null,
    players: S.names.map((name, idx) => ({ idx, name })),
    turns,
    state: S,
  };
}

// The newest darts game in progress here, for the setup's Resume.
function load() {
  const g = SCStore.latest(TYPE);
  return g ? upgrade(g.state) : null;
}

// A game on screen has its id in the address: a link to it opens it.
function openGame(state) {
  S = upgrade(state);
  // a game saved before ids existed still needs one to sync
  if (!S.id) { S.id = crypto.randomUUID(); S.startedAt = S.startedAt || Date.now(); }
  save();
  SCStore.show(S.id);
  showGame();
}

// Leaving a game: back to the setup, the address without it — or, for a
// tournament's match, back to the tournament.
function leaveGame() {
  location.replace(tid() ? tourneyUrl(tid()) : location.pathname);
}

/* ---------------- tournaments ----------------

   A tournament (/tournament/) sends each match here as
     ?new=<game id>&t=<tournament id>&tn=<its name>&a=Alice&b=Bob&start=501&din=1&dout=1
   The setup is filled in from it, and the game takes the id the tournament
   gave it: that is how the tournament finds the result, by reading the game
   from the store. Nothing here writes to the tournament. A match's game is
   kept when it ends, rather than cleared for the next, so it is there to be
   read. */

const tourneyUrl = (tid) => '/tournament/?g=' + encodeURIComponent(tid);

// A tournament's match leads back to the tournament, in words: the badge
// (the way home everywhere else) would say the wrong place.
function toTourney(a, id) {
  a.href = tourneyUrl(id);
  a.classList.remove('mark');
  a.removeAttribute('aria-label');
  a.innerHTML = '&lsaquo; Tournament';
  // a match's way back is its tournament alone: no step to the list of games
  const crumb = a.parentElement.querySelector('.crumb');
  if (crumb) crumb.hidden = true;
}

// The tournament this game is a match of, when that tournament is on this
// device. A shared match carries its tournament's id to every phone in it,
// and to the others it is a game like any other.
const tid = () => (S && S.tid && SCStore.get(S.tid) ? S.tid : null);

function fromTourney() {
  const q = new URLSearchParams(location.search);
  if (!q.get('new') || !q.get('t')) return null;
  return {
    id: q.get('new'), tid: q.get('t'), name: q.get('tn') || 'Tournament',
    names: [q.get('a') || '', q.get('b') || ''],
    start: parseInt(q.get('start'), 10) || 501,
    doubleIn: q.get('din') === '1', doubleOut: q.get('dout') === '1',
  };
}

/* ---------------- messages ---------------- */

function say(text, ms = 2600) {
  $('msg').textContent = text;
  clearTimeout(msgTimer);
  if (text) msgTimer = setTimeout(() => { $('msg').textContent = ''; }, ms);
}

/* ---------------- confirmation ----------------

   An in-app sheet rather than window.confirm: it matches the theme, and a
   native modal on mobile blocks the page until dismissed. */

let confirmResolve = null;

function askConfirm(text, yesLabel) {
  $('confirmText').textContent = text;
  $('confirmYes').textContent = yesLabel;
  $('confirmOverlay').classList.remove('hidden');
  return new Promise(resolve => { confirmResolve = resolve; });
}

function closeConfirm(answer) {
  $('confirmOverlay').classList.add('hidden');
  const resolve = confirmResolve;
  confirmResolve = null;
  if (resolve) resolve(answer);
}

/* ---------------- setup screen ---------------- */

function buildSetup() {
  const scorePresets = document.querySelectorAll('#presets .preset');
  scorePresets.forEach(btn => {
    btn.addEventListener('click', () => {
      scorePresets.forEach(b => b.classList.remove('is-on'));
      btn.classList.add('is-on');
      $('startScore').value = btn.dataset.score;
    });
  });

  $('startScore').addEventListener('input', () => {
    scorePresets.forEach(b => {
      b.classList.toggle('is-on', b.dataset.score === $('startScore').value);
    });
  });

  // solo practice, or two to four players
  let playerCount = 2;
  const nameInputs = [1, 2, 3, 4].map(n => $('name' + n));

  /* Which player is the account holder. Asked, never inferred: statistics
     hang off this, and a wrong guess quietly credits someone else's darts to
     you. Hidden unless it matters — signed out there is nothing to record,
     and in practice mode there is only one player to be. */
  let meIdx = 0;
  const meRow = $('meRow');
  const meBtns = [...document.querySelectorAll('#meSel .seg')];

  // asked whenever there are others to play: it records whose stats the
  // darts are, and is the player taken for you when the game is shared
  const showMeRow = () => meRow.classList.toggle('hidden', playerCount < 2);

  meBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      meBtns.forEach(b => b.classList.remove('is-on'));
      btn.classList.add('is-on');
      meIdx = parseInt(btn.dataset.me, 10);
    });
  });

  // the buttons carry the typed names, so the question reads as itself
  const labelMeBtns = () => {
    meBtns.forEach((b, i) => { b.textContent = nameInputs[i].value.trim() || `Player ${i + 1}`; });
  };
  nameInputs.forEach(input => input.addEventListener('input', labelMeBtns));
  labelMeBtns();

  /* The order of the list is the order of throwing: a grip on each name
     drags it up or down (see /roster.js). The names change places, and
     You are goes with the name it was on. A tournament's match keeps its
     players where the tournament put them: it reads the result by place. */
  nameInputs.forEach((input, i) => {
    input.closest('li').append(SCRoster.grip(`Move player ${i + 1}`));
  });
  SCRoster.sortable($('names'), (from, to) => {
    if (match) return;
    const vals = nameInputs.map(input => input.value);
    vals.splice(to, 0, vals.splice(from, 1)[0]);
    nameInputs.forEach((input, i) => { input.value = vals[i]; });
    const order = nameInputs.map((_, i) => i);
    order.splice(to, 0, order.splice(from, 1)[0]);
    meIdx = order.indexOf(meIdx);
    meBtns.forEach((b, i) => b.classList.toggle('is-on', i === meIdx));
    labelMeBtns();
  });

  if (window.SCSync) {
    window.SCSync.me().then(who => {
      signedIn = !!(who && who.user);
      showMeRow();
    });
  }

  const modeBtns = document.querySelectorAll('#modeRow .seg');
  modeBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      modeBtns.forEach(b => b.classList.remove('is-on'));
      btn.classList.add('is-on');
      playerCount = parseInt(btn.dataset.players, 10);
      [2, 3, 4].forEach(n => $('field' + n).classList.toggle('hidden', n > playerCount));
      meBtns.forEach((b, i) => b.classList.toggle('hidden', i >= playerCount));
      $('label1').textContent = playerCount === 1 ? '' : '1.';
      $('names').classList.toggle('solo', playerCount === 1);
      $('name1').placeholder = playerCount === 1 ? 'You' : 'Player 1';
      // solo, or the chosen player is no longer in the game: fall back to player one
      if (meIdx >= playerCount) {
        meIdx = 0;
        meBtns.forEach((b, i) => b.classList.toggle('is-on', i === 0));
      }
      showMeRow();
    });
  });

  const toggles = {};
  ['doubleIn', 'doubleOut'].forEach(id => {
    const btn = $(id);
    toggles[id] = btn;
    btn.addEventListener('click', () => {
      const on = !btn.classList.contains('is-on');
      btn.classList.toggle('is-on', on);
      btn.setAttribute('aria-checked', String(on));
    });
  });

  $('startBtn').addEventListener('click', async () => {
    const start = parseInt($('startScore').value, 10);
    if (!Number.isFinite(start) || start < 2) {
      $('startScore').focus();
      return;
    }

    // a new game of its own: any in progress stay, under Pick up where you left off
    const names = playerCount === 1
      ? [$('name1').value.trim() || 'You']
      : nameInputs.slice(0, playerCount).map((input, i) => input.value.trim() || `Player ${i + 1}`);

    S = newGame(names, start, {
      doubleIn: toggles.doubleIn.classList.contains('is-on'),
      doubleOut: toggles.doubleOut.classList.contains('is-on'),
      me: playerCount === 1 ? 0 : meIdx
    });
    if (match) { S.id = match.id; S.tid = match.tid; }
    openGame(S);
  });

  // a tournament's match: its players and the tournament's rules
  const match = fromTourney();
  if (match) {
    match.names.forEach((n, i) => { nameInputs[i].value = n; });
    $('names').classList.add('fixed');
    labelMeBtns();
    $('startScore').value = match.start;
    $('startScore').dispatchEvent(new Event('input'));
    if (match.doubleIn) toggles.doubleIn.click();
    if (match.doubleOut) toggles.doubleOut.click();
    $('modeRow').closest('.card').classList.add('hidden');
    $('setupSub').textContent = match.name;
    $('tourneyLink').classList.add('hidden');    // in one already
    toTourney($('setupBack'), match.tid);
    return;    // no Resume: a match starts its own game
  }

  const saved = load();
  if (saved && !saved.over) {
    const btn = $('resumeBtn');
    btn.textContent = 'Resume: ' + saved.names.join(' vs ');
    btn.classList.remove('hidden');
    btn.addEventListener('click', () => openGame(saved));
  }

  buildCloudResume();
}


/* ?g=<id> — a game's own address: a link to it, or a reload. The game is
   opened from this device or, signed in, from the profile — through
   SCSync.load, which also rebuilds games saved before they kept their
   state. ?resume=<id> asks for the profile's copy first, as it has been
   played on elsewhere. */
async function openFromUrl() {
  // ?s=<token>: a shared game, to score in together or to watch
  const shared = await SCShare.fromUrl(TYPE);
  if (shared && shared.kind === 'edit') { openGame(shared.state); return; }
  if (shared) { S = upgrade(shared.state); showGame(); return; }
  const at = SCStore.urlId();
  if (!at) return;
  const st = await SCStore.open(TYPE, at.id, at.fresh, window.SCSync ? (id) => window.SCSync.load(id) : null);
  if (st) { openGame(st); return; }
  SCStore.leave();
  SCStore.notice("That game isn't on this device. Sign in to open games saved to your profile.");
}


/* Unfinished games saved to the profile. Offered alongside the local resume
   rather than instead of it: if both exist they are usually different games,
   and picking one silently is how someone loses a leg. */
async function buildCloudResume() {
  const box = $('cloudResume');
  if (!box || !window.SCSync) return;

  const who = await window.SCSync.me();
  if (!who || !who.user) return;

  let games = [];
  try { games = await window.SCSync.unfinished(); } catch (e) { return; }

  // the ones already on this device are under Resume, not worth offering twice
  games = games.filter(g => !SCStore.get(g.id));
  if (!games.length) return;

  for (const g of games) {
    const btn = document.createElement('button');
    btn.className = 'ghost';
    btn.textContent = 'Resume from profile: ' + g.players.map(p => p.name).join(' vs ');
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      try {
        openGame(await window.SCSync.load(g.id));
      } catch (e) {
        btn.disabled = false;
        say('Could not load that game');
      }
    });
    box.appendChild(btn);
  }
}

/* ---------------- game board ---------------- */

function buildBoard() {
  // 1-20 number grid
  const grid = $('numgrid');
  for (let n = 1; n <= 20; n++) {
    const b = document.createElement('button');
    b.className = 'key';
    b.textContent = n;
    b.addEventListener('click', () => addDart(n));
    grid.appendChild(b);
  }

  // multiplier
  document.querySelectorAll('.mult').forEach(b => {
    b.addEventListener('click', () => {
      S.mult = parseInt(b.dataset.m, 10);
      render();
    });
  });

  document.querySelector('[data-bull]').addEventListener('click', () => addDart(25, true));
  document.querySelector('[data-miss]').addEventListener('click', () => addDart(0));
  $('undoDart').addEventListener('click', undoDart);
  $('shareBtn').addEventListener('click', () => SCShare.open());

  // the checkout box is rebuilt on every render, so its arrows are delegated
  $('checkout').addEventListener('click', e => {
    const arrow = e.target.closest('.co-arrow');
    if (!arrow) return;
    coIdx += Number(arrow.dataset.co);
    render();
  });
  $('submitBtn').addEventListener('click', submitTurn);
  $('bustBtn').addEventListener('click', bustTurn);
  $('undoTurn').addEventListener('click', undoTurn);
  $('editBtn').addEventListener('click', editGame);
  $('winBarBtn').addEventListener('click', endGame);
  $('fixCancel').addEventListener('click', cancelFix);

  $('confirmYes').addEventListener('click', () => closeConfirm(true));
  $('confirmNo').addEventListener('click', () => closeConfirm(false));
  $('confirmOverlay').addEventListener('click', e => {
    if (e.target === $('confirmOverlay')) closeConfirm(false);   // tap outside cancels
  });

  $('quitBtn').addEventListener('click', async () => {
    const G = play();
    const names = S.names.map((name, i) => `${name} on ${G.players[i].score}`).join(' and ');
    if (tid() && S.over) { leaveGame(); return; }
    const ok = await askConfirm(S.over
      ? 'This clears the finished game and goes back to setup.'
      : `This discards the game in progress — ${names}${signedIn ? ', from your profile too' : ''} — and goes back to ${tid() ? 'the tournament, where the match can be played again' : 'setup'}.`,
      'End game');
    if (!ok) return;
    if (!S.over && window.SCCloud) SCCloud.drop(S.id);
    // a match won is the tournament's result: kept, for it to read
    if (!(tid() && S.over)) SCStore.remove(S.id);
    leaveGame();
  });

  // back to the board, the game kept over: its history, and changes to it
  $('keepBtn').addEventListener('click', () => $('winOverlay').classList.add('hidden'));

  $('rematchBtn').addEventListener('click', () => {
    if (tid()) { leaveGame(); return; }    // Back to tournament: see showWin
    SCStore.remove(S.id);      // finished, and on the profile when signed in
    S = newGame(S.names, S.start, { doubleIn: S.doubleIn, doubleOut: S.doubleOut, me: S.me });
    save();
    SCStore.show(S.id);
    $('winOverlay').classList.add('hidden');
    render();
  });

  $('newBtn').addEventListener('click', () => { SCStore.remove(S.id); leaveGame(); });

  // tapping a player card switches whose turn it is (fixes mis-taps)
  [0, 1, 2, 3].forEach(i => {
    $('p' + i).addEventListener('click', () => {
      if (closed() || fixing || S.cur === i || i >= S.names.length) return;
      if (!SCShare.canScore(i)) { say(`${S.names[i]} enters their turns on their own phone`); return; }
      if (S.darts.length) { say('Clear the current turn first'); return; }
      S.cur = i;
      render(); save();
    });
  });
}

function showGame() {
  SCAwake.keep(true);     // the screen stays on through the game: see /awake.js
  $('setup').classList.add('hidden');
  $('game').classList.remove('hidden');
  if (tid()) {
    toTourney($('gameBack'), tid());
  }
  render();
}

/* ---------------- dart entry ---------------- */

function addDart(n, isBull = false) {
  if ((closed() && !fixing) || waiting()) return;
  if (S.darts.length >= MAX_DARTS) { say('3 darts thrown — submit the turn'); return; }

  let m = S.mult;
  if (isBull && m === 3) { say('No triple bull'); return; }
  if (n === 0) m = 1;

  const val = n * m;
  const prefix = n === 0 ? '' : (m === 2 ? 'D' : m === 3 ? 'T' : '');
  const label = n === 0 ? 'miss' : prefix + n;

  // dbl is what the double-out rule checks on the winning dart
  S.darts.push({ label, val, dbl: m === 2 && n > 0 });
  S.mult = 1;                       // multiplier applies to one dart only
  render(); save();
}

function undoDart() {
  if (!S.darts.length) return;
  S.darts.pop();
  render(); save();
}

/* The turn being thrown, as it stands (see throwOf): from where its player
   is now, or, changing a turn already thrown (see fixTurn), from where they
   were before it. Shared by the live projection, the submit button and the
   turn itself. */
function current() {
  if (fixing) {
    const e = S.log[fixing.i];
    const p = play(S, fixing.i).players[e.p];
    return throwOf(S, p.score, p.opened, S.darts, false);
  }
  const p = play().players[S.cur];
  return throwOf(S, p.score, p.opened, S.darts, false);
}

// Someone has checked out: the pad waits for End game, or an Undo. Ended
// with End game, the game is over.
const checkedOut = () => play().winner !== null;
const closed = () => S.over || checkedOut();

/* ---------------- checkout suggestions ----------------

   The board only has 62 distinct throws, so the finish is searched rather
   than looked up in a table: one table would have to cover every
   (target x darts left x double-out x still-needs-to-open) combination.
   Candidates are ordered the way a player picks them, and the first
   complete path found is the one shown — which reproduces the standard
   checkout chart (170 = T20 T20 D25, 141 = T20 T19 D12, ...). */

/* Setup darts: biggest first. Ties prefer a triple, then a single. */
const THROWS = (() => {
  const t = [];
  for (let n = 20; n >= 1; n--) t.push({ label: 'T' + n, val: 3 * n, dbl: false });
  for (let n = 20; n >= 1; n--) t.push({ label: String(n), val: n, dbl: false });
  t.push({ label: '25', val: 25, dbl: false });
  for (let n = 20; n >= 1; n--) t.push({ label: 'D' + n, val: 2 * n, dbl: true });
  t.push({ label: 'D25', val: 50, dbl: true });
  return t.sort((a, b) => b.val - a.val);   // stable, so ties keep the order above
})();

/* Finishing on a double: the ones players actually aim for, best first. */
const FINISH_DOUBLES = [20, 16, 18, 12, 10, 8, 14, 6, 4, 2, 19, 17, 15, 13, 11, 9, 7, 5, 3, 1]
  .map(n => ({ label: 'D' + n, val: 2 * n, dbl: true }))
  .concat([{ label: 'D25', val: 50, dbl: true }]);

/* Finishing without the double-out rule: easiest throw for the value. */
const FINISH_ANY = (() => {
  const t = [];
  for (let n = 1; n <= 20; n++) t.push({ label: String(n), val: n, dbl: false });
  t.push({ label: '25', val: 25, dbl: false });
  for (let n = 1; n <= 20; n++) t.push({ label: 'D' + n, val: 2 * n, dbl: true });
  t.push({ label: 'D25', val: 50, dbl: true });
  for (let n = 1; n <= 20; n++) t.push({ label: 'T' + n, val: 3 * n, dbl: false });
  return t;
})();

/* Throws grouped by value, for filling in the last setup dart. */
const BY_VALUE = (() => {
  const m = new Map();
  for (const t of THROWS) {
    if (!m.has(t.val)) m.set(t.val, []);
    m.get(t.val).push(t);
  }
  return m;
})();

/* How much a player dislikes finishing on each double, by position in the
   preference order above — D20 best, D1 and the bull worst. */
const FINISH_RANK = new Map();
FINISH_DOUBLES.forEach((t, i) => FINISH_RANK.set(t.label, i));

function finishCost(t, needDouble) {
  if (needDouble || t.dbl) {
    const r = FINISH_RANK.get(t.label);
    return (r === undefined ? 20 : r) * 10;
  }
  if (t.label === '25') return 10;        // straight-out only, from here down
  if (t.label[0] === 'T') return 20;
  return 0;                               // a plain single is the easiest finish
}

/* Setup darts: aim big, and don't ask a player to hit a double or the bull
   just to set up. `weight` makes the earlier dart of a three-dart finish
   matter more, which keeps the biggest scoring throw first. */
function setupCost(t, weight) {
  let c = 60 - t.val;
  if (t.dbl) c += 150;
  if (t.val === 25 || t.val === 50) c += 100;
  return c * weight;
}

/* Every way to make `target` with exactly `n` throws. */
function setupPaths(target, n, mustOpenDouble) {
  const out = [];
  if (n === 1) {
    for (const t of BY_VALUE.get(target) || []) {
      if (!mustOpenDouble || t.dbl) out.push([t]);
    }
    return out;
  }
  for (const t of THROWS) {
    if (mustOpenDouble && !t.dbl) continue;
    const rem = target - t.val;
    if (rem < 1) continue;
    for (const rest of setupPaths(rem, n - 1, false)) out.push([t, ...rest]);
  }
  return out;
}

/* Every legal path of exactly `darts` throws, cheapest first by the costs
   above. Routes that differ only in the order of their setup darts are one
   route, kept at its cheapest ordering — otherwise cycling would walk through
   T20 T19 D12 and T19 T20 D12 as though they were different ideas — and
   without double out, only in the order of any of their darts. */
function searchFinish(target, darts, needDouble, mustOpenDouble) {
  const finishers = needDouble ? FINISH_DOUBLES : FINISH_ANY;
  const seen = new Map();   // signature -> { path, cost }

  // Without double out, which dart finishes doesn't matter either, so a
  // route is just its darts, in any order: T17 D25 and D25 T17 are one.
  const consider = (path, cost) => {
    const sig = needDouble
      ? path.slice(0, -1).map(t => t.label).sort().join(',') + '>' + path[path.length - 1].label
      : path.map(t => t.label).sort().join(',');
    const prev = seen.get(sig);
    if (!prev || cost < prev.cost) seen.set(sig, { path, cost });
  };

  for (const f of finishers) {
    const rem = target - f.val;

    if (darts === 1) {
      if (rem !== 0 || (mustOpenDouble && !f.dbl)) continue;
      consider([f], finishCost(f, needDouble));
      continue;
    }

    if (rem < 1) continue;
    for (const setup of setupPaths(rem, darts - 1, mustOpenDouble)) {
      let c = finishCost(f, needDouble);
      setup.forEach((t, i) => { c += setupCost(t, darts - 1 - i); });
      consider([...setup, f], c);
    }
  }

  // sort is stable, so equal-cost routes keep the preference order they were
  // found in — which leaves the first entry exactly what it always was
  return [...seen.values()].sort((a, b) => a.cost - b.cost).map(e => e.path);
}

/* Ways to finish, or empty: every route in the fewest darts it can be done
   in, cheapest first, then the routes taking one dart more, and so on up to
   the darts left. The first is still the chart answer; the longer routes
   come after it, as a player with three darts often prefers one, setting
   up a double they like rather than going for the bull (101: T17 D25,
   then T20 9 D16 and the like). Capped at a few for each number of darts,
   so cycling stays a short loop. Memoised because render() asks on every
   dart tapped. */
const PER_DART_COUNT = 6;
const finishCache = new Map();

function finishKey(target, dartsLeft, needDouble, mustOpenDouble) {
  return `${target}|${dartsLeft}|${needDouble ? 1 : 0}|${mustOpenDouble ? 1 : 0}`;
}

function findFinishes(target, dartsLeft, needDouble, mustOpenDouble) {
  if (target < 1 || dartsLeft < 1) return [];

  const key = finishKey(target, dartsLeft, needDouble, mustOpenDouble);
  if (finishCache.has(key)) return finishCache.get(key);

  let paths = [];
  for (let k = 1; k <= dartsLeft; k++) {
    paths = paths.concat(searchFinish(target, k, needDouble, mustOpenDouble).slice(0, PER_DART_COUNT));
  }
  finishCache.set(key, paths);
  return paths;
}

/* Highest score that could possibly be finished with this many darts. */
function maxFinish(dartsLeft, needDouble) {
  if (dartsLeft < 1) return 0;
  return (needDouble ? 50 : 60) + 60 * (dartsLeft - 1);
}

/* ---------------- turn resolution ---------------- */

function submitTurn() {
  if (fixing) { saveFix(false); return; }
  if (closed() || !SCShare.canScore(S.cur)) return;
  const t = current();
  S.log.push({ p: S.cur, darts: S.darts.slice(), ts: Date.now() });
  thrown(t);
}

/* Manual bust: the turn scores nothing and play passes. For busts the app
   can't infer on its own — a bounce-out, a mis-entry, a throw out of turn.
   A landed double still opens a player under double in, as on any bust. */
function bustTurn() {
  if (fixing) { saveFix(true); return; }
  if (closed() || !SCShare.canScore(S.cur)) return;
  const t = current(), stays = play().players[S.cur].score;
  S.log.push({ p: S.cur, darts: S.darts.slice(), bust: true, ts: Date.now() });
  thrown({ ...t, bust: true, why: 'marked bust', left: stays, win: false });
}

// A turn in: said, and the turn passes on, or the checkout offered.
function thrown(t) {
  const name = S.names[S.cur];
  S.darts = [];
  S.mult = 1;
  if (t.win) {
    render(); save();
    say(`${name} checked out!`);
    return;
  }
  if (t.bust) say(t.why === 'marked bust' ? `Bust — ${name} stays on ${t.left}` : `Bust — ${t.why}. ${name} stays on ${t.left}`);
  else if (S.doubleIn && !play(S, S.log.length - 1).players[S.cur].opened && t.open) say(`${name} is in`);
  else if (S.doubleIn && !t.open) say(`${name} still needs a double to open`);
  passTurn();
  render(); save();
}

/* A checkout is offered, not declared, as in the Builder's live games:
   the bar says who checked out, Undo takes it back if it wasn't, and End
   game ends the game, with the result. Ended and back at the board, the bar
   stays, its button the result again, as in the Builder. */
function renderWinBar(G) {
  const w = G.winner;
  const on = w !== null && !fixing;
  $('winBar').classList.toggle('hidden', !on);
  if (!on) return;
  $('winBarText').innerHTML = '';
  $('winBarText').append(S.over ? `${S.names[w]} wins!` : `${S.names[w]} checked out!`);
  const small = document.createElement('small');
  small.textContent = S.over ? 'The game is over. Undo takes it back, or change a turn in History.' : 'Undo if that wasn’t the finish.';
  $('winBarText').append(small);
  $('winBarBtn').textContent = S.over ? 'See results' : 'End game';
}

function endGame() {
  const G = play();
  if (G.winner === null) return;
  if (S.over) { showWin(); return; }    // See results
  S.over = true;
  S.winner = G.winner;
  save();
  // at the end of a game, to the profile at once rather than a moment later
  if (window.SCCloud) SCCloud.now(cloudGame).catch(() => {});
  render();
  showWin();
}

/* Edit game (see /editgame.js): the players put in another order, or
   renamed. Everything kept by a player's place moves with them: their
   turns and the changes to them, whose turn it is (and the darts already
   thrown in it), who won, and which one is you; their scores follow, as
   they are worked out from the turns. The order of play follows the new
   list from the next turn. Not for a shared game, whose other phones know
   the players by their place, nor a tournament's match, whose result the
   tournament reads by place. */
async function editGame() {
  if (fixing) cancelFix();
  const locked = SCStore.get(S.id)?.share
    ? 'This game is shared with other phones, which know the players by their place, so the players can’t be moved or renamed now.'
    : tid() ? 'This is a tournament match: the tournament keeps its players, so they can’t be moved or renamed here.' : null;
  const turns = play().players.map((p) => p.turns);
  // who a new order would pass over for the rest of this round (see passTurn)
  const warn = (order, named) => {
    if (closed()) return null;
    const { list, place } = SCEditGame.moves(order);
    return SCEditGame.skipWarning({ names: named, counts: list(turns), cur: place(S.cur) });
  };
  const got = await SCEditGame.open({ names: S.names, locked, hint: 'Whoever’s turn it is keeps it.', warn, history: historyRows });
  if (!got) return;
  const moved = got.order.some((from, i) => from !== i);
  if (!moved && got.names.every((n, i) => n === S.names[i])) return;
  const { place } = SCEditGame.moves(got.order);
  S.names = got.names;
  S.log.forEach((e) => { e.p = place(e.p); });
  S.edits.forEach((x) => { x.p = place(x.p); });
  S.cur = place(S.cur);
  if (S.winner != null) S.winner = place(S.winner);
  S.me = place(Number.isInteger(S.me) ? S.me : 0);
  render(); save();
  say(moved ? `${S.names[S.cur]} to throw` : 'Names changed');
}

const labels = (darts) => (darts || []).map((d) => d.label).join(' ') || 'no darts';

/* The game's history for Edit's History (see /editgame.js): every turn,
   its darts and the score it left, and any change made to one since, in
   its place. A turn can be tapped to change it (see fixTurn), the game
   over or not. */
function historyRows() {
  const G = play(), rows = [];
  const changes = (n) => S.edits.filter((x) => x.after === n).map((x) => ({
    who: S.names[x.p],
    what: `turn ${x.n} changed`,
    when: `${labels(x.from.darts)}${x.from.bust ? ' (bust)' : ''} → ${labels(x.to.darts)}${x.to.bust ? ' (bust)' : ''}`,
  }));
  rows.push(...changes(0));
  S.log.forEach((e, i) => {
    const t = G.turns[i];
    const edit = !SCShare.watching && SCShare.canScore(e.p) ? () => fixTurn(i) : null;
    rows.push({
      who: S.names[e.p],
      what: (e.darts || []).map((d) => d.label).join(' '),
      when: t.bust ? `bust, stays on ${t.left}` : `${t.before} → ${t.left}`,
      pts: t.bust ? 0 : t.pts,
      edit,
    });
    rows.push(...changes(i + 1));
  });
  return rows;
}

/* Changing a turn already thrown, from the history: the pad takes that
   turn's darts, from where its player stood before it, and holds the game
   (the bar over it says whose turn is being changed) until the change is
   saved, with Submit or Bust, or cancelled. The turn being thrown waits,
   darts and all, and comes back after. Saved, the game is played through
   again: a later turn may now bust, or the change may be a checkout. */
let fixing = null;    // { i, keep: { darts, mult } } while a turn is changed

function fixTurn(i) {
  const e = S.log[i];
  if (!e) return;
  $('winOverlay').classList.add('hidden');
  if (fixing) cancelFix();
  fixing = { i, keep: { darts: S.darts, mult: S.mult } };
  S.darts = (e.darts || []).map((d) => ({ ...d }));
  S.mult = 1;
  render();
}

function endFix() {
  S.darts = fixing.keep.darts;
  S.mult = fixing.keep.mult;
  fixing = null;
}

function cancelFix() {
  if (!fixing) return;
  endFix();
  render();
}

function saveFix(bust) {
  const i = fixing.i, e = S.log[i];
  const from = { darts: e.darts || [], bust: !!e.bust };
  const to = { darts: S.darts.slice(), bust: !!bust };
  const n = play(S, i + 1).turns[i].n;
  endFix();
  if (JSON.stringify(from) === JSON.stringify(to)) { render(); return; }
  const had = play().winner;
  S.edits.push({ i, p: e.p, n, from, to, after: S.log.length, ts: Date.now() });
  S.log[i] = { p: e.p, darts: to.darts, ...(to.bust ? { bust: true } : {}), ts: e.ts };
  const G = play();
  // the checkout gone, the turn that stood on it is done: play passes on
  if (had !== null && G.winner === null) passTurn();
  settleEnd(G);
  render(); save();
  if (S.over) { showWin(); return; }
  say(G.winner !== null ? `${S.names[G.winner]} checked out!` : `${S.names[e.p]}'s turn ${n} changed`);
}

/* A game ended with End game, a turn changed since: still over while
   someone has checked out, its winner whoever did first now, as Yahtzee's
   and the Builder's results follow a change; open again when no one has,
   and play goes on. */
function settleEnd(G) {
  if (!S.over) return;
  if (G.winner === null) { S.over = false; S.winner = null; return; }
  S.winner = G.winner;
}

/* The turn passes to the next player who has thrown the fewest turns, so a
   round always finishes before anyone throws again, even after Edit has
   changed the order part-way through it, or a card was tapped to throw out
   of turn (see nextTurn in /editgame.js). Whoever it passes over is said. */
function passTurn() {
  const { next, skipped } = SCEditGame.nextTurn(S.cur, play().players.map((p) => p.turns));
  S.cur = next;
  if (skipped.length) say(SCEditGame.skipNote(S.names, skipped, next));
}

// A phone that joined by seat throws for its own player, on that player's
// turn only; otherwise it waits, the pad greyed, for the turn to come round.
const waiting = () => !fixing && !closed() && !SCShare.canScore(S.cur);

/* Undo, as in the other games: the turn being thrown is cleared first;
   then a change made to a turn since the last one was thrown is taken
   back; then the last turn comes off. A phone that joined by seat takes
   back its own player's, wherever it is in the log: everyone else's are
   theirs to take back. The scores follow, played through again. */
async function undoTurn() {
  if (fixing) { cancelFix(); say('Change cancelled'); return; }
  if (S.darts.length) {
    const thrownSoFar = S.darts.map(d => d.label).join(', ');
    const ok = await askConfirm(
      `This clears the ${S.darts.length} dart${S.darts.length > 1 ? 's' : ''} entered for this turn (${thrownSoFar}).`,
      'Clear turn');
    if (!ok) return;
    S.darts = []; S.mult = 1;
    render(); save();
    say('Current turn cleared');
    return;
  }

  const seat = SCShare.seat();
  const x = S.edits[S.edits.length - 1];
  if (x && x.after === S.log.length && (seat === null || x.p === seat)) {
    const ok = await askConfirm(`This puts ${S.names[x.p]}'s turn ${x.n} back to ${labels(x.from.darts)}${x.from.bust ? ' (bust)' : ''}.`, 'Undo change');
    if (!ok) return;
    S.edits.pop();
    const e = S.log[x.i];
    S.log[x.i] = { p: e.p, darts: x.from.darts, ...(x.from.bust ? { bust: true } : {}), ts: e.ts };
    reopen();
    say(`Undid the change to ${S.names[x.p]}'s turn ${x.n}`);
    return;
  }

  let j = S.log.length - 1;
  if (seat !== null) while (j >= 0 && S.log[j].p !== seat) j--;
  if (j < 0) { say('Nothing to undo'); return; }
  const t = play().turns[j], who = S.names[S.log[j].p];
  const okUndo = await askConfirm(
    `This rolls back ${who}'s last turn of ${t.bust ? 0 : t.pts}` +
    (t.bust ? ' (a bust)' : '') + `, back to ${t.before}.`,
    'Undo turn');
  if (!okUndo) return;

  const last = S.log.splice(j, 1)[0];
  // changes to turns after it move up with them; one to it goes with it
  S.edits = S.edits.filter((y) => y.i !== j).map((y) => ({ ...y, i: y.i > j ? y.i - 1 : y.i, after: Math.min(y.after, S.log.length) }));
  S.cur = last.p;
  reopen();
  say(`Undid ${who}'s ${t.bust ? 0 : t.pts}`);
}

// After an Undo: a game ended is open again, and shown as it now stands.
function reopen() {
  S.over = false;
  S.winner = null;
  $('winOverlay').classList.add('hidden');
  render(); save();
}

/* Which alternative the player has paged to, and the position it was paged
   for. Paging is deliberately transient — a thrown dart changes the target,
   and the old choice would no longer mean anything — so it is not saved. */
let coIdx = 0;
let coKey = '';

/* The chevron is drawn, not typed: ‹ and › carry uneven side bearings, so
   centring their advance width still leaves the ink visibly off-centre in the
   button. Both paths span x 9..15 of a 24-wide box, so each is centred and
   the pair mirrors exactly. */
function coArrow(dir, cls, label) {
  const d = dir > 0 ? 'M9 5.5 L15 12 L9 18.5' : 'M15 5.5 L9 12 L15 18.5';
  return `<button class="co-arrow ${cls}" data-co="${dir}" aria-label="${label} checkout">`
    + `<svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true">`
    + `<path d="${d}" fill="none" stroke="currentColor" stroke-width="2.6"`
    + ` stroke-linecap="round" stroke-linejoin="round"/></svg></button>`;
}

// left: where the turn so far leaves the player; opened: whether they are in
function renderCheckout(left, opened) {
  const box = $('checkout');
  const dartsLeft = MAX_DARTS - S.darts.length;
  const mustOpen = S.doubleIn && !opened;

  // none while a turn already thrown is being changed: it is history
  if (closed() || fixing || dartsLeft < 1 || left < 1) {
    box.className = 'checkout empty';
    box.innerHTML = '';
    return;
  }

  const paths = findFinishes(left, dartsLeft, S.doubleOut, mustOpen);
  if (paths.length) {
    const key = finishKey(left, dartsLeft, S.doubleOut, mustOpen);
    if (key !== coKey) { coKey = key; coIdx = 0; }
    coIdx = Math.min(Math.max(coIdx, 0), paths.length - 1);

    box.className = 'checkout';
    box.innerHTML =
      (coIdx > 0 ? coArrow(-1, 'prev', 'Previous') : '')
      + '<span class="co-label">Checkout</span>'
      + '<span class="co-darts">' + paths[coIdx].map(t => `<b>${t.label}</b>`).join('') + '</span>'
      + (coIdx < paths.length - 1 ? coArrow(1, 'next', 'Next') : '');
    return;
  }

  // only worth saying when a finish was even conceivable (bogey numbers)
  if (left <= maxFinish(dartsLeft, S.doubleOut)) {
    box.className = 'checkout empty';
    box.innerHTML = `<span class="co-none">No ${dartsLeft}-dart finish from ${left}</span>`;
    return;
  }

  // Still out of range. The box would otherwise sit blank for most of a leg,
  // so it explains itself instead — quietly, and only here.
  box.className = 'checkout empty hint';
  box.innerHTML = '<span class="co-hint">Checkout darts appear here once you’re in range</span>';
}

function showWin() {
  const solo = S.names.length === 1;
  const p = play().players[S.winner], name = S.names[S.winner];
  const avg = p.turns ? (p.points / p.turns).toFixed(1) : '0';
  $('winName').textContent = solo ? `${name} checked out!` : `${name} wins!`;
  $('winStats').textContent = `${S.start} down in ${p.turns} turns · ${avg} average`;
  $('rematchBtn').textContent = tid() ? 'Back to tournament' : solo ? 'Go again' : 'Rematch';
  $('newBtn').classList.toggle('hidden', !!tid());
  $('winOverlay').classList.remove('hidden');
}

/* ---------------- render ---------------- */

function render() {
  if (!S) return;

  const G = play();
  const t = current();
  const { pts, counted } = t;
  const solo = S.names.length === 1;
  // whose turn is on the pad: the one being thrown, or one being changed
  const up = fixing ? S.log[fixing.i].p : S.cur;
  const opened = fixing ? play(S, fixing.i).players[up].opened : G.players[S.cur].opened;
  const done = closed() && !fixing;

  // rule badges; double-in turns red until the player has opened
  $('badges').classList.toggle('hidden', !S.doubleIn && !S.doubleOut);
  $('bIn').classList.toggle('hidden', !S.doubleIn);
  $('bOut').classList.toggle('hidden', !S.doubleOut);
  if (S.doubleIn) {
    const needs = !opened && !done;
    $('bIn').classList.toggle('alert', needs);
    $('bIn').textContent = needs ? `${S.names[up]} needs a double to open` : 'Double in';
  }

  // scoreboard
  $('scoreboard').classList.toggle('solo', solo);
  // three or four across: the player on turn gets the wide card
  $('scoreboard').classList.toggle('crowded', S.names.length > 2);
  [0, 1, 2, 3].forEach(i => $('p' + i).classList.toggle('hidden', i >= S.names.length));

  G.players.forEach((p, i) => {
    const el = $('p' + i);
    const isTurn = i === up && !done;
    el.classList.toggle('active', isTurn);
    el.querySelector('.pname').textContent = S.names[i];
    el.querySelector('.pnum').textContent = p.score;

    // live projection of where this turn leaves them (not for a turn being
    // changed: the bar over the pad says where that one goes)
    const pend = el.querySelector('.ppend');
    const live = isTurn && !fixing && pts > 0;
    el.classList.toggle('pending', live);
    pend.classList.remove('bust', 'checkout');
    if (live) {
      if (t.bust) {
        pend.textContent = '→ bust';
        pend.classList.add('bust');
      } else {
        pend.textContent = '→ ' + t.left;
        if (t.win) pend.classList.add('checkout');
      }
    }

    const avg = p.turns ? (p.points / p.turns).toFixed(1) : '—';
    // two spans so a crowded scoreboard can stack them; CSS supplies the ' · '
    const meta = el.querySelector('.pmeta');
    meta.replaceChildren(document.createElement('span'), document.createElement('span'));
    meta.children[0].textContent = `${p.turns} turns`;
    meta.children[1].textContent = `avg ${avg}`;
  });

  // dart slots
  const slots = $('dartSlots');
  slots.innerHTML = '';
  for (let i = 0; i < MAX_DARTS; i++) {
    const d = S.darts[i];
    const el = document.createElement('div');
    // counted[i] === false means it landed before the double-in and scores nothing
    el.className = 'slot' + (d ? (counted[i] === false ? ' filled void' : ' filled') : '');
    el.textContent = d ? d.label : '–';
    slots.appendChild(el);
  }

  $('turnTotal').textContent = pts;

  document.querySelectorAll('.mult').forEach(b => {
    b.classList.toggle('is-on', parseInt(b.dataset.m, 10) === S.mult);
  });

  renderCheckout(t.after, opened);
  renderWinBar(G);
  renderFixBar(t);
  $('checkout').classList.toggle('hidden-by-bar', !!fixing || G.winner !== null);

  // submit button
  const btn = $('submitBtn');
  $('game').classList.toggle('waiting', waiting());
  $('game').classList.toggle('fixing', !!fixing);
  $('game').classList.toggle('closed', done);
  if (fixing) {
    btn.textContent = t.bust ? `Save the change — bust` : t.win ? `Save the change — checkout!` : `Save the change: ${pts}`;
  } else if (S.over) {
    btn.textContent = 'Game over';
  } else if (G.winner !== null) {
    btn.textContent = `${S.names[G.winner]} checked out`;
  } else if (waiting()) {
    btn.textContent = `${S.names[S.cur]}'s turn`;
  } else if (pts > 0 && t.bust) {
    btn.textContent = `Submit ${pts} — bust`;
  } else if (t.win) {
    btn.textContent = `Submit ${pts} — checkout!`;
  } else {
    btn.textContent = solo ? `Submit ${pts}` : `Submit ${pts} for ${S.names[S.cur]}`;
  }
}

// Changing a turn already thrown: whose, which, and where it now goes.
function renderFixBar(t) {
  $('fixBar').classList.toggle('hidden', !fixing);
  if (!fixing) return;
  const i = fixing.i, e = S.log[i], was = play(S, i + 1).turns[i];
  $('fixText').innerHTML = '';
  $('fixText').append(`Changing ${S.names[e.p]}'s turn ${was.n}`);
  const small = document.createElement('small');
  small.textContent = `Was ${labels(e.darts)}${was.bust ? ', a bust' : ''}: ${was.before} → ${was.left}. Now ${t.bust ? 'a bust' : `${was.before} → ${t.left}`}.`;
  $('fixText').append(small);
}

/* ---------------- boot ---------------- */

buildSetup();
buildBoard();

/* Shared by link (see /share.js): the game on screen, and how to show a
   newer one when it comes in from another phone. */
SCShare.attach({
  type: TYPE,
  get: () => S,
  me: (st) => { st = upgrade(st); return st.names.length > 1 ? st.me : null; },
  apply: applyShared,
  /* Shared by seat: a cell a turn, '<player>:<turn>', counted per player,
     holding its darts, and marked when it was marked bust by hand. The
     points and whether it busted go too, for phones still on darts' first
     shape, which read them; this one works them out. */
  cells: {
    names: (st) => upgrade(st).names,
    of: (st) => {
      st = upgrade(st);
      const G = play(st), out = {}, seen = [];
      st.log.forEach((e, i) => {
        const n = (seen[e.p] = (seen[e.p] || 0) + 1), t = G.turns[i];
        out[`${e.p}:${n}`] = { darts: e.darts || [], marked: !!e.bust, pts: t.bust ? 0 : t.pts, bust: t.bust };
      });
      return out;
    },
    build: fromCells,
  },
});

/* A game rebuilt from its turns (see /share.js): each player's turns in
   order, round the table, played through as on every phone. A turn that
   differs from the one this phone had is a change made on another phone,
   and goes in the history as one made here would. Whose turn it is
   follows: the first with the fewest turns. A game ended here stays ended
   while the turns still say who won. */
function fromCells(base, list) {
  base = upgrade(base);
  const n = base.names.length, cells = [];
  list.forEach(({ key, value }, k) => {
    const [p, t] = key.split(':').map(Number);
    if (p >= 0 && p < n && t >= 1 && value) cells.push({ p, t, k, v: value });
  });
  cells.sort((a, b) => a.t - b.t || a.k - b.k);

  const keyOf = (log, i) => `${log[i].p}:${log.slice(0, i + 1).filter((e) => e.p === log[i].p).length}`;
  const before = {};
  base.log.forEach((e, i) => { before[keyOf(base.log, i)] = e; });

  const st = { ...base, log: [], edits: [] };
  for (const { p, v } of cells) {
    const e = { p, darts: Array.isArray(v.darts) ? v.darts : [], ts: 0 };
    // marked bust by hand; a phone on the first shape says bust for any
    if (v.marked || (!('marked' in v) && v.bust)) e.bust = true;
    st.log.push(e);
  }
  if (cells.some(({ v }) => !('marked' in v))) keepMarkedBusts(st);

  // changes already known here keep their place; new ones from elsewhere join them
  const at = (p, nth) => st.log.findIndex((e, i) => e.p === p && keyOf(st.log, i) === `${p}:${nth}`);
  st.edits = (base.edits || []).map((x) => ({ ...x, i: at(x.p, x.n) })).filter((x) => x.i >= 0);
  st.log.forEach((e, i) => {
    const key = keyOf(st.log, i), was = before[key];
    if (was) e.ts = was.ts || 0;
    const from = was && { darts: was.darts || [], bust: !!was.bust }, to = { darts: e.darts, bust: !!e.bust };
    if (from && JSON.stringify(from) !== JSON.stringify(to)) {
      st.edits.push({ i, p: e.p, n: Number(key.split(':')[1]), from, to, after: st.log.length, ts: Date.now() });
    }
  });

  const G = play(st);
  const fewest = Math.min(...G.players.map((p) => p.turns));
  st.cur = G.players.findIndex((p) => p.turns === fewest);
  if (st.over && G.winner === null) { st.over = false; st.winner = null; }
  return st;
}

/* A newer game from another phone. The darts this phone has entered for
   the turn on the oche carry over, while that turn is still waiting: the
   same player up, no turn entered since. If the turn has been entered on
   the other phone meanwhile, these darts are let go, and it says so. A
   turn being changed here is let go too. */
function applyShared(st) {
  if (fixing) { endFix(); say('The game changed on another phone: the change was let go'); }
  st = upgrade(st);
  const mine = S && !closed() && (S.darts.length || S.mult !== 1)
    ? { darts: S.darts, mult: S.mult, cur: S.cur, turns: play().players[S.cur].turns } : null;
  const wasOut = S && checkedOut();
  S = st;
  if (mine) {
    // still that player's turn to throw: no turn of theirs entered since
    if (!closed() && play().players[mine.cur].turns === mine.turns) {
      S.darts = mine.darts;
      S.mult = mine.mult;
      S.cur = mine.cur;
    } else if (mine.darts.length) {
      say(`${S.names[mine.cur]}'s turn was entered on another phone`);
    }
  }
  save();
  showGame();
  // the turn that came in was a checkout: offered here too
  if (checkedOut() && !wasOut && !S.over) say(`${S.names[play().winner]} checked out!`);
  if (S.over) showWin();
}

openFromUrl();
