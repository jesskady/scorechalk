/* Score Chalk — cribbage for two or three players, first to 121.

   A hand is two phases. In the play (pegging) every tap scores at once,
   under the player who scored it. In the count each hand is scored on its
   own, in the order the rules count them — players left of the dealer, then
   the dealer's hand, then the crib — and submitted before the next. The
   game ends the moment anyone reaches 121, so a non-dealer who counts out
   wins before the dealer's hand or crib is ever counted. */

// games are kept by id, every kind together: see /store.js
const TYPE = 'cribbage';
const NAMES_KEY = 'cribbage-names-v1';
const WIN = 121;
const COLORS = ['#d9534f', '#2e9e63', '#3b82f6'];   // red, green, blue
// A player's peg colour is theirs: it goes with them when Edit puts them in
// another place (S.colors, by place; a game never edited has none).
const colorOf = (p) => COLORS[S && S.colors ? S.colors[p] : p];

// Points available while pegging, in the sections they are laid out in:
// the four that come up every play, then of-a-kinds, then runs. Each is
// [id, what the key says, what the history says, points]. Under a section
// heading a key only needs its number, so "Of a kind: 3" logs as
// "3 of a kind". Heels is added for the dealer separately.
const PLAY = {
  common: [
    ['go', 'Go', 'Go', 1], ['31', '31', '31', 2],
    ['15', '15', '15', 2], ['last', 'Last card', 'Last card', 1],
  ],
  kind: [
    ['pair', '2', 'Pair', 2], ['three', '3', '3 of a kind', 6], ['four', '4', '4 of a kind', 12],
  ],
  runs: [
    ['run3', '3', 'Run of 3', 3], ['run4', '4', 'Run of 4', 4],
  ],
  longRuns: [
    ['run5', '5', 'Run of 5', 5], ['run6', '6', 'Run of 6', 6], ['run7', '7', 'Run of 7', 7],
  ],
};

// Points in a hand or the crib. A crib flush only counts with all five
// cards, so Flush 4 is for hands only. Double runs are just two taps.
const COUNT = [
  ['15', '15', 2], ['pair', 'Pair', 2],
  ['three', '3 kind', 6], ['four', '4 kind', 12],
  ['run3', 'Run 3', 3], ['run4', 'Run 4', 4],
  ['run5', 'Run 5', 5], ['flush4', 'Flush 4', 4],
  ['flush5', 'Flush 5', 5], ['knobs', 'Knobs', 1],
];

// Runs with pairs folded in, counted as one by anyone who has played much:
// 2 3 3 4 is "a double run for 8", not two runs of three and a pair. These
// four are every way a five-card hand can hold one. [id, name, example, points]
//
// The examples are kept under 15 in total on purpose: cards adding to 14 or
// less cannot make a fifteen, so each example scores exactly what its key
// adds and nothing more. 6 7 7 8 would really be 12 with its fifteens, and
// would suggest the key counts those too. It does not: fifteens, flushes and
// knobs are still tapped on their own.
const COMBOS = [
  ['dblrun', 'Double run', '2 3 3 4', 8],
  ['dblrun4', 'Double run of 4', 'A 2 3 4 4', 10],
  ['triplerun', 'Triple run', '2 2 2 3 4', 15],
  ['dbldbl', 'Double double', '2 2 3 3 4', 16],
];

// any count key by id: [id, name, points]
const COUNT_KEYS = Object.fromEntries([
  ...COUNT.map(([id, label, pts]) => [id, { label, pts }]),
  ...COMBOS.map(([id, label, , pts]) => [id, { label, pts }]),
]);

// No five cards make these, so a total like this is a mis-tap.
const IMPOSSIBLE = new Set([19, 25, 26, 27]);
const MAX_HAND = 29;

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

let S = null;            // the game; null on the setup screen
let me = null;           // the signed-in user, for saving to the profile
let msgTimer = null;

/* ---------------- state ----------------

   A game is what was scored, in order, as in the other games. Everything
   else is worked out from it by play(): each player's score and back peg,
   which hand it is and who deals, the play or the count and whose count is
   up, whether heels is still there to claim, and who reached 121 first. So
   Undo takes the last thing off, a change to a score is played through
   again, and the deal and the count follow.

     id, startedAt       chosen here, so saving the game twice updates one
                         row on the profile rather than adding a second
     names, me, colors   the players round the table; which is you; each
                         one's peg colour, once Edit has moved a player
     firstDealer         who dealt the first hand: the deal goes round
     log                 everything scored, in order: { p, pts, kind, label,
                         ts }, kind 'play' or 'heels' as pegged, 'hand' or
                         'crib' as counted (with what it was counted from:
                         taps, typed, cards, answers); and { kind: 'count' },
                         the play done and the count begun. A score taken
                         out with History's Remove stays, gone: true.
     edits               scores changed since: { i, p, from, to, after, ts },
                         from and to the score as it was and is (to null
                         when removed); see fixScore
     pend                the hand being counted (see freshPend)
     over, winner        ended with End game, and who won
     sum                 each player's score and the hand, for the pages
                         that read a game without playing it through (the
                         home page); written by save() */

function newGame(names, dealer) {
  return {
    id: crypto.randomUUID(),
    startedAt: Date.now(),
    names,
    firstDealer: dealer,
    log: [],
    edits: [],
    pend: freshPend(),
    over: false,
    winner: null,
  };
}

const counted = (e) => e.kind === 'hand' || e.kind === 'crib';

// The count, in order: each player left of the dealer, the dealer, the crib.
function countOrder(dealer, n = S.names.length) {
  const seq = [];
  for (let k = 1; k < n; k++) seq.push({ p: (dealer + k) % n, kind: 'hand' });
  seq.push({ p: dealer, kind: 'hand' }, { p: dealer, kind: 'crib' });
  return seq;
}

/* The game played through from what was scored (the first `upto` things):
   where it stands, and each score as it went (rows: its hand, and the
   score it took its player from and to). A hand ends when its crib is
   counted: the deal passes to the left. Someone at 121 has won, whatever
   is still to be scored. */
function play(st = S, upto = st.log.length) {
  const n = st.names.length;
  const scores = st.names.map(() => 0), prev = st.names.map(() => 0);
  let hand = 1, phase = 'play', step = 0, heels = true, winner = null;
  const rows = [];
  for (const e of st.log.slice(0, upto)) {
    if (e.kind === 'count') { rows.push({ hand }); phase = 'count'; step = 0; continue; }
    if (e.gone || !(e.p >= 0 && e.p < n)) { rows.push({ hand, gone: true }); continue; }
    const before = scores[e.p];
    prev[e.p] = before;
    scores[e.p] += e.pts;
    rows.push({ hand, before, after: scores[e.p] });
    // heels is once a hand, and only before the play starts scoring
    if (e.kind === 'play' || e.kind === 'heels') heels = false;
    if (winner === null && scores[e.p] >= WIN) winner = e.p;
    if (counted(e) && ++step >= n + 1) { hand += 1; phase = 'play'; step = 0; heels = true; }
  }
  const dealer = (st.firstDealer + hand - 1) % n;
  return { scores, prev, hand, dealer, phase, step, heels, winner, rows, n };
}

// The game as it now stands, worked out again whenever it changes (see
// refresh): render and the rest read it rather than play the game through.
let G = null;
const refresh = () => { G = S ? play() : null; return G; };

// Someone has reached 121: the pegs wait for End game, or an Undo. Ended
// with End game, the game is over.
const closed = () => S.over || G.winner !== null;

/* A game kept in cribbage's first shape (the board kept as it went —
   scores, back pegs, the deal, the phase — and a copy of all of it before
   every score, for Undo) in this one: what was scored, with the count
   begun put where each hand's counting starts. Games on a device, on the
   profile or in a shared link may be in it. Anything already in this shape
   comes back as it was. */
function upgrade(st) {
  if (!st) return st;
  if (!('undo' in st) && !('scores' in st)) {
    if (!st.edits) st.edits = [];
    return st;
  }
  const n = st.names.length;
  const { undo, scores, prev, dealer, hand, phase, step, heels, ...rest } = st;
  const log = [];
  let begun = 0;
  for (const e of st.log || []) {
    const { after, hand: h, ...keep } = e;
    if (counted(e) && begun !== h) { log.push({ kind: 'count' }); begun = h; }
    log.push(keep);
  }
  if (phase === 'count' && begun !== hand) log.push({ kind: 'count' });
  const first = Number.isInteger(st.firstDealer) ? st.firstDealer : (((dealer || 0) - ((hand || 1) - 1)) % n + n) % n;
  return {
    ...rest, firstDealer: first, log, edits: [],
    pend: st.pend || freshPend(),
    over: !!st.over, winner: st.over && st.winner != null ? st.winner : null,
  };
}

// The hand being counted: buttons tapped or a total typed (Buttons mode),
// and the cards entered so far (Cards mode). The two are kept apart — what
// is entered on one never shows up on the other — and the hand submitted is
// whichever is on screen. Switching back and forth changes neither.
// A starter passed in is carried from the hand counted before: the same
// card is cut for every hand and the crib of a deal, so it is entered once.
function freshPend(starter) {
  const cards = CribCounter.fresh();
  if (starter) { cards.slots[4] = starter; cards.carried = true; }
  return { taps: [], typed: null, cards };
}

// The starter this deal, if it has been entered.
const knownStarter = () => (S.pend.cards && S.pend.cards.slots[4]) || null;

/* Each mode's Clear clears its own entry and nothing else. Clearing the
   cards keeps a carried starter: it belongs to the deal, not this hand. */
function clearCards() {
  const c = S.pend.cards;
  S.pend.cards = freshPend(c && c.carried ? c.slots[4] : null).cards;
  save(); render();
}

function clearButtons() {
  S.pend.taps = [];
  S.pend.typed = null;
  $('typedTotal').value = '';
  save(); render();
}

/* Cards or Buttons: how the hand card scores a hand. A preference of the
   person holding the phone, not of the game, so it lives outside it. */
const MODE_KEY = 'cribbage-hand-mode';
let handMode = (() => { try { return localStorage.getItem(MODE_KEY) || 'cards'; } catch (e) { return 'cards'; } })();

/* Simple or Detailed: how the play is scored. Detailed has a key for every
   kind of score; Simple is +1, +2 and +3, since nearly everything pegged is
   one of those, and bigger scores are a few taps. Also a preference of the
   person holding the phone. */
const PLAY_MODE_KEY = 'cribbage-play-mode';
let playMode = (() => { try { return localStorage.getItem(PLAY_MODE_KEY) || 'detailed'; } catch (e) { return 'detailed'; } })();

/* Kept on this device and, signed in, on the profile (see /cloud.js), as
   every game is: a moment after each change, all of it. The summary goes
   with it for the pages that read a game without playing it through. */
function save() {
  if (!S) return;
  refresh();
  S.sum = { scores: G.scores, hand: G.hand };
  SCStore.put(TYPE, S, !!S.over);
  if (window.SCCloud) SCCloud.keep(cloudGame);
}

// The game as the profile keeps it: its history, and its own state to pick
// it up again by. Nothing until there is a score in it.
const cloudGame = () => (S && S.log.some((e) => e.p != null) ? { ...toPayload(), state: S } : null);

// The newest game of this kind in progress here, for the setup's Resume.
function load() {
  const g = SCStore.latest(TYPE);
  return g ? upgrade(g.state) : null;
}

// A game on screen has its id in the address: a link to it opens it.
function openGame(state) {
  S = upgrade(state);
  refresh();
  SCStore.show(S.id);
  showGame();
}

// Leaving a game: back to the setup, the address without it.
function leaveGame() {
  location.replace(location.pathname);
}

/* Every score goes through here, put down as it was scored; the board,
   the deal and the count follow from it (see play). */
function score(p, pts, kind, label, extra) {
  S.log.push({ p, pts, kind, label, ...extra, ts: Date.now() });
  refresh();
}

/* ---------------- setup ---------------- */

let setupN = 2, setupDealer = 0;
let setupMe = SCShare.lastMe();   // who is holding the phone: see /share.js
let setupNames = (() => {
  try { return JSON.parse(localStorage.getItem(NAMES_KEY)) || ['', '', '']; }
  catch (e) { return ['', '', '']; }
})();

const nameOf = (i) => (setupNames[i] || '').trim() || `Player ${i + 1}`;

function renderSetup() {
  document.querySelectorAll('#countRow .seg').forEach((b) =>
    b.classList.toggle('is-on', Number(b.dataset.n) === setupN));

  const box = $('names');
  box.innerHTML = '';
  for (let i = 0; i < setupN; i++) {
    const row = document.createElement('li');
    row.innerHTML = `<span class="dot" style="background:${COLORS[i]}"></span>`;
    const inp = document.createElement('input');
    inp.type = 'text'; inp.maxLength = 14; inp.autocomplete = 'off';
    inp.className = 'roster-name';
    inp.setAttribute('aria-label', `Player ${i + 1}'s name`);
    inp.placeholder = `Player ${i + 1}`;
    inp.value = setupNames[i] || '';
    inp.addEventListener('input', () => {
      setupNames[i] = inp.value;
      try { localStorage.setItem(NAMES_KEY, JSON.stringify(setupNames)); } catch (e) {}
      renderDealRow();
      renderYou();
    });
    // a grip, to drag the player up or down the list (see /roster.js)
    row.append(inp, SCRoster.grip(`Move ${nameOf(i)}`));
    box.appendChild(row);
  }
  renderDealRow();
  renderYou();
  $('resumeBtn').classList.toggle('hidden', !load());
}

/* The order of the list is the order round the table: the deal passes
   down it. A player moved takes the deal and You are with them; the peg
   colours stay with the places, as the game's are given out that way. */
SCRoster.sortable($('names'), (from, to) => {
  while (setupNames.length < setupN) setupNames.push('');
  const move = (a) => a.splice(to, 0, a.splice(from, 1)[0]);
  move(setupNames);
  const order = setupNames.map((_, i) => i);
  move(order);
  setupDealer = order.indexOf(setupDealer);
  if (setupMe !== null) { setupMe = order.indexOf(setupMe); SCShare.rememberMe(setupMe); }
  try { localStorage.setItem(NAMES_KEY, JSON.stringify(setupNames)); } catch (e) {}
  renderSetup();
});

function renderYou() {
  if (setupMe !== null && setupMe >= setupN) setupMe = 0;
  const names = Array.from({ length: setupN }, (_, i) => nameOf(i));
  SCShare.youAre($('youRow'), names, setupMe, (i) => { setupMe = i; SCShare.rememberMe(i); renderYou(); });
}

function renderDealRow() {
  if (setupDealer >= setupN) setupDealer = 0;
  const row = $('dealRow');
  row.innerHTML = '';
  for (let i = 0; i < setupN; i++) {
    const b = document.createElement('button');
    b.className = 'seg' + (i === setupDealer ? ' is-on' : '');
    b.textContent = nameOf(i);
    b.onclick = () => { setupDealer = i; renderDealRow(); };
    row.appendChild(b);
  }
}

$('countRow').addEventListener('click', (e) => {
  const b = e.target.closest('[data-n]');
  if (!b) return;
  setupN = Number(b.dataset.n);
  renderSetup();
});

/* ---------------- how to score: chosen before the first hand ----------------

   Start Game asks two things, a screen each: how the play is scored, and
   how hands are counted. Both have always been switchable during the game,
   but a switch you have never noticed is no choice at all — so each is
   offered here, with a picture of what it looks like, and the choice made
   last time marked. Tapping one sets it (remembered on the device, as the
   switches in the game do) and moves on. */
const PICKS = [
  { title: 'How do you want to score the play?',
    lede: 'Pegging: the points scored as the cards are played.',
    note: 'You can switch any time during the game, with Simple · Detailed above the players.',
    key: PLAY_MODE_KEY, get: () => playMode, set: (m) => { playMode = m; try { localStorage.setItem(PLAY_MODE_KEY, m); } catch (e) {} },
    opts: [
      { mode: 'simple', label: 'Simple', text: 'Three buttons, +1, +2 and +3, with a reminder of what each covers. Bigger scores are a few taps.' },
      { mode: 'detailed', label: 'Detailed', text: 'A button for every kind of score: fifteen, pairs, runs, go, 31 and last card.' },
    ] },
  { title: 'How do you want to count hands?',
    lede: 'The count: each hand, then the crib, after the play.',
    note: 'You can switch any time during the game, with Cards · Buttons on each hand.',
    key: MODE_KEY, get: () => handMode, set: (m) => { handMode = m; try { localStorage.setItem(MODE_KEY, m); } catch (e) {} },
    opts: [
      { mode: 'cards', label: 'Cards', text: 'Tap the cards in the hand and the starter, and it counts the hand for you.' },
      { mode: 'buttons', label: 'Buttons', text: "Tap the fifteens, pairs and runs you find, or type the hand's total." },
    ] },
];
let pickAt = 0;
// whether this phone has a choice of its own yet, rather than the default
const chosen = (key) => { try { return localStorage.getItem(key) !== null; } catch (e) { return false; } };

function showPick(i) {
  pickAt = i;
  const k = PICKS[i], now = chosen(k.key) ? k.get() : null;
  $('pickStep').textContent = `${i + 1} of ${PICKS.length}`;
  $('pickTitle').textContent = k.title;
  $('pickLede').textContent = k.lede;
  $('pickNote').textContent = k.note;
  $('pickOpts').innerHTML = k.opts.map((o) => `
    <button class="pick-opt${o.mode === now ? ' is-current' : ''}" type="button" data-mode="${o.mode}">
      <img src="previews/${i === 0 ? 'play' : 'hand'}-${o.mode}.webp" alt="${esc(o.label)}: ${esc(o.text)}" loading="lazy">
      <span class="pick-label"><b>${esc(o.label)}</b>${o.mode === now ? '<i>Last time</i>' : ''}</span>
      <span class="pick-text">${esc(o.text)}</span>
    </button>`).join('');
  $('setup').classList.add('hidden');
  $('pick').classList.remove('hidden');
  window.scrollTo(0, 0);
}

$('pickOpts').addEventListener('click', (e) => {
  const b = e.target.closest('[data-mode]');
  if (!b) return;
  PICKS[pickAt].set(b.dataset.mode);
  if (pickAt + 1 < PICKS.length) { showPick(pickAt + 1); return; }
  $('pick').classList.add('hidden');
  beginGame();
});

$('pickBack').onclick = () => {
  if (pickAt > 0) { showPick(pickAt - 1); return; }
  $('pick').classList.add('hidden');
  $('setup').classList.remove('hidden');
};

$('startBtn').onclick = () => showPick(0);

function beginGame() {
  // a new game of its own: any in progress stay, under Pick up where you left off
  S = newGame(Array.from({ length: setupN }, (_, i) => nameOf(i)), setupDealer);
  S.me = setupMe;
  save();
  openGame(S);
}

$('resumeBtn').onclick = () => { const s = load(); if (s) openGame(s); };

/* ---------------- the board ----------------

   Three streets of forty holes, run as one serpentine: left to right, back,
   and left to right again, with the finish hole past the end of the third.
   Each player has a lane through all three. The outside lane of the first
   turn stays outside, as on a real board, so lanes swap sides on the second
   street. Positions are 0 (the start) to 121 (the finish). */

const B = { xa: 36, dx: 10, L: 9.5, gap: 15, top: 11 };

function geometry(n) {
  const sh = n * B.L;                      // one street's height
  const y = [B.top, B.top + sh + B.gap, B.top + 2 * (sh + B.gap)];
  const xb = B.xa + 39 * B.dx;
  // a lane's centre line on each street
  const laneY = (p) => [
    y[0] + p * B.L + B.L / 2,
    y[1] + (n - 1 - p) * B.L + B.L / 2,
    y[2] + p * B.L + B.L / 2,
  ];
  return { sh, y, xb, laneY, w: xb + 34, h: y[2] + sh + 10 };
}

function pegAt(g, p, s) {
  const ly = g.laneY(p);
  if (s <= 0) return { x: B.xa - 16, y: ly[0] };
  if (s >= WIN) return { x: g.xb + 22, y: g.y[2] + g.sh / 2 };
  if (s <= 40) return { x: B.xa + (s - 1) * B.dx, y: ly[0] };
  if (s <= 80) return { x: g.xb - (s - 41) * B.dx, y: ly[1] };
  return { x: B.xa + (s - 81) * B.dx, y: ly[2] };
}

function buildBoard() {
  const n = S.names.length, g = geometry(n);
  const svg = $('board');
  svg.setAttribute('viewBox', `0 0 ${g.w} ${g.h}`);
  let out = '';

  // lanes: one stroked path each, through both turns
  for (let p = 0; p < n; p++) {
    const ly = g.laneY(p);
    const r1 = (ly[1] - ly[0]) / 2, r2 = (ly[2] - ly[1]) / 2;
    out += `<path d="M ${B.xa - 6} ${ly[0]} H ${g.xb} A ${r1} ${r1} 0 0 1 ${g.xb} ${ly[1]}
      H ${B.xa} A ${r2} ${r2} 0 0 0 ${B.xa} ${ly[2]} H ${g.xb + 6}"
      fill="none" stroke="${colorOf(p)}" stroke-opacity=".38" stroke-width="${B.L - 0.6}"/>`;
  }

  // every fifth hole gets a divider across the street, every tenth a number
  for (let s = 0; s < 3; s++) {
    for (let i = 5; i < 40; i += 5) {
      const x = s === 1 ? g.xb - (i - 0.5) * B.dx : B.xa + (i - 0.5) * B.dx;
      out += `<line x1="${x}" x2="${x}" y1="${g.y[s] - 1}" y2="${g.y[s] + g.sh + 1}" class="tick"/>`;
    }
    for (let i = 10; i <= 40; i += 10) {
      const hole = s * 40 + i;
      const x = s === 1 ? g.xb - (i - 1) * B.dx : B.xa + (i - 1) * B.dx;
      out += `<text x="${x}" y="${g.y[s] - 2.5}" class="num">${hole}</text>`;
    }
  }

  // holes
  for (let p = 0; p < n; p++) {
    for (let s = 1; s <= 120; s++) {
      const { x, y } = pegAt(g, p, s);
      out += `<circle cx="${x}" cy="${y}" r="1.6" class="hole"/>`;
    }
  }

  // start and finish
  out += `<text x="${B.xa - 16}" y="${g.y[0] - 2.5}" class="num">S</text>`;
  out += `<circle cx="${g.xb + 22}" cy="${g.y[2] + g.sh / 2}" r="4.6" class="finish"/>`;
  out += `<text x="${g.xb + 22}" y="${g.y[2] - 2.5}" class="num">121</text>`;

  // pegs: back peg first, so the front one sits on top
  for (let p = 0; p < n; p++) {
    out += `<circle id="back${p}" r="3.8" class="peg-back" stroke="${colorOf(p)}"/>`;
    out += `<circle id="peg${p}" r="4.8" class="peg" fill="${colorOf(p)}"/>`;
  }
  svg.innerHTML = out;
  svg.dataset.n = n;
}

function placePegs() {
  const g = geometry(S.names.length);
  S.names.forEach((_, p) => {
    const a = pegAt(g, p, Math.min(G.scores[p], WIN));
    const b = pegAt(g, p, Math.min(G.prev[p], WIN));
    $('peg' + p).setAttribute('cx', a.x); $('peg' + p).setAttribute('cy', a.y);
    $('back' + p).setAttribute('cx', b.x); $('back' + p).setAttribute('cy', b.y);
    // a back peg sitting under the front one is just clutter
    $('back' + p).style.display = G.prev[p] === G.scores[p] ? 'none' : '';
  });
}

/* ---------------- game screen ---------------- */

function showGame() {
  SCAwake.keep(true);     // the screen stays on through the game: see /awake.js
  // a game saved before Cards mode existed has no cards in its hand yet
  if (!S.pend.cards) S.pend.cards = CribCounter.fresh();
  refresh();
  $('setup').classList.add('hidden');
  $('game').classList.remove('hidden');
  buildBoard();
  buildPlayers();
  buildHandPad();
  render();
  if (S.over) showWin();
}

function buildPlayers() {
  const box = $('players');
  box.className = 'players' + (S.names.length === 3 ? ' three' : '');
  box.innerHTML = '';
  S.names.forEach((name, p) => {
    const col = document.createElement('div');
    col.className = 'pcol';
    col.style.setProperty('--pc', colorOf(p));
    col.innerHTML = `
      <div class="phead">
        <span class="pname">${esc(name)}</span>
        <span class="pscore"></span>
        <div class="prow"><span class="pmeta"></span></div>
      </div>
      <div class="ppad"></div>`;
    const pad = col.querySelector('.ppad');
    // Heels lives in the dealer's header, beside the Dealer badge, rather
    // than above the keys: it comes and goes each hand, and anything that
    // appeared above the keys would shift them under a finger mid-play.
    const heels = document.createElement('button');
    heels.className = 'heels';
    heels.innerHTML = '<b>Heels</b> +2';
    heels.onclick = () => peg(p, 'heels', 'Heels', 2, 'heels');
    col.querySelector('.prow').appendChild(heels);

    const grid = (keys, cls) => {
      const g = document.createElement('div');
      g.className = 'pgrid ' + cls;
      for (const [id, key, label, pts] of keys) g.appendChild(padKey(key, pts, () => peg(p, id, label, pts)));
      return g;
    };
    const section = (title, ...grids) => {
      const sec = document.createElement('div');
      sec.className = 'psec';
      sec.innerHTML = `<span class="psec-label">${title}</span>`;
      sec.append(...grids);
      return sec;
    };
    pad.append(
      grid(PLAY.common, 'g2'),
      section('Of a kind', grid(PLAY.kind, 'g3 sm')),
      section('Run of', grid(PLAY.runs, 'g2'), grid(PLAY.longRuns, 'g3 sm')),
    );

    // Simple: three big keys. The history can only say "+2", not whether
    // it was a fifteen or a pair, so that is what it records.
    const simple = document.createElement('div');
    simple.className = 'psimple';
    for (const pts of [1, 2, 3]) {
      const b = document.createElement('button');
      b.className = 'skey';
      b.textContent = '+' + pts;
      b.onclick = () => peg(p, 'peg' + pts, 'Peg', pts);
      simple.appendChild(b);
    }
    col.appendChild(simple);
    box.appendChild(col);
  });
}

function padKey(label, pts, onTap) {
  const b = document.createElement('button');
  b.className = 'pkey';
  b.innerHTML = `<b>${esc(label)}</b><small>+${pts}</small>`;
  b.onclick = onTap;
  return b;
}

function buildHandPad() {
  const add = (id) => () => {
    S.pend.typed = null;
    $('typedTotal').value = '';
    S.pend.taps.push(id);
    save(); render();
  };
  const pad = $('handPad');
  pad.innerHTML = '';
  for (const [id, label, pts] of COUNT) {
    const b = padKey(label, pts, add(id));
    b.dataset.id = id;
    pad.appendChild(b);
  }
  // the example cards say which combination a name means, at a glance
  const combos = $('comboPad');
  combos.innerHTML = '';
  for (const [id, label, cards, pts] of COMBOS) {
    const b = document.createElement('button');
    b.className = 'pkey combo';
    b.dataset.id = id;
    b.innerHTML = `<b>${esc(label)}</b><span class="cards">${esc(cards)}</span><small>+${pts}</small>`;
    b.onclick = add(id);
    combos.appendChild(b);
  }
}

// a tap in the play: scores at once, or, changing a score, is what it was
function peg(p, id, label, pts, kind = 'play') {
  if (fixing) { fixPeg(p, id, label, pts, kind); return; }
  if (closed()) return;
  // a phone scoring one player pegs that player only
  if (!SCShare.canScore(p)) { flash(`${S.names[p]} pegs on their own phone`); return; }
  score(p, pts, kind, label, { id });
  save(); render();
  flash(G.winner !== null ? `${S.names[G.winner]} reached ${WIN}!` : `${S.names[p]} ${label} +${pts}`);
}

const tapValue = (id) => COUNT_KEYS[id].pts;
let cardResult = null;      // Cards mode's verdict on the hand, from the last render

// The hand's total so far, or null while Cards mode is still waiting on a
// card or an answer.
function pendTotal() {
  if (handMode === 'cards') return cardResult && cardResult.state === 'scored' ? cardResult.total : null;
  return S.pend.typed != null ? S.pend.typed : S.pend.taps.reduce((t, id) => t + tapValue(id), 0);
}

function render() {
  refresh();
  const seq = countOrder(G.dealer);
  // a count being changed shows its hand card; a peg being changed, the pegs
  const fixCount = fixing && counted(S.log[fixing.i]);
  const fixPegs = fixing && !fixCount;
  const counting = (G.phase === 'count' || fixCount) && !fixPegs;
  const up = fixCount ? { p: S.log[fixing.i].p, kind: S.log[fixing.i].kind } : counting ? seq[G.step] : null;
  const done = closed() && !fixing;

  placePegs();

  $('phaseHand').innerHTML = `Hand ${G.hand} · <b>${esc(S.names[G.dealer])}</b> deals`;
  $('stepPlay').classList.toggle('is-on', G.phase !== 'count');
  $('stepCount').classList.toggle('is-on', G.phase === 'count');

  // leader, for the headers
  const top = Math.max(...G.scores);
  const lead = G.scores.filter((s) => s === top).length === 1 && top > 0 ? G.scores.indexOf(top) : -1;

  [...$('players').children].forEach((col, p) => {
    col.querySelector('.pscore').textContent = G.scores[p];
    const meta = [];
    if (p === G.dealer) meta.push('<span class="badge-d">Dealer</span>');
    // the lead gives way to Heels while it is live: one row, no wrapping
    if (p === lead && !(p === G.dealer && G.heels && !counting)) meta.push(`<span class="lead">+${top - Math.max(...G.scores.filter((_, i) => i !== p))}</span>`);
    col.querySelector('.pmeta').innerHTML = meta.join('');
    col.classList.toggle('counting', !!up && up.p === p);
    // a phone scoring one player: everyone else's pegging greyed
    col.classList.toggle('locked', !counting && !SCShare.canScore(p));
    col.querySelector('.ppad').classList.toggle('hidden', counting || playMode !== 'detailed');
    col.querySelector('.psimple').classList.toggle('hidden', counting || playMode !== 'simple');
    // heels is claimed during the play; once counting starts the chance has gone
    const heelsLive = p === G.dealer && G.heels && !counting && !done;
    col.querySelector('.heels').classList.toggle('hidden', !heelsLive);
  });

  renderPlayMode(counting);
  $('countBox').classList.toggle('hidden', !counting || done);
  // Cards first: its verdict is what the total and the main button read
  cardResult = counting && !done && handMode === 'cards' ? CribCounter.draw(S.pend.cards, up.kind === 'crib') : null;
  if (counting && !done) renderCount(seq, up);

  // The big button below is the play's alone; a hand is submitted from
  // inside the hand card (see renderSubmit).
  const main = $('mainBtn');
  main.classList.toggle('hidden', counting || done || !!fixing);
  main.textContent = 'Done with the play — count hands';

  $('game').classList.toggle('closed', done);
  $('game').classList.toggle('fixing', !!fixing);
  renderWinBar();
  renderFixBar();
  renderHistory();
}

/* The hand's submit button. It lives inside the hand card, right under
   what you tap — the ranks in Cards mode, the typed total in Buttons — so
   it stays put while the breakdown grows below it. In Cards mode it gives
   its place to a suit question while one is open. */
const handSubmit = document.createElement('button');
handSubmit.className = 'primary big hand-submit';
handSubmit.onclick = () => {
  if (handSubmit.disabled) return;
  if (fixing) saveCount(); else if (!closed()) submitHand();
};

function renderSubmit(up) {
  const cards = handMode === 'cards';
  const home = cards ? CribCounter.mainSlot() : $('buttonsBox');
  if (handSubmit.parentNode !== home) home.appendChild(handSubmit);
  handSubmit.classList.toggle('hidden', cards && cardResult && cardResult.state === 'asking');

  const t = pendTotal();
  const who = up.kind === 'crib' ? `${S.names[up.p]}'s crib` : S.names[up.p];
  $('game').classList.toggle('waiting', waiting());
  if (waiting()) {
    handSubmit.textContent = `Waiting for ${up.kind === 'crib' ? who : `${who}'s hand`}`;
    handSubmit.disabled = true;
    handSubmit.classList.remove('hidden');
  } else if (t == null) {
    handSubmit.textContent = 'Enter all five cards';
    handSubmit.disabled = true;
  } else if (fixing) {
    handSubmit.textContent = `Save the change: ${t ? t : 'nineteen'}`;
    handSubmit.disabled = t > MAX_HAND || IMPOSSIBLE.has(t);
  } else {
    // A hand worth nothing is a "nineteen": the joke being that no hand can
    // actually score 19, so it is what you call a hand that scores nothing.
    handSubmit.textContent = t ? `Add ${t} to ${who}` : `Nineteen — ${who} scores 0`;
    handSubmit.disabled = t > MAX_HAND || IMPOSSIBLE.has(t);
  }
}

function renderCount(seq, up) {
  // changing a count from an earlier hand: no order to follow, just its own
  const step = fixing ? -1 : G.step;
  $('countSeq').classList.toggle('hidden', !!fixing);
  $('countSeq').innerHTML = seq.map((s, i) => {
    const label = s.kind === 'crib' ? `${esc(S.names[s.p])}'s crib` : esc(S.names[s.p]);
    const cls = i < step ? 'done' : i === step ? 'now' : '';
    return `<span class="cs ${cls}" style="--pc:${colorOf(s.p)}">${label}</span>`;
  }).join('<span class="cs-sep">›</span>');

  const crib = up.kind === 'crib';
  $('handCard').style.setProperty('--pc', colorOf(up.p));
  $('handTitle').textContent = crib ? `${S.names[up.p]}'s crib` : `${S.names[up.p]}'s hand`;

  document.querySelectorAll('#modeRow .mode').forEach((b) => b.classList.toggle('is-on', b.dataset.mode === handMode));
  $('cardsBox').classList.toggle('hidden', handMode !== 'cards');
  $('buttonsBox').classList.toggle('hidden', handMode !== 'buttons');

  const t = pendTotal();
  $('handTotal').textContent = t == null ? '–' : t;
  $('handTotal').classList.toggle('bad', t != null && (t > MAX_HAND || IMPOSSIBLE.has(t)));

  // a crib flush needs all five cards
  $('handPad').querySelector('[data-id="flush4"]').classList.toggle('hidden', crib);

  $('handClear').classList.toggle('hidden', !(S.pend.taps.length || S.pend.typed != null));

  const counts = {};
  for (const id of S.pend.taps) counts[id] = (counts[id] || 0) + 1;
  $('handTaps').innerHTML = S.pend.typed != null
    ? `<span class="tap">typed ${S.pend.typed}</span>`
    : Object.entries(counts).map(([id, c]) =>
        `<span class="tap">${esc(COUNT_KEYS[id].label)}${c > 1 ? ` ×${c}` : ''}</span>`).join('')
      || '<span class="tap-none">Tap what the hand scores</span>';
  if (document.activeElement !== $('typedTotal')) $('typedTotal').value = S.pend.typed != null ? S.pend.typed : '';

  renderSubmit(up);
}

function renderPlayMode(counting) {
  $('playModeRow').classList.toggle('hidden', counting);
  document.querySelectorAll('#playModeRow .mode').forEach((b) => b.classList.toggle('is-on', b.dataset.mode === playMode));
  $('playLegend').classList.toggle('hidden', counting || playMode !== 'simple');
}

$('playModeRow').addEventListener('click', (e) => {
  const b = e.target.closest('[data-mode]');
  if (!b || b.dataset.mode === playMode) return;
  playMode = b.dataset.mode;
  try { localStorage.setItem(PLAY_MODE_KEY, playMode); } catch (err) {}
  render();
});

// What a score was, as the history says it: the count's kind, or what was pegged.
const whatOf = (e) => (counted(e) ? e.kind : e.label);
const ptsOf = (e) => (counted(e) && !e.pts ? 'nineteen' : `+${e.pts}`);

/* The whole history for Edit's History (see /editgame.js): every score, as
   the last few are shown under the board, and each change made to one
   since, in its place. A score can be tapped to change it (see fixScore). */
function historyRows() {
  const rows = [];
  const changes = (n) => S.edits.filter((x) => x.after === n).map((x) => ({
    who: S.names[x.p], dot: colorOf(x.p),
    what: x.to ? `${whatOf(x.from)} changed` : `${whatOf(x.from)} removed`,
    // a peg moved to another player says who it went to
    when: x.to ? `${ptsOf(x.from)} → ${x.to.p !== x.from.p ? `${S.names[x.to.p]} ` : ''}${ptsOf(x.to)}` : ptsOf(x.from),
  }));
  rows.push(...changes(0));
  S.log.forEach((e, i) => {
    if (e.p != null && !e.gone) {
      const edit = !SCShare.watching && SCShare.canScore(e.p) ? () => fixScore(i) : null;
      rows.push({ who: S.names[e.p], dot: colorOf(e.p), what: whatOf(e), when: `hand ${G.rows[i].hand}`, pts: ptsOf(e), edit });
    }
    rows.push(...changes(i + 1));
  });
  return rows;
}

function renderHistory() {
  const kinds = { play: '', heels: '', hand: 'hand', crib: 'crib' };
  const shown = S.log.map((e, i) => ({ e, i })).filter(({ e }) => e.p != null && !e.gone).slice(-6).reverse();
  $('history').innerHTML = shown.map(({ e, i }) =>
    `<div><span><i class="hdot" style="background:${colorOf(e.p)}"></i>${esc(S.names[e.p])}</span>
      <small>${counted(e) ? kinds[e.kind] : esc(e.label)} · hand ${G.rows[i].hand}</small>
      <b>${ptsOf(e)}</b></div>`).join('');
}

/* ---------------- 121 ----------------

   Reaching 121 is offered, not declared, as every game offers its win: the
   bar says who got there, Undo takes it back if that wasn't right, and End
   game ends the game with the result. Ended and back at the board, the bar
   stays, its button the result again. */
function renderWinBar() {
  const w = G.winner;
  const on = w !== null && !fixing;
  $('winBar').classList.toggle('hidden', !on);
  if (!on) return;
  $('winBarText').innerHTML = '';
  $('winBarText').append(S.over ? `${S.names[w]} wins!` : `${S.names[w]} reached ${WIN}!`);
  const small = document.createElement('small');
  small.textContent = S.over ? 'The game is over. Undo takes it back, or change a score in History.' : 'Undo if that wasn’t right.';
  $('winBarText').append(small);
  $('winBarBtn').textContent = S.over ? 'See results' : 'End game';
}

$('winBarBtn').onclick = () => {
  if (G.winner === null) return;
  if (!S.over) { S.over = true; S.winner = G.winner; save(); render(); }
  showWin();
};

/* A game ended, a score changed since: still over while someone is at 121,
   its winner whoever got there first now; open again when no one is. */
function settleEnd() {
  if (!S.over) return;
  if (G.winner === null) { S.over = false; S.winner = null; return; }
  S.winner = G.winner;
}

/* ---------------- changing a score ----------------

   From Edit's History, a score is changed the way it was scored, and the
   game is held until the change is made or cancelled; the bar over the
   board says which. A peg: tapping the key it should have been, under the
   player it should have been for, or Remove this peg. A hand or the crib:
   its card, with what it was counted from, and Save. Saved, the game is
   played through again: the pegs, the back pegs and heels follow, and so
   does who reached 121 first. */

// { i, keep, mode } while a score is changed: the hand being counted, and
// Cards or Buttons, to go back to after
let fixing = null;

// What a counted score was counted from, as the hand being counted.
function pendOf(e) {
  const cards = CribCounter.fresh();
  if (Array.isArray(e.cards) && e.cards.length === 5) {
    cards.slots = e.cards.slice();
    cards.at = 5;
    cards.order = [0, 1, 2, 3, 4];
    cards.answers = { ...(e.answers || {}) };
  }
  return { taps: e.typed != null || e.cards ? [] : (e.taps || []).slice(), typed: e.typed != null ? e.typed : null, cards };
}

function fixScore(i) {
  const e = S.log[i];
  if (!e || e.p == null || e.gone) return;
  if (fixing) cancelFix();
  $('winOverlay').classList.add('hidden');
  fixing = { i, keep: S.pend, mode: handMode };
  if (counted(e)) {
    S.pend = pendOf(e);
    // what it was counted with: the cards it was entered by, or the buttons
    handMode = e.cards ? 'cards' : 'buttons';
  }
  render();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function endFix() {
  S.pend = fixing.keep;
  handMode = fixing.mode;
  fixing = null;
}

function cancelFix() {
  if (!fixing) return;
  endFix();
  render();
}

// The change made: kept for the history and Undo, and the game played through.
function changeScore(i, to) {
  const from = S.log[i];
  endFix();
  S.edits.push({ i, p: from.p, from, to, after: S.log.length, ts: Date.now() });
  S.log[i] = to ? { ...to, ts: from.ts } : { ...from, gone: true };
  refresh();
  settleEnd();
  save(); render();
  if (S.over) { showWin(); return; }
  flash(G.winner !== null ? `${S.names[G.winner]} reached ${WIN}!` : to ? `${S.names[to.p]}'s ${whatOf(to)} changed` : `${S.names[from.p]}'s ${whatOf(from)} removed`);
}

// A peg changed: the key tapped is what it should have been, and for whom.
function fixPeg(p, id, label, pts, kind) {
  const e = S.log[fixing.i];
  if (counted(e)) return;
  if (p !== e.p && !SCShare.canScore(p)) { flash(`${S.names[p]} is scored on their own phone`); return; }
  if (p === e.p && pts === e.pts && label === e.label && kind === e.kind) { cancelFix(); return; }
  changeScore(fixing.i, { p, pts, kind, label, id });
}

// A hand or crib changed: what the card now says.
function saveCount() {
  const e = S.log[fixing.i], t = pendTotal();
  if (t == null || t > MAX_HAND || IMPOSSIBLE.has(t)) return;
  const byCards = handMode === 'cards';
  const to = { p: e.p, pts: t, kind: e.kind, label: e.label, ...(byCards
    ? { taps: cardResult.keys.slice(), typed: null, cards: S.pend.cards.slots.slice(), answers: { ...S.pend.cards.answers } }
    : { taps: S.pend.taps.slice(), typed: S.pend.typed }) };
  const same = ['pts', 'typed'].every((k) => to[k] === e[k]) && JSON.stringify(to.taps) === JSON.stringify(e.taps) && JSON.stringify(to.cards || null) === JSON.stringify(e.cards || null);
  if (same) { cancelFix(); return; }
  changeScore(fixing.i, to);
}

// The bar over the board while a score is changed: whose, which, and how.
function renderFixBar() {
  $('fixBar').classList.toggle('hidden', !fixing);
  if (!fixing) return;
  const e = S.log[fixing.i];
  $('fixText').innerHTML = '';
  $('fixText').append(`Changing ${S.names[e.p]}'s ${whatOf(e)} · hand ${G.rows[fixing.i].hand}`);
  const small = document.createElement('small');
  small.textContent = counted(e)
    ? `Was ${ptsOf(e)}. Count it again on the card below, and Save.`
    : `Was ${ptsOf(e)}. Tap what it should have been, under whoever scored it.`;
  $('fixText').append(small);
  $('fixRemove').classList.toggle('hidden', counted(e));
}

$('fixCancel').onclick = cancelFix;
$('fixRemove').onclick = () => { if (fixing && !counted(S.log[fixing.i])) changeScore(fixing.i, null); };

function flash(text) {
  $('msg').textContent = text;
  clearTimeout(msgTimer);
  msgTimer = setTimeout(() => { $('msg').textContent = ''; }, 2000);
}

/* ---------------- Cards or Buttons ---------------- */

CribCounter.build($('cardsBox'), () => { save(); render(); }, clearCards);
$('handClear').onclick = clearButtons;

$('modeRow').addEventListener('click', (e) => {
  const b = e.target.closest('[data-mode]');
  if (!b || b.dataset.mode === handMode) return;
  handMode = b.dataset.mode;
  try { localStorage.setItem(MODE_KEY, handMode); } catch (err) {}
  save(); render();
});

/* ---------------- actions ---------------- */

$('mainBtn').onclick = () => {
  if (closed() || fixing || G.phase !== 'play') return;
  S.log.push({ kind: 'count', ts: Date.now() });
  S.pend = freshPend();
  save(); render();
  window.scrollTo({ top: 0, behavior: 'smooth' });
};

/* One hand onto the board. If it reaches 121 the game is over there and
   then: whoever is still to count never does. */
function submitHand() {
  if (waiting()) return;
  const up = countOrder(G.dealer)[G.step], t = pendTotal(), hand = G.hand;
  if (t == null || t > MAX_HAND || IMPOSSIBLE.has(t)) return;
  const label = up.kind === 'crib' ? 'Crib' : 'Hand';
  const byCards = handMode === 'cards';
  score(up.p, t, up.kind, label, byCards
    ? { taps: cardResult.keys.slice(), typed: null, cards: S.pend.cards.slots.slice(), answers: { ...S.pend.cards.answers } }
    : { taps: S.pend.taps.slice(), typed: S.pend.typed });
  // the next hand of the count is cut the same starter; a new deal, a new one
  S.pend = G.hand === hand ? freshPend(knownStarter()) : freshPend();
  $('typedTotal').value = '';
  if (G.winner !== null) flash(`${S.names[G.winner]} reached ${WIN}!`);
  // hand over: the deal has passed to the left
  else if (G.hand !== hand) flash(`Hand ${G.hand}: ${S.names[G.dealer]} deals`);
  save(); render();
}

$('typedTotal').addEventListener('input', (e) => {
  const v = e.target.value === '' ? null : Math.max(0, Math.round(Number(e.target.value)) || 0);
  S.pend.typed = v;
  if (v != null) S.pend.taps = [];
  save(); render();
});


$('undoBtn').onclick = () => {
  if (fixing) { cancelFix(); flash('Change cancelled'); return; }
  if (waiting()) { flash('Waiting for another phone to count'); return; }
  // a hand being built is undone tap by tap before anything on the board
  if (G.phase === 'count' && handMode === 'cards' && CribCounter.undo(S.pend.cards)) { save(); render(); return; }
  if (G.phase === 'count' && handMode === 'buttons' && (S.pend.taps.length || S.pend.typed != null)) {
    if (S.pend.typed != null) { S.pend.typed = null; $('typedTotal').value = ''; }
    else S.pend.taps.pop();
    save(); render();
    return;
  }
  undoLast();
};

/* Undo, as in the other games: a change made to a score since the last one
   went down comes off first; else the last thing done — a score, or the
   count begun, which goes back to the play. A hand or crib taken off comes
   back to its card, as it was counted, to count again. A phone that joined
   by seat takes back its own player's scores only. */
function undoLast() {
  const seat = SCShare.seat();
  const x = S.edits[S.edits.length - 1];
  if (x && x.after === S.log.length) {
    if (seat !== null && x.p !== seat) { flash(`${S.names[x.p]}'s score is theirs to undo`); return; }
    S.edits.pop();
    S.log[x.i] = x.from;
    reopen();
    flash(`Undid the change to ${S.names[x.p]}'s ${whatOf(x.from)}`);
    return;
  }
  const last = S.log[S.log.length - 1];
  if (!last) { flash('Nothing to undo'); return; }
  if (seat !== null && last.p !== seat) { flash(last.p == null ? 'The count is theirs to undo' : `${S.names[last.p]}'s score is theirs to undo`); return; }
  S.log.pop();
  S.edits = S.edits.filter((y) => y.i < S.log.length).map((y) => ({ ...y, after: Math.min(y.after, S.log.length) }));
  if (last.kind === 'count') S.pend = freshPend();
  else if (counted(last)) S.pend = pendOf(last);
  reopen();
  flash(last.kind === 'count' ? 'Back to the play' : `Undid ${S.names[last.p]} ${ptsOf(last)}`);
}

// After an Undo: a game ended is open again, and shown as it now stands.
function reopen() {
  S.over = false;
  S.winner = null;
  $('winOverlay').classList.add('hidden');
  save(); render();
}

/* ---------------- editing the game ----------------

   Players can be put in another order, and renamed, once the game has
   started (see /editgame.js). Everything kept by a player's place moves
   with them: every score and change to one, their peg colour, the winner
   and who You are; their pegs follow, as they are worked out from the
   scores. The dealer keeps the deal; it passes on in the new order. While
   a hand is being counted the order stays put, as the count goes round the
   table from the dealer; a shared game stays as it is, as the other phones
   know the players by their place. */

async function editGame() {
  const locked = SCStore.get(S.id)?.share
    ? 'This game is shared with other phones, which know the players by their place, so the players can’t be moved or renamed now.'
    : null;
  if (fixing) cancelFix();
  const fixed = G.phase === 'count' && !closed()
    ? 'The order can’t change while a hand is being counted, as the count goes round the table: it can once this hand is in.'
    : null;
  const got = await SCEditGame.open({ names: S.names, locked, fixed, hint: 'The dealer keeps the deal, and it passes on in the new order.', history: historyRows });
  if (!got) return;
  const moved = got.order.some((from, i) => from !== i);
  if (!moved && got.names.every((n, i) => n === S.names[i])) return;
  const { list, place } = SCEditGame.moves(got.order);
  const dealer = place(G.dealer), n = S.names.length;
  // a game never edited has its colours by place: written down, they can move
  if (!S.colors) S.colors = S.names.map((_, i) => i);
  S.names = got.names;
  S.colors = list(S.colors);
  for (const k of ['winner', 'me']) S[k] = place(S[k]);
  S.log.forEach((e) => { if (e.p != null) e.p = place(e.p); });
  S.edits.forEach((x) => {
    x.p = place(x.p);
    if (x.from) x.from = { ...x.from, p: place(x.from.p) };
    if (x.to) x.to = { ...x.to, p: place(x.to.p) };
  });
  // the dealer keeps the deal: the first dealer is whoever, round the new
  // table, deals this hand after as many hands as there have been
  S.firstDealer = (((dealer - (G.hand - 1)) % n) + n) % n;
  save();
  buildBoard(); buildPlayers(); render();
  flash(moved ? `${S.names[G.dealer]} still deals` : 'Names changed');
}
$('editBtn').onclick = editGame;

$('quitBtn').onclick = async () => {
  if (S.log.length && !(await askConfirm('This ends the current game and its scores.', 'New game'))) return;
  // given up unfinished: off the profile too
  if (!S.over) SCCloud.drop(S.id);
  SCStore.remove(S.id);
  leaveGame();
};

/* ---------------- the end ---------------- */

/* A skunk is winning while the loser is still short of 91; a double skunk,
   short of 61. With three players it is judged on the lowest score. */
function skunk() {
  const low = Math.min(...G.scores.filter((_, i) => i !== S.winner));
  return low < 61 ? 'double' : low < 91 ? 'skunk' : null;
}

function showWin() {
  const sk = skunk();
  $('winName').textContent = `${S.names[S.winner]} wins!`;
  $('winSkunk').textContent = sk === 'double' ? 'Double skunk!' : sk === 'skunk' ? 'Skunk!' : '';
  const order = S.names.map((_, i) => i).sort((a, b) => G.scores[b] - G.scores[a]);
  $('winTable').innerHTML = order.map((i) =>
    `<li><span><i class="hdot" style="background:${colorOf(i)}"></i>${esc(S.names[i])}</span><b>${Math.min(G.scores[i], WIN)}</b></li>`).join('');
  $('winOverlay').classList.remove('hidden');
  saveToProfile();
}

// Correcting a mis-tap that ended the game: take it back and play on.
$('winUndo').onclick = () => undoLast();

// back to the board, the game kept over: its history, and changes to it
$('keepBtn').onclick = () => $('winOverlay').classList.add('hidden');

// The loser of a game deals the first hand of the next.
$('rematchBtn').onclick = () => {
  const loser = G.scores.indexOf(Math.min(...G.scores));
  SCStore.remove(S.id);      // finished, and on the profile when signed in
  const colors = S.colors;     // the same players keep their colours
  S = newGame(S.names, loser);
  if (colors) S.colors = colors;
  save();
  SCStore.show(S.id);
  $('winOverlay').classList.add('hidden');
  buildBoard(); buildPlayers(); render();
};
$('newBtn').onclick = () => { SCStore.remove(S.id); leaveGame(); };

function askConfirm(text, yesLabel) {
  return new Promise((resolve) => {
    $('confirmText').textContent = text;
    $('confirmYes').textContent = yesLabel || 'Yes';
    $('confirmOverlay').classList.remove('hidden');
    const done = (v) => {
      $('confirmOverlay').classList.add('hidden');
      $('confirmYes').onclick = $('confirmNo').onclick = null;
      resolve(v);
    };
    $('confirmYes').onclick = () => done(true);
    $('confirmNo').onclick = () => done(false);
  });
}

/* ---------------- profile ----------------

   A finished game goes to the profile through /api/games, as darts and
   builder games do. Every score is a turn; its detail says what it was —
   pegging, heels, a hand or the crib, and which hand of the game — which is
   what lets the game page rebuild it hand by hand. */

function toPayload() {
  const counts = [];
  const turns = S.log.map((e, i) => ({ e, i })).filter(({ e }) => e.p != null && !e.gone).map(({ e, i }) => {
    const n = counts[e.p] || 0;
    counts[e.p] = n + 1;
    const row = G.rows[i];
    const detail = { kind: e.kind, hand: row.hand, label: e.label };
    if (e.kind === 'hand' || e.kind === 'crib') {
      if (e.typed != null) detail.typed = e.typed; else detail.taps = e.taps;
      if (e.cards) detail.cards = e.cards;      // ranks, the starter last
    }
    return {
      player_idx: e.p, turn_no: n, detail: [detail],
      points: e.pts, bust: false, score_after: row.after,
      created_at: S.startedAt + i,      // ordering only
    };
  });
  return {
    id: S.id,
    game_type: 'cribbage',
    config: { players: S.names.length, firstDealer: S.firstDealer, skunk: S.over ? skunk() : null },
    started_at: S.startedAt,
    // who You are, picked at the setup; No one leaves it to the first player
    me_idx: Number.isInteger(S.me) ? S.me : 0,
    ended_at: S.over ? Date.now() : null,
    winner_idx: S.over ? S.winner : null,
    players: S.names.map((name, idx) => ({ idx, name })),
    turns,
  };
}

async function saveToProfile() {
  const note = $('winSave');
  note.textContent = '';
  note.onclick = null;
  if (!me) return;
  note.textContent = 'Saving to your profile…';
  try {
    await SCCloud.now(cloudGame);
    note.textContent = 'Saved to your profile';
  } catch (e) {
    note.textContent = 'Could not save to your profile. Tap to try again.';
    note.onclick = saveToProfile;
  }
}

fetch('/api/me', { headers: { accept: 'application/json' } })
  .then((r) => (r.ok ? r.json() : null))
  .then((d) => { me = (d && d.user) || null; })
  .catch(() => {});

/* ---------------- boot ---------------- */

renderSetup();

/* ?g=<id> — a game's own address: a link to it, or a reload. The game is
   opened from this device or, signed in, from the profile; ?resume=<id>
   asks for the profile's copy first, as it has been played on elsewhere. */
async function openFromUrl() {
  // ?s=<token>: a shared game, to score in together or to watch
  const shared = await SCShare.fromUrl(TYPE);
  if (shared && shared.kind === 'edit') { openGame(shared.state); return; }
  if (shared) { S = upgrade(shared.state); showGame(); return; }
  const at = SCStore.urlId();
  if (!at) return;
  const st = await SCStore.open(TYPE, at.id, at.fresh);
  if (st) { openGame(st); return; }
  SCStore.leave();
  SCStore.notice("That game isn't on this device. Sign in to open games saved to your profile.");
}

/* Shared by link (see /share.js): the game on screen, and how to show a
   newer one when it comes in from another phone. */
SCShare.attach({
  type: TYPE, get: () => S, apply: applyShared, seats: true,
  names: (st) => st.names, me: (st) => st.me,
  // the play moves quickly, so look for news every second while it lasts
  pollEvery: () => (S && G && G.phase === 'play' ? 1000 : 3000),
  rebase: rebaseShared,
});

/* Two phones pegging at once: the second save is refused, as the game went
   whole. When all this phone did since was peg, and the other phone's game
   is still in the play of the same hand, those pegs go on again on top of
   the game as it now stands, and nothing is lost. Anything else (starting
   the count, counting a hand, Undo, a change) gives way, as before. */
function rebaseShared(theirs, mine, base) {
  theirs = upgrade(theirs); mine = upgrade(mine); base = upgrade(base);
  const n = base.log.length;
  if (mine.log.length <= n) return null;
  if (JSON.stringify(mine.log.slice(0, n)) !== JSON.stringify(base.log)) return null;
  if (JSON.stringify(mine.edits) !== JSON.stringify(base.edits)) return null;
  const added = mine.log.slice(n);
  if (!added.every((e) => e.kind === 'play')) return null;
  const was = play(base), now = play(theirs);
  if (now.phase !== 'play' || now.hand !== was.hand || theirs.over || now.winner !== null) return null;
  const merged = JSON.parse(JSON.stringify(theirs));
  merged.log.push(...added);
  return merged;
}

/* A phone that joined by seat counts its own hand, and its own crib, when
   that one is up; the rest of the count it watches, the hand card greyed.
   In the play it pegs its own player only (see peg). */
const waiting = () => S && G && !fixing && G.phase === 'count' && !closed() && !SCShare.canScore(countOrder(G.dealer)[G.step].p);

/* A newer game from another phone. The hand this phone is part-way through
   counting — buttons tapped, a total typed, cards entered — carries over
   while that hand is still the one up: the same deal, the same place in the
   count. If it has been entered on the other phone meanwhile, this count
   is let go, and it says so. A score being changed here is let go too. */
function applyShared(st) {
  if (fixing) { endFix(); flash('The game changed on another phone: the change was let go'); }
  const p = S && S.pend, c = p && p.cards;
  const was = S && G;
  const counting = was && was.phase === 'count' && p &&
    (p.taps.length || p.typed != null || (c && c.order && c.order.length));
  const mine = counting ? { pend: p, hand: was.hand, step: was.step } : null;
  S = upgrade(st);
  refresh();
  if (mine) {
    if (G.phase === 'count' && G.hand === mine.hand && G.step === mine.step) S.pend = mine.pend;
    else flash('That hand was counted on another phone');
  }
  save();
  showGame();
}

$('shareBtn').onclick = () => SCShare.open();

openFromUrl();
