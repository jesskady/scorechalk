/* Score Chalk — Yahtzee: the pen-and-paper scoresheet, for one to six.

   Players across the top, boxes down the side. Tapping a player shows
   their column at a glance — green where they have scored, yellow where
   they still can — and tapping a box scores it, with only the choices that
   box can take. Filling an open box for the player whose turn it is passes
   the turn on; the game ends when every box on the sheet is filled. */

// games are kept by id, every kind together: see /store.js
const TYPE = 'yahtzee';
const NAMES_KEY = 'yahtzee-names-v1';
const MAX_PLAYERS = 10;   // past four, the player columns scroll sideways
const BONUS_AT = 63, BONUS = 35, YAHTZEE_BONUS = 100;

/* The boxes, top to bottom. kind says how a box is scored:
     face   — Aces to Sixes: so many of that number, so one of five scores
     total  — the dice added up, typed in (5 to 30)
     fixed  — all or nothing: its value, or a scratch */
const BOXES = [
  { id: 'ones', label: 'Aces', kind: 'face', face: 1 },
  { id: 'twos', label: 'Twos', kind: 'face', face: 2 },
  { id: 'threes', label: 'Threes', kind: 'face', face: 3 },
  { id: 'fours', label: 'Fours', kind: 'face', face: 4 },
  { id: 'fives', label: 'Fives', kind: 'face', face: 5 },
  { id: 'sixes', label: 'Sixes', kind: 'face', face: 6 },
  { id: 'three', label: '3 of a kind', kind: 'total' },
  { id: 'four', label: '4 of a kind', kind: 'total' },
  { id: 'full', label: 'Full house', kind: 'fixed', value: 25 },
  { id: 'small', label: 'Sm. straight', kind: 'fixed', value: 30 },
  { id: 'large', label: 'Lg. straight', kind: 'fixed', value: 40 },
  { id: 'yahtzee', label: 'Yahtzee', kind: 'fixed', value: 50 },
  { id: 'chance', label: 'Chance', kind: 'total' },
];
const UPPER = BOXES.slice(0, 6), LOWER = BOXES.slice(6);
const box = (id) => BOXES.find((b) => b.id === id);

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

let S = null;          // the game; null on the setup screen
let me = null;         // the signed-in user, for saving to the profile
let msgTimer = null;

/* ---------------- state ---------------- */

function newGame(names) {
  return {
    id: crypto.randomUUID(),          // so a retried save updates one row
    startedAt: Date.now(),
    names,
    cells: names.map(() => ({})),     // per player: box id -> points
    ybonus: names.map(() => 0),       // per player: extra Yahtzees
    cur: 0,                           // whose turn it is
    sel: 0,                           // whose column is highlighted
    log: [],                          // every change, for Undo; see setBox()
    over: false,
  };
}

function save() {
  if (!S) return;
  SCStore.put(TYPE, S, !!S.over);
  // and to the profile, when signed in (see /cloud.js)
  if (window.SCCloud) SCCloud.keep(cloudGame);
}

// The game as the profile keeps it: its history, and its own state to pick
// it up again by. Nothing until there is a score in it.
const cloudGame = () => (S && S.log.length ? { ...toPayload(), state: S } : null);
// The newest game of this kind in progress here, for the setup's Resume.
function load() {
  const g = SCStore.latest(TYPE);
  return g ? g.state : null;
}

// A game on screen has its id in the address: a link to it opens it.
function openGame(state) {
  S = state;
  SCStore.show(S.id);
  showGame();
}

// Leaving a game: back to the setup, the address without it.
function leaveGame() {
  location.replace(location.pathname);
}

/* ---------------- totals ---------------- */

function totals(p) {
  const c = S.cells[p];
  const sum = (bs) => bs.reduce((t, b) => t + (c[b.id] || 0), 0);
  const upper = sum(UPPER);
  const bonus = upper >= BONUS_AT ? BONUS : 0;
  const yb = S.ybonus[p] * YAHTZEE_BONUS;
  const lower = sum(LOWER) + yb;
  return { upper, bonus, upperTotal: upper + bonus, yb, lower, grand: upper + bonus + lower };
}

const filled = (p, id) => S.cells[p][id] != null;
const sheetFull = (p) => BOXES.every((b) => filled(p, b.id));
const gameDone = () => S.names.every((_, p) => sheetFull(p));

// The next player with a box still open, after p.
function nextPlayer(p) {
  const n = S.names.length;
  for (let k = 1; k <= n; k++) {
    const q = (p + k) % n;
    if (!sheetFull(q)) return q;
  }
  return p;
}

/* Every score goes through here, and is logged with what it replaced so
   Undo can put it back. Filling an open box for the player whose turn it
   is ends their turn; changing a box, or scoring for someone else, does
   not move the turn. */
function setBox(p, id, v) {
  const prev = S.cells[p][id];
  const passes = p === S.cur && prev == null && v != null;
  S.log.push({ p, id, prev, v, cur: S.cur, sel: S.sel });
  if (v == null) delete S.cells[p][id]; else S.cells[p][id] = v;
  if (passes) S.cur = S.sel = nextPlayer(p);
  S.over = gameDone();
}

function setYBonus(p, n) {
  S.log.push({ p, id: 'ybonus', prev: S.ybonus[p], v: n, cur: S.cur, sel: S.sel });
  S.ybonus[p] = n;
}

/* ---------------- setup ---------------- */

let setupNames = (() => {
  try { return JSON.parse(localStorage.getItem(NAMES_KEY)) || ['', '']; } catch (e) { return ['', '']; }
})();
// How many played last time, not how many names have ever been typed: the
// names are kept for all ten places, whatever tonight's count.
const COUNT_KEY = 'yahtzee-count-v1';
let setupN = (() => {
  try { return Math.min(Math.max(Number(localStorage.getItem(COUNT_KEY)) || 2, 1), MAX_PLAYERS); }
  catch (e) { return 2; }
})();

function renderSetup() {
  $('pCount').textContent = setupN;
  $('pMinus').disabled = setupN <= 1;
  $('pPlus').disabled = setupN >= MAX_PLAYERS;
  const box = $('names');
  box.classList.toggle('one', setupN === 1);
  box.innerHTML = '';
  for (let i = 0; i < setupN; i++) {
    const inp = document.createElement('input');
    inp.type = 'text'; inp.maxLength = 14; inp.autocomplete = 'off';
    inp.placeholder = `Player ${i + 1}`;
    inp.value = setupNames[i] || '';
    inp.addEventListener('input', () => {
      setupNames[i] = inp.value;
      try { localStorage.setItem(NAMES_KEY, JSON.stringify(setupNames)); } catch (e) {}
    });
    box.appendChild(inp);
  }
  $('resumeBtn').classList.toggle('hidden', !load());
}

$('pMinus').onclick = () => { if (setupN > 1) { setupN--; renderSetup(); } };
$('pPlus').onclick = () => { if (setupN < MAX_PLAYERS) { setupN++; renderSetup(); } };

$('startBtn').onclick = async () => {
  // a new game of its own: any in progress stay, under Pick up where you left off
  const names = Array.from({ length: setupN }, (_, i) => (setupNames[i] || '').trim() || `Player ${i + 1}`);
  S = newGame(names);
  try { localStorage.setItem(COUNT_KEY, String(setupN)); } catch (e) {}
  save();
  openGame(S);
};
$('resumeBtn').onclick = () => { const s = load(); if (s) openGame(s); };

/* ---------------- the sheet ----------------

   A grid: the box names in the first column, a column per player. Rows are
   built once; render() fills the numbers and the highlighting. */

// The lower section starts after a thicker line rather than a heading row:
// the sheet has to fit one phone screen, and the line says as much.
const ROWS = [
  ...UPPER.map((b) => ({ box: b })),
  { total: 'upper', label: 'Upper total' },
  { total: 'bonus', label: 'Bonus' },
  ...LOWER.map((b, i) => ({ box: b, split: i === 0 })),
  { ybonus: true, label: 'Yahtzee bonus' },
  { total: 'lower', label: 'Lower total' },
  { total: 'grand', label: 'Grand total', grand: true },
];

function showGame() {
  $('setup').classList.add('hidden');
  $('game').classList.remove('hidden');
  // the sign-in bubble would sit on the top bar's buttons
  document.body.classList.add('playing');
  // a phone that joined by seat keeps its own player's column picked out
  if (SCShare.seat() !== null) S.sel = SCShare.seat();
  buildSheet();
  render();
  if (S.over) showWin();
}

function buildSheet() {
  const n = S.names.length;
  const sheet = $('sheet');
  sheet.style.setProperty('--cols', n);
  // the screen's width follows the players too: see #game.screen in the CSS
  $('game').style.setProperty('--cols', n);
  // Four players share the width; from five, columns keep a readable width
  // and the grid scrolls sideways under the box names.
  sheet.className = 'sheet' + (n > 4 ? ' wide' : '');
  // The rows: the player tiles, then the boxes sharing the height that is
  // left (never under 26px), the totals only as tall as their text.
  sheet.style.gridTemplateRows = ['auto', ...ROWS.map((r) => (r.total ? 'auto' : 'minmax(26px, 1fr)'))].join(' ');
  // a player's tile is just their name: the grand total is at the bottom
  let html = '<div class="corner"></div>';
  S.names.forEach((name, p) => {
    html += `<button class="ptile" data-p="${p}"><span class="pname">${esc(name)}</span></button>`;
  });
  for (const row of ROWS) {
    const id = row.box ? row.box.id : row.ybonus ? 'ybonus' : row.total;
    const split = row.split ? ' split' : '';
    const cls = (row.box ? 'lab box' : row.ybonus ? 'lab box yb' : 'lab tot' + (row.grand ? ' grand' : '')) + split;
    html += `<div class="${cls}" data-row="${id}">${esc(row.box ? row.box.label : row.label)}</div>`;
    S.names.forEach((_, p) => {
      if (row.box || row.ybonus) html += `<button class="cell${split}" data-p="${p}" data-id="${id}"></button>`;
      else html += `<div class="cell tot${row.grand ? ' grand' : ''}" data-p="${p}" data-total="${id}"></div>`;
    });
  }
  sheet.innerHTML = html;
}

$('sheet').addEventListener('click', (e) => {
  const tile = e.target.closest('.ptile');
  // a phone that joined by seat keeps its own column picked out
  if (tile) { if (SCShare.seat() === null) { S.sel = Number(tile.dataset.p); save(); render(); } return; }
  const cell = e.target.closest('button.cell');
  if (cell && !S.over && !mayScore(Number(cell.dataset.p))) return;
  if (cell && !S.over) openEntry(Number(cell.dataset.p), cell.dataset.id);
  else if (cell && S.over) flash('The game is over — Undo to change a score');
});

function render() {
  const sel = S.sel;
  document.querySelectorAll('.ptile').forEach((t) => {
    const p = Number(t.dataset.p);
    t.classList.toggle('sel', p === sel);
    t.classList.toggle('turn', p === S.cur && !S.over);
  });

  document.querySelectorAll('button.cell').forEach((c) => {
    const p = Number(c.dataset.p), id = c.dataset.id;
    if (id === 'ybonus') {
      const n = S.ybonus[p];
      c.textContent = n ? n * YAHTZEE_BONUS : '';
      c.classList.remove('filled', 'open', 'scratch');
      return;
    }
    const v = S.cells[p][id];
    c.textContent = v == null ? '' : v === 0 ? '—' : v;
    c.classList.toggle('scratch', v === 0);
    // the highlight: only the selected player's column
    c.classList.toggle('filled', p === sel && v != null);
    c.classList.toggle('open', p === sel && v == null);
  });

  // the box names follow the selected player's column
  document.querySelectorAll('.lab.box').forEach((l) => {
    const id = l.dataset.row;
    if (id === 'ybonus') return;
    l.classList.toggle('filled', filled(sel, id));
    l.classList.toggle('open', !filled(sel, id));
  });

  document.querySelectorAll('.cell.tot').forEach((c) => {
    const p = Number(c.dataset.p), t = totals(p), k = c.dataset.total;
    if (k === 'upper') c.textContent = t.upper;
    if (k === 'lower') c.textContent = t.lower;
    if (k === 'grand') c.textContent = t.grand;
    if (k === 'bonus') {
      // What the bonus is worth now, always: 35 once earned, 0 until then.
      // Underneath, how far there is to go — or that it was missed, once
      // every upper box is filled without reaching 63.
      const open = UPPER.some((b) => !filled(p, b.id));
      const note = t.bonus ? '' : open ? `${BONUS_AT - t.upper} to go` : 'missed';
      c.innerHTML = `${t.bonus ? BONUS : 0}${note ? `<small>${note}</small>` : ''}`;
      c.classList.toggle('earned', !!t.bonus);
    }
  });
}

/* A passing message takes the title's place in the top bar for a moment:
   anywhere over the sheet would cover a score, and the title's space is
   exactly what is free. */
function flash(text) {
  const t = document.querySelector('.topbar h1');
  t.textContent = text;
  t.classList.add('msg-on');
  clearTimeout(msgTimer);
  msgTimer = setTimeout(() => { t.textContent = 'Yahtzee'; t.classList.remove('msg-on'); }, 2400);
}

/* ---------------- scoring a box ----------------

   Each box offers only what it can be:
     Aces–Sixes      the five possible scores — for Sixes 6, 12, 18, 24, 30
     3/4 of a kind,  the dice total, typed (5 to 30)
     Chance
     the rest        its fixed value
   — and every box can be scratched for 0. */

let entry = null;   // { p, id }

function openEntry(p, id) {
  entry = { p, id };
  const name = S.names[p];
  $('entryWho').textContent = p === S.cur ? `${name}'s turn` : `for ${name}`;
  const body = $('entryBody');
  body.innerHTML = '';
  const v = id === 'ybonus' ? null : S.cells[p][id];
  $('entryEmpty').classList.toggle('hidden', v == null);

  if (id === 'ybonus') {
    $('entryTitle').textContent = 'Yahtzee bonus';
    const n = S.ybonus[p];
    if (S.cells[p].yahtzee !== 50) {
      $('entryHint').textContent = 'Only once the Yahtzee box has scored 50.';
    } else {
      $('entryHint').textContent = `+${YAHTZEE_BONUS} for each extra Yahtzee. ${n ? `${n} so far.` : ''}`;
      body.append(choice(`+${YAHTZEE_BONUS}`, () => { setYBonus(p, n + 1); done(`${name}: Yahtzee bonus +${YAHTZEE_BONUS}`); }, 'big'));
      if (n) body.append(choice('Take one off', () => { setYBonus(p, n - 1); done(); }, 'quiet'));
    }
    $('entryEmpty').classList.add('hidden');
    showEntry();
    return;
  }

  const b = box(id);
  $('entryTitle').textContent = b.label;

  if (b.kind === 'face') {
    $('entryHint').textContent = `How many ${b.label.toLowerCase()}?`;
    const grid = document.createElement('div');
    grid.className = 'face-grid';
    for (let k = 1; k <= 5; k++) {
      grid.append(choice(String(k * b.face), () => score(k * b.face), v === k * b.face ? 'on' : ''));
    }
    body.append(grid);
  } else if (b.kind === 'fixed') {
    $('entryHint').textContent = b.id === 'yahtzee' ? 'Five of a kind.' : '';
    body.append(choice(`Score ${b.value}`, () => score(b.value), 'big' + (v === b.value ? ' on' : '')));
  } else {
    $('entryHint').textContent = 'Add up all five dice.';
    const row = document.createElement('div');
    row.className = 'typed-row';
    const inp = document.createElement('input');
    inp.type = 'number'; inp.inputMode = 'numeric'; inp.min = 5; inp.max = 30;
    inp.placeholder = 'Total, 5–30';
    if (v) inp.value = v;
    const go = choice('Enter', () => {
      const t = Math.round(Number(inp.value));
      if (!(t >= 5 && t <= 30)) { $('entryHint').textContent = 'Five dice add up to between 5 and 30.'; return; }
      score(t);
    }, 'enter');
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') go.click(); });
    row.append(inp, go);
    body.append(row);
    setTimeout(() => inp.focus(), 50);
  }

  body.append(choice('Scratch — 0', () => score(0), 'scratch-btn' + (v === 0 ? ' on' : '')));
  showEntry();
}

function choice(label, onTap, cls) {
  const btn = document.createElement('button');
  btn.className = 'choice ' + (cls || '');
  btn.textContent = label;
  btn.onclick = onTap;
  return btn;
}

function score(v) {
  const { p, id } = entry;
  const turnWas = S.cur;
  setBox(p, id, v);
  done(`${S.names[p]}: ${box(id).label} ${v ? v : 'scratched'}`, turnWas);
}

function done(text, turnWas) {
  closeEntry();
  save(); render();
  // the turn passed: bring the next player's column into view
  if (turnWas != null && S.cur !== turnWas) showColumn(S.cur);
  if (text) flash(text);
  if (S.over) showWin();
}

/* With more players than fit, bring a player's column into view — clear of
   the box names, which stay put over the left of the scrolling grid. */
function showColumn(p) {
  const wrap = document.querySelector('.sheet-wrap');
  if (wrap.scrollWidth <= wrap.clientWidth) return;
  const tile = document.querySelector(`.ptile[data-p="${p}"]`);
  const names = document.querySelector('.corner').getBoundingClientRect().width;
  // the column's place within the scrolling grid, whatever is scrolled now
  const r = tile.getBoundingClientRect(), w = wrap.getBoundingClientRect();
  const left = r.left - w.left + wrap.scrollLeft, right = left + r.width;
  if (left < wrap.scrollLeft + names) wrap.scrollTo({ left: left - names, behavior: 'smooth' });
  else if (right > wrap.scrollLeft + wrap.clientWidth) wrap.scrollTo({ left: right - wrap.clientWidth, behavior: 'smooth' });
}

function closeEntry() { $('entryOverlay').classList.add('hidden'); entry = null; }

/* The scoring panel is a bubble beside the box that was tapped, pointing at
   it: below the box when there is room, above it when there is not, and
   slid sideways to stay on screen — the pointer slides the other way to
   keep pointing at the box. It moves again when the screen changes size,
   as when a phone's keyboard opens for a typed total. */
function showEntry() {
  $('entryOverlay').classList.remove('hidden');
  placeEntry();
}

function placeEntry() {
  if (!entry) return;
  const cell = document.querySelector(`button.cell[data-p="${entry.p}"][data-id="${entry.id}"]`);
  const card = $('entryCard');
  if (!cell) return;
  const vv = window.visualViewport;
  const viewH = vv ? vv.height : window.innerHeight, viewW = window.innerWidth;
  const top0 = vv ? vv.offsetTop : 0;
  const c = cell.getBoundingClientRect();
  const w = card.offsetWidth, h = card.offsetHeight, gap = 10, edge = 8;

  // across: centred on the box, kept on screen
  const left = Math.min(Math.max(c.left + c.width / 2 - w / 2, edge), viewW - w - edge);
  // up or down: wherever it fits, preferring below
  const below = c.bottom + gap + h <= top0 + viewH - edge || c.top - gap - h < top0 + edge;
  let top = below ? c.bottom + gap : c.top - gap - h;
  top = Math.min(Math.max(top, top0 + edge), top0 + viewH - h - edge);

  card.style.left = left + 'px';
  card.style.top = top + 'px';
  card.classList.toggle('below', below);
  card.classList.toggle('above', !below);
  // where along the bubble's edge the pointer sits: over the box's middle
  card.style.setProperty('--ax', Math.min(Math.max(c.left + c.width / 2 - left, 18), w - 18) + 'px');
}

window.addEventListener('resize', placeEntry);
if (window.visualViewport) window.visualViewport.addEventListener('resize', placeEntry);

$('entryClose').onclick = closeEntry;
$('entryOverlay').addEventListener('click', (e) => { if (e.target === $('entryOverlay')) closeEntry(); });
$('entryEmpty').onclick = () => { setBox(entry.p, entry.id, null); done('Box emptied'); };

/* ---------------- undo, new game ---------------- */

$('undoBtn').onclick = () => {
  // A phone scoring one player takes back that player's last score, wherever
  // it is in the log: everyone else's are theirs to take back.
  const seat = SCShare.seat();
  let j = S.log.length - 1;
  if (seat !== null) while (j >= 0 && S.log[j].p !== seat) j--;
  const e = j >= 0 ? S.log.splice(j, 1)[0] : null;
  if (!e) { flash('Nothing to undo'); return; }
  if (e.id === 'ybonus') S.ybonus[e.p] = e.prev;
  else if (e.prev == null) delete S.cells[e.p][e.id];
  else S.cells[e.p][e.id] = e.prev;
  if (seat === null) { S.cur = e.cur; S.sel = e.sel; }
  S.over = gameDone();
  $('winOverlay').classList.add('hidden');
  save(); render();
  flash(`Undid ${S.names[e.p]}'s ${e.id === 'ybonus' ? 'Yahtzee bonus' : box(e.id).label}`);
};

$('quitBtn').onclick = async () => {
  if (S.log.length && !(await askConfirm('This ends the current game and its scores.', 'New game'))) return;
  // given up unfinished: off the profile too
  if (!S.over) SCCloud.drop(S.id);
  SCStore.remove(S.id);
  leaveGame();
};

/* ---------------- the end ---------------- */

function showWin() {
  const g = S.names.map((_, p) => totals(p).grand);
  const top = Math.max(...g);
  const winners = S.names.filter((_, p) => g[p] === top);
  $('winName').textContent = S.names.length === 1 ? `${top} points`
    : winners.length > 1 ? `Tie: ${winners.join(' & ')}` : `${winners[0]} wins!`;
  const order = S.names.map((_, p) => p).sort((a, b) => g[b] - g[a]);
  $('winTable').innerHTML = order.map((p) => `<li><span>${esc(S.names[p])}</span><b>${g[p]}</b></li>`).join('');
  $('winTable').classList.toggle('hidden', S.names.length === 1);
  $('winOverlay').classList.remove('hidden');
  saveToProfile();
}

$('keepBtn').onclick = () => $('winOverlay').classList.add('hidden');
$('rematchBtn').onclick = () => {
  SCStore.remove(S.id);      // finished, and on the profile when signed in
  S = newGame(S.names);
  save();
  SCStore.show(S.id);
  $('winOverlay').classList.add('hidden');
  buildSheet(); render();
};
$('newBtn').onclick = () => { SCStore.remove(S.id); leaveGame(); };

function askConfirm(text, yesLabel) {
  return new Promise((resolve) => {
    $('confirmText').textContent = text;
    $('confirmYes').textContent = yesLabel || 'Yes';
    $('confirmOverlay').classList.remove('hidden');
    const fin = (v) => {
      $('confirmOverlay').classList.add('hidden');
      $('confirmYes').onclick = $('confirmNo').onclick = null;
      resolve(v);
    };
    $('confirmYes').onclick = () => fin(true);
    $('confirmNo').onclick = () => fin(false);
  });
}

/* ---------------- profile ----------------

   A finished game goes to the profile through /api/games, as the other
   games do. Each filled box is a turn — in the order the boxes were filled,
   with what they finally held — and the upper bonus and Yahtzee bonuses are
   turns of their own, so the game page can redraw the whole sheet. */

function toPayload() {
  const counts = [], running = S.names.map(() => 0), turns = [];
  const push = (p, boxId, pts) => {
    const n = counts[p] || 0;
    counts[p] = n + 1;
    running[p] += pts;
    turns.push({ player_idx: p, turn_no: n, detail: [{ box: boxId }], points: pts, bust: false,
      score_after: running[p], created_at: S.startedAt + turns.length });
  };
  // the order each box was first filled in, for each player
  const order = S.names.map(() => []);
  for (const e of S.log) if (e.id !== 'ybonus' && !order[e.p].includes(e.id)) order[e.p].push(e.id);
  S.names.forEach((_, p) => {
    for (const id of order[p]) if (filled(p, id)) push(p, id, S.cells[p][id]);
    const t = totals(p);
    if (t.bonus) push(p, 'bonus', t.bonus);
    if (t.yb) push(p, 'ybonus', t.yb);
  });
  const g = S.names.map((_, p) => totals(p).grand);
  const top = Math.max(...g);
  const winners = g.map((v, p) => (v === top ? p : -1)).filter((p) => p >= 0);
  return {
    id: S.id,
    game_type: 'yahtzee',
    config: { players: S.names.length },
    started_at: S.startedAt,
    me_idx: 0,
    ended_at: S.over ? Date.now() : null,
    winner_idx: S.over && winners.length === 1 ? winners[0] : null,
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
  if (shared) { S = shared.state; showGame(); return; }
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
  type: TYPE,
  get: () => S,
  // A newer game from another phone: an open bubble stays open, pointing
  // at its box wherever it now is.
  apply: (st) => {
    S = st;
    S.over = gameDone();
    if (SCShare.seat() !== null) S.sel = SCShare.seat();
    save();
    if (entry) { buildSheet(); render(); placeEntry(); } else showGame();
  },
  // Shared by seat: a cell a box, '<player>:<box>', and '<player>:ybonus'
  // for the extra Yahtzees.
  cells: {
    names: (st) => st.names,
    of: (st) => {
      const out = {};
      st.names.forEach((_, p) => {
        for (const [id, v] of Object.entries(st.cells[p] || {})) out[`${p}:${id}`] = v;
        if (st.ybonus && st.ybonus[p]) out[`${p}:ybonus`] = st.ybonus[p];
      });
      return out;
    },
    build: fromCells,
  },
});

/* A game rebuilt from its cells (see /share.js), on what this phone had:
   the boxes, the extra Yahtzees, and Undo's list in the order the scores
   came. Whose turn it is follows: the first with the fewest boxes filled.
   A phone scoring one player keeps that player's column picked out. */
function fromCells(base, list) {
  const n = base.names.length;
  const cells = base.names.map(() => ({})), ybonus = base.names.map(() => 0), log = [];
  for (const { key, value } of list) {
    const [ps, id] = key.split(':');
    const p = Number(ps);
    if (!(p >= 0 && p < n) || value == null) continue;
    if (id === 'ybonus') { log.push({ p, id, prev: 0, v: value, cur: p, sel: p }); ybonus[p] = Number(value) || 0; }
    else { log.push({ p, id, prev: null, v: value, cur: p, sel: p }); cells[p][id] = Number(value); }
  }
  const filled = cells.map((c) => Object.keys(c).length);
  const fewest = Math.min(...filled);
  const cur = filled.indexOf(fewest);
  const seat = SCShare.seat();
  return { ...base, cells, ybonus, log, cur, sel: seat !== null ? seat : base.sel };
}

// Whether this phone may score player p: one that joined by seat scores
// its own player only.
function mayScore(p) {
  if (SCShare.canScore(p)) return true;
  flash(`${S.names[p]} is scored on their own phone`);
  return false;
}

$('shareBtn').onclick = () => SCShare.open();

openFromUrl();
