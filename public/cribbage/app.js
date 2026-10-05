/* Score Chalk — cribbage for two or three players, first to 121.

   A hand is two phases. In the play (pegging) every tap scores at once,
   under the player who scored it. In the count each hand is scored on its
   own, in the order the rules count them — players left of the dealer, then
   the dealer's hand, then the crib — and submitted before the next. The
   game ends the moment anyone reaches 121, so a non-dealer who counts out
   wins before the dealer's hand or crib is ever counted. */

const KEY = 'cribbage-v1';
const NAMES_KEY = 'cribbage-names-v1';
const WIN = 121;
const COLORS = ['#d9534f', '#2e9e63', '#3b82f6'];   // red, green, blue

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

/* ---------------- state ---------------- */

function newGame(names, dealer) {
  return {
    // chosen here so a retried save updates one row on the profile
    id: crypto.randomUUID(),
    startedAt: Date.now(),
    names,
    dealer,
    firstDealer: dealer,
    hand: 1,
    phase: 'play',
    step: 0,                       // which hand of the count is up
    scores: names.map(() => 0),
    prev: names.map(() => 0),      // the back peg: where each peg last was
    heels: true,                   // still claimable: nothing pegged yet
    pend: freshPend(),
    log: [],                       // every score, in order; see score()
    undo: [],                      // snapshots of everything but log and undo
    over: false,
    winner: null,
  };
}

// The hand being counted: buttons tapped or a total typed (Buttons mode),
// and the cards entered so far (Cards mode). Both are kept whichever mode is
// showing, so switching mode mid-hand loses nothing.
function freshPend() {
  return { taps: [], typed: null, cards: CribCounter.fresh() };
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

function save() {
  try { S ? localStorage.setItem(KEY, JSON.stringify(S)) : localStorage.removeItem(KEY); }
  catch (e) { /* private mode, ignore */ }
}
function load() {
  try { return JSON.parse(localStorage.getItem(KEY)); } catch (e) { return null; }
}

// The count, in order: each player left of the dealer, the dealer, the crib.
function countOrder() {
  const n = S.names.length, seq = [];
  for (let k = 1; k < n; k++) seq.push({ p: (S.dealer + k) % n, kind: 'hand' });
  seq.push({ p: S.dealer, kind: 'hand' }, { p: S.dealer, kind: 'crib' });
  return seq;
}

/* Undo restores a snapshot of the whole game taken before each change. The
   log is left out of the snapshot and cut back to its old length instead,
   so the snapshots stay small however long the game runs. */
function snapshot() {
  const { log, undo, ...rest } = S;
  S.undo.push(JSON.stringify({ ...rest, logLen: log.length }));
  if (S.undo.length > 400) S.undo.shift();
}

function restore() {
  const raw = S.undo.pop();
  if (!raw) return false;
  const o = JSON.parse(raw);
  const log = S.log.slice(0, o.logLen);
  delete o.logLen;
  S = { ...o, log, undo: S.undo };
  return true;
}

/* Every point goes through here: peg moves, back peg follows, and the game
   ends the instant anyone reaches 121, whatever phase it is. */
function score(p, pts, kind, label, extra) {
  snapshot();
  S.prev[p] = S.scores[p];
  S.scores[p] += pts;
  S.log.push({ p, pts, kind, label, hand: S.hand, after: S.scores[p], ...extra });
  // heels is once a hand, and only before the play starts scoring
  if (kind === 'play' || kind === 'heels') S.heels = false;
  if (S.scores[p] >= WIN) { S.over = true; S.winner = p; }
}

/* ---------------- setup ---------------- */

let setupN = 2, setupDealer = 0;
let setupNames = (() => {
  try { return JSON.parse(localStorage.getItem(NAMES_KEY)) || ['', '', '']; }
  catch (e) { return ['', '', '']; }
})();

const nameOf = (i) => (setupNames[i] || '').trim() || `Player ${i + 1}`;

function renderSetup() {
  document.querySelectorAll('#countRow .seg').forEach((b) =>
    b.classList.toggle('is-on', Number(b.dataset.n) === setupN));

  const box = $('names');
  box.classList.toggle('three', setupN === 3);
  box.innerHTML = '';
  for (let i = 0; i < setupN; i++) {
    const row = document.createElement('label');
    row.className = 'name-row';
    row.innerHTML = `<span class="dot" style="background:${COLORS[i]}"></span>`;
    const inp = document.createElement('input');
    inp.type = 'text'; inp.maxLength = 14; inp.autocomplete = 'off';
    inp.placeholder = `Player ${i + 1}`;
    inp.value = setupNames[i] || '';
    inp.addEventListener('input', () => {
      setupNames[i] = inp.value;
      try { localStorage.setItem(NAMES_KEY, JSON.stringify(setupNames)); } catch (e) {}
      renderDealRow();
    });
    row.appendChild(inp);
    box.appendChild(row);
  }
  renderDealRow();
  $('resumeBtn').classList.toggle('hidden', !load());
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

$('startBtn').onclick = async () => {
  if (load() && !(await askConfirm('This replaces the saved game.', 'Start new game'))) return;
  S = newGame(Array.from({ length: setupN }, (_, i) => nameOf(i)), setupDealer);
  save();
  showGame();
};

$('resumeBtn').onclick = () => { S = load(); if (S) showGame(); };

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
      fill="none" stroke="${COLORS[p]}" stroke-opacity=".38" stroke-width="${B.L - 0.6}"/>`;
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
    out += `<circle id="back${p}" r="3.8" class="peg-back" stroke="${COLORS[p]}"/>`;
    out += `<circle id="peg${p}" r="4.8" class="peg" fill="${COLORS[p]}"/>`;
  }
  svg.innerHTML = out;
  svg.dataset.n = n;
}

function placePegs() {
  const g = geometry(S.names.length);
  S.names.forEach((_, p) => {
    const a = pegAt(g, p, Math.min(S.scores[p], WIN));
    const b = pegAt(g, p, Math.min(S.prev[p], WIN));
    $('peg' + p).setAttribute('cx', a.x); $('peg' + p).setAttribute('cy', a.y);
    $('back' + p).setAttribute('cx', b.x); $('back' + p).setAttribute('cy', b.y);
    // a back peg sitting under the front one is just clutter
    $('back' + p).style.display = S.prev[p] === S.scores[p] ? 'none' : '';
  });
}

/* ---------------- game screen ---------------- */

function showGame() {
  // a game saved before Cards mode existed has no cards in its hand yet
  if (!S.pend.cards) S.pend.cards = CribCounter.fresh();
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
    col.style.setProperty('--pc', COLORS[p]);
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

// a tap in the play: scores at once
function peg(p, id, label, pts, kind = 'play') {
  if (S.over) return;
  score(p, pts, kind, label, { id });
  save(); render();
  flash(`${S.names[p]} ${label} +${pts}`);
  if (S.over) showWin();
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
  const n = S.names.length;
  const seq = countOrder();
  const counting = S.phase === 'count';
  const up = counting ? seq[S.step] : null;

  placePegs();

  $('phaseHand').innerHTML = `Hand ${S.hand} · <b>${esc(S.names[S.dealer])}</b> deals`;
  $('stepPlay').classList.toggle('is-on', !counting);
  $('stepCount').classList.toggle('is-on', counting);

  // leader, for the headers
  const top = Math.max(...S.scores);
  const lead = S.scores.filter((s) => s === top).length === 1 && top > 0 ? S.scores.indexOf(top) : -1;

  [...$('players').children].forEach((col, p) => {
    col.querySelector('.pscore').textContent = S.scores[p];
    const meta = [];
    if (p === S.dealer) meta.push('<span class="badge-d">Dealer</span>');
    // the lead gives way to Heels while it is live: one row, no wrapping
    if (p === lead && !(p === S.dealer && S.heels && !counting)) meta.push(`<span class="lead">+${top - Math.max(...S.scores.filter((_, i) => i !== p))}</span>`);
    col.querySelector('.pmeta').innerHTML = meta.join('');
    col.classList.toggle('counting', !!up && up.p === p);
    col.querySelector('.ppad').classList.toggle('hidden', counting || playMode !== 'detailed');
    col.querySelector('.psimple').classList.toggle('hidden', counting || playMode !== 'simple');
    // heels is claimed during the play; once counting starts the chance has gone
    const heelsLive = p === S.dealer && S.heels && !counting;
    col.querySelector('.heels').classList.toggle('hidden', !heelsLive);
  });

  renderPlayMode(counting);
  $('countBox').classList.toggle('hidden', !counting);
  // Cards first: its verdict is what the total and the main button read
  cardResult = counting && handMode === 'cards' ? CribCounter.draw(S.pend.cards, up.kind === 'crib') : null;
  if (counting) renderCount(seq, up);

  const main = $('mainBtn');
  if (!counting) {
    main.textContent = 'Done with the play — count hands';
    main.disabled = false;
  } else {
    const t = pendTotal();
    const who = up.kind === 'crib' ? `${S.names[up.p]}'s crib` : S.names[up.p];
    if (t == null) {
      main.textContent = cardResult && cardResult.state === 'asking' ? 'Answer the question above' : 'Enter all five cards';
      main.disabled = true;
    } else {
      // A hand worth nothing is a "nineteen": the joke being that no hand can
      // actually score 19, so it is what you call a hand that scores nothing.
      main.textContent = t ? `Add ${t} to ${who}` : `Nineteen — ${who} scores 0`;
      main.disabled = t > MAX_HAND || IMPOSSIBLE.has(t);
    }
  }
  main.style.opacity = main.disabled ? 0.5 : 1;

  renderHistory();
}

function renderCount(seq, up) {
  $('countSeq').innerHTML = seq.map((s, i) => {
    const label = s.kind === 'crib' ? `${esc(S.names[s.p])}'s crib` : esc(S.names[s.p]);
    const cls = i < S.step ? 'done' : i === S.step ? 'now' : '';
    return `<span class="cs ${cls}" style="--pc:${COLORS[s.p]}">${label}</span>`;
  }).join('<span class="cs-sep">›</span>');

  const crib = up.kind === 'crib';
  $('handCard').style.setProperty('--pc', COLORS[up.p]);
  $('handTitle').textContent = crib ? `${S.names[up.p]}'s crib` : `${S.names[up.p]}'s hand`;

  document.querySelectorAll('#modeRow .mode').forEach((b) => b.classList.toggle('is-on', b.dataset.mode === handMode));
  $('cardsBox').classList.toggle('hidden', handMode !== 'cards');
  $('buttonsBox').classList.toggle('hidden', handMode !== 'buttons');

  const t = pendTotal();
  $('handTotal').textContent = t == null ? '–' : t;
  $('handTotal').classList.toggle('bad', t != null && (t > MAX_HAND || IMPOSSIBLE.has(t)));

  // a crib flush needs all five cards
  $('handPad').querySelector('[data-id="flush4"]').classList.toggle('hidden', crib);

  const counts = {};
  for (const id of S.pend.taps) counts[id] = (counts[id] || 0) + 1;
  $('handTaps').innerHTML = S.pend.typed != null
    ? `<span class="tap">typed ${S.pend.typed}</span>`
    : Object.entries(counts).map(([id, c]) =>
        `<span class="tap">${esc(COUNT_KEYS[id].label)}${c > 1 ? ` ×${c}` : ''}</span>`).join('')
      || '<span class="tap-none">Tap what the hand scores</span>';
  if (document.activeElement !== $('typedTotal')) $('typedTotal').value = S.pend.typed != null ? S.pend.typed : '';
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

function renderHistory() {
  const kinds = { play: '', heels: '', hand: 'hand', crib: 'crib' };
  $('history').innerHTML = S.log.slice(-6).reverse().map((e) =>
    `<div><span><i class="hdot" style="background:${COLORS[e.p]}"></i>${esc(S.names[e.p])}</span>
      <small>${e.kind === 'hand' || e.kind === 'crib' ? kinds[e.kind] : esc(e.label)} · hand ${e.hand}</small>
      <b>${(e.kind === 'hand' || e.kind === 'crib') && !e.pts ? 'nineteen' : '+' + e.pts}</b></div>`).join('');
}

function flash(text) {
  $('msg').textContent = text;
  clearTimeout(msgTimer);
  msgTimer = setTimeout(() => { $('msg').textContent = ''; }, 2000);
}

/* ---------------- Cards or Buttons ---------------- */

CribCounter.build($('cardsBox'), () => { save(); render(); });

$('modeRow').addEventListener('click', (e) => {
  const b = e.target.closest('[data-mode]');
  if (!b || b.dataset.mode === handMode) return;
  // Leaving Cards with a scored hand hands its score to the buttons as
  // chips, so nothing entered is lost and it can be adjusted there.
  if (handMode === 'cards' && cardResult && cardResult.state === 'scored') {
    S.pend.taps = cardResult.keys.slice();
    S.pend.typed = null;
  }
  handMode = b.dataset.mode;
  try { localStorage.setItem(MODE_KEY, handMode); } catch (err) {}
  save(); render();
});

/* ---------------- actions ---------------- */

$('mainBtn').onclick = () => {
  if (S.over) return;
  if (S.phase === 'play') {
    snapshot();
    S.phase = 'count';
    S.step = 0;
    S.pend = freshPend();
    save(); render();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    return;
  }
  submitHand();
};

/* One hand onto the board. If it reaches 121 the game is over there and
   then: whoever is still to count never does. */
function submitHand() {
  const seq = countOrder(), up = seq[S.step], t = pendTotal();
  if (t == null || t > MAX_HAND || IMPOSSIBLE.has(t)) return;
  const label = up.kind === 'crib' ? 'Crib' : 'Hand';
  const byCards = handMode === 'cards';
  score(up.p, t, up.kind, label, byCards
    ? { taps: cardResult.keys.slice(), typed: null, cards: S.pend.cards.slots.slice() }
    : { taps: S.pend.taps.slice(), typed: S.pend.typed });
  S.pend = freshPend();
  $('typedTotal').value = '';
  if (S.over) { save(); render(); showWin(); return; }

  S.step += 1;
  if (S.step >= seq.length) {
    // hand over: the deal passes to the left
    S.dealer = (S.dealer + 1) % S.names.length;
    S.hand += 1;
    S.phase = 'play';
    S.step = 0;
    S.heels = true;
    flash(`Hand ${S.hand}: ${S.names[S.dealer]} deals`);
  }
  save(); render();
}

$('typedTotal').addEventListener('input', (e) => {
  const v = e.target.value === '' ? null : Math.max(0, Math.round(Number(e.target.value)) || 0);
  S.pend.typed = v;
  if (v != null) S.pend.taps = [];
  save(); render();
});

$('tapBack').onclick = () => {
  if (S.pend.typed != null) S.pend.typed = null;
  else S.pend.taps.pop();
  $('typedTotal').value = '';
  save(); render();
};

$('undoBtn').onclick = () => {
  // a hand being built is undone tap by tap before anything on the board
  if (S.phase === 'count' && handMode === 'cards' && CribCounter.undo(S.pend.cards)) { save(); render(); return; }
  if (S.phase === 'count' && handMode === 'buttons' && (S.pend.taps.length || S.pend.typed != null)) { $('tapBack').onclick(); return; }
  const last = S.log[S.log.length - 1], before = S.log.length;
  if (!restore()) { flash('Nothing to undo'); return; }
  save(); render();
  // a score coming off is worth naming; a phase change going back speaks for itself
  flash(S.log.length < before ? `Undid ${S.names[last.p]} +${last.pts}` : 'Back to the play');
};

$('quitBtn').onclick = async () => {
  if (S.log.length && !(await askConfirm('This ends the current game and its scores.', 'New game'))) return;
  S = null; save();
  location.reload();
};

/* ---------------- the end ---------------- */

/* A skunk is winning while the loser is still short of 91; a double skunk,
   short of 61. With three players it is judged on the lowest score. */
function skunk() {
  const low = Math.min(...S.scores.filter((_, i) => i !== S.winner));
  return low < 61 ? 'double' : low < 91 ? 'skunk' : null;
}

function showWin() {
  const sk = skunk();
  $('winName').textContent = `${S.names[S.winner]} wins!`;
  $('winSkunk').textContent = sk === 'double' ? 'Double skunk!' : sk === 'skunk' ? 'Skunk!' : '';
  const order = S.names.map((_, i) => i).sort((a, b) => S.scores[b] - S.scores[a]);
  $('winTable').innerHTML = order.map((i) =>
    `<li><span><i class="hdot" style="background:${COLORS[i]}"></i>${esc(S.names[i])}</span><b>${Math.min(S.scores[i], WIN)}</b></li>`).join('');
  $('winOverlay').classList.remove('hidden');
  saveToProfile();
}

// Correcting a mis-tap that ended the game: put it back and play on.
$('winUndo').onclick = () => {
  if (restore()) { S.over = false; S.winner = null; }
  save();
  $('winOverlay').classList.add('hidden');
  render();
};

// The loser of a game deals the first hand of the next.
$('rematchBtn').onclick = () => {
  const loser = S.scores.indexOf(Math.min(...S.scores));
  S = newGame(S.names, loser);
  save();
  $('winOverlay').classList.add('hidden');
  buildBoard(); buildPlayers(); render();
};
$('newBtn').onclick = () => { S = null; save(); location.reload(); };

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
  const turns = S.log.map((e, i) => {
    const n = counts[e.p] || 0;
    counts[e.p] = n + 1;
    const detail = { kind: e.kind, hand: e.hand, label: e.label };
    if (e.kind === 'hand' || e.kind === 'crib') {
      if (e.typed != null) detail.typed = e.typed; else detail.taps = e.taps;
      if (e.cards) detail.cards = e.cards;      // ranks, the starter last
    }
    return {
      player_idx: e.p, turn_no: n, detail: [detail],
      points: e.pts, bust: false, score_after: e.after,
      created_at: S.startedAt + i,      // ordering only
    };
  });
  return {
    id: S.id,
    game_type: 'cribbage',
    config: { players: S.names.length, firstDealer: S.firstDealer, skunk: skunk() },
    started_at: S.startedAt,
    me_idx: 0,
    ended_at: Date.now(),
    winner_idx: S.winner,
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
    const res = await fetch('/api/games', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(toPayload()),
    });
    if (!res.ok) throw new Error();
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
