/* Score Chalk — Yahtzee: the pen-and-paper scoresheet, for one to six.

   Players across the top, boxes down the side. Tapping a player shows
   their column at a glance — green where they have scored, yellow where
   they still can — and tapping a box scores it, with only the choices that
   box can take. Filling an open box for the player whose turn it is passes
   the turn on; the game ends when every box on the sheet is filled. */

const KEY = 'yahtzee-v1';
const NAMES_KEY = 'yahtzee-names-v1';
const MAX_PLAYERS = 6;
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
  try { S ? localStorage.setItem(KEY, JSON.stringify(S)) : localStorage.removeItem(KEY); }
  catch (e) { /* private mode, ignore */ }
}
function load() {
  try { return JSON.parse(localStorage.getItem(KEY)); } catch (e) { return null; }
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
let setupN = Math.min(Math.max(setupNames.length, 1), MAX_PLAYERS);

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
  if (load() && !(await askConfirm('This replaces the saved game.', 'Start new game'))) return;
  const names = Array.from({ length: setupN }, (_, i) => (setupNames[i] || '').trim() || `Player ${i + 1}`);
  S = newGame(names);
  save();
  showGame();
};
$('resumeBtn').onclick = () => { S = load(); if (S) showGame(); };

/* ---------------- the sheet ----------------

   A grid: the box names in the first column, a column per player. Rows are
   built once; render() fills the numbers and the highlighting. */

const ROWS = [
  { head: 'Upper section' },
  ...UPPER.map((b) => ({ box: b })),
  { total: 'upper', label: 'Upper total' },
  { total: 'bonus', label: 'Bonus' },
  { head: 'Lower section' },
  ...LOWER.map((b) => ({ box: b })),
  { ybonus: true, label: 'Yahtzee bonus' },
  { total: 'lower', label: 'Lower total' },
  { total: 'grand', label: 'Grand total', grand: true },
];

function showGame() {
  $('setup').classList.add('hidden');
  $('game').classList.remove('hidden');
  buildSheet();
  render();
  if (S.over) showWin();
}

function buildSheet() {
  const n = S.names.length;
  const sheet = $('sheet');
  sheet.style.setProperty('--cols', n);
  sheet.className = 'sheet' + (n >= 5 ? ' many' : '');
  let html = '<div class="corner"></div>';
  S.names.forEach((name, p) => {
    html += `<button class="ptile" data-p="${p}"><span class="pname">${esc(name)}</span><b class="ptotal"></b></button>`;
  });
  for (const row of ROWS) {
    if (row.head) { html += `<div class="sect" style="grid-column:1 / -1">${row.head}</div>`; continue; }
    const id = row.box ? row.box.id : row.ybonus ? 'ybonus' : row.total;
    const cls = row.box ? 'lab box' : row.ybonus ? 'lab box yb' : 'lab tot' + (row.grand ? ' grand' : '');
    html += `<div class="${cls}" data-row="${id}">${esc(row.box ? row.box.label : row.label)}</div>`;
    S.names.forEach((_, p) => {
      if (row.box || row.ybonus) html += `<button class="cell" data-p="${p}" data-id="${id}"></button>`;
      else html += `<div class="cell tot${row.grand ? ' grand' : ''}" data-p="${p}" data-total="${id}"></div>`;
    });
  }
  sheet.innerHTML = html;
}

$('sheet').addEventListener('click', (e) => {
  const tile = e.target.closest('.ptile');
  if (tile) { S.sel = Number(tile.dataset.p); save(); render(); return; }
  const cell = e.target.closest('button.cell');
  if (cell && !S.over) openEntry(Number(cell.dataset.p), cell.dataset.id);
  else if (cell && S.over) flash('The game is over — Undo to change a score');
});

function render() {
  const sel = S.sel;
  document.querySelectorAll('.ptile').forEach((t) => {
    const p = Number(t.dataset.p);
    t.classList.toggle('sel', p === sel);
    t.classList.toggle('turn', p === S.cur && !S.over);
    t.querySelector('.ptotal').textContent = totals(p).grand;
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

function flash(text) {
  $('msg').textContent = text;
  clearTimeout(msgTimer);
  msgTimer = setTimeout(() => { $('msg').textContent = ''; }, 2400);
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
    $('entryOverlay').classList.remove('hidden');
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
  $('entryOverlay').classList.remove('hidden');
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
  setBox(p, id, v);
  done(`${S.names[p]}: ${box(id).label} ${v ? v : 'scratched'}`);
}

function done(text) {
  closeEntry();
  save(); render();
  if (text) flash(text);
  if (S.over) showWin();
}

function closeEntry() { $('entryOverlay').classList.add('hidden'); entry = null; }

$('entryClose').onclick = closeEntry;
$('entryOverlay').addEventListener('click', (e) => { if (e.target === $('entryOverlay')) closeEntry(); });
$('entryEmpty').onclick = () => { setBox(entry.p, entry.id, null); done('Box emptied'); };

/* ---------------- undo, new game ---------------- */

$('undoBtn').onclick = () => {
  const e = S.log.pop();
  if (!e) { flash('Nothing to undo'); return; }
  if (e.id === 'ybonus') S.ybonus[e.p] = e.prev;
  else if (e.prev == null) delete S.cells[e.p][e.id];
  else S.cells[e.p][e.id] = e.prev;
  S.cur = e.cur; S.sel = e.sel;
  S.over = gameDone();
  $('winOverlay').classList.add('hidden');
  save(); render();
  flash(`Undid ${S.names[e.p]}'s ${e.id === 'ybonus' ? 'Yahtzee bonus' : box(e.id).label}`);
};

$('quitBtn').onclick = async () => {
  if (S.log.length && !(await askConfirm('This ends the current game and its scores.', 'New game'))) return;
  S = null; save();
  location.reload();
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
  S = newGame(S.names);
  save();
  $('winOverlay').classList.add('hidden');
  buildSheet(); render();
};
$('newBtn').onclick = () => { S = null; save(); location.reload(); };

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
    ended_at: Date.now(),
    winner_idx: winners.length === 1 ? winners[0] : null,
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
