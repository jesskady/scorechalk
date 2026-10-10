/* Score Chalk — Magic: The Gathering. Life, poison and commander damage.

   The phone lies in the middle of the table and the screen is split, one
   panel per player, each turned to face its seat. A panel's life box is
   split across the middle: the half nearer its player takes a life, the
   far half gives one back, and holding either repeats. Below the life sit
   poison and, in Commander, commander damage, each opening a small counter
   of its own.

   A player is out at 0 life, 10 poison, or 21 damage from any one
   commander; when one player is left standing they win. */

// games are kept by id, every kind together: see /store.js
const TYPE = 'magic';
const NAMES_KEY = 'magic-names-v1';
const POISON_OUT = 10, CMDR_OUT = 21;
const COLORS = ['#d9534f', '#3b82f6', '#2e9e63', '#e0b341', '#a066d3', '#e07b39'];

const FORMATS = {
  constructed: { label: 'Constructed', life: 20, players: 2, min: 1, max: 4,
    sub: '20 life · out at 0 life or 10 poison' },
  commander: { label: 'Commander', life: 40, players: 4, min: 2, max: 6, commander: true,
    sub: '40 life · out at 0 life, 10 poison, or 21 from one commander' },
};

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

let S = null;   // the game

/* ---------------- state ---------------- */

function newGame(format, names, life) {
  const n = names.length;
  return {
    // so every save to the profile updates the one row
    id: crypto.randomUUID(),
    startedAt: Date.now(),
    format, names, start: life,
    life: names.map(() => life),
    poison: names.map(() => 0),
    // cmdr[p][q]: damage player p has taken from player q's commander
    cmdr: names.map(() => names.map(() => 0)),
    log: [],        // every change, for Undo: { p, what, q, d }
    won: false,     // the winner has been announced
  };
}

function save() {
  if (!S) return;
  SCStore.put(TYPE, S, !!S.won);
  // and to the profile, when signed in (see /cloud.js)
  if (window.SCCloud) SCCloud.keep(cloudGame);
}

/* The game as the profile keeps it, while it is being played: its own state,
   to pick it up again by. A Magic game has no history on the profile yet, so
   it goes there only while it is in progress, and comes off once it is won.
   Nothing until a life total has changed. */
function cloudGame() {
  if (!S || !S.log.length || S.won) return null;
  // a game started before ids gets one, kept with it
  if (!S.id) {
    S.id = crypto.randomUUID();
    S.startedAt = Date.now();
    SCStore.put(TYPE, S, false);
  }
  return {
    id: S.id,
    game_type: 'magic',
    config: { format: S.format, start: S.start },
    started_at: S.startedAt,
    me_idx: 0,
    ended_at: null,
    winner_idx: null,
    players: S.names.map((name, idx) => ({ idx, name })),
    turns: [],
    state: S,
  };
}
/* The game for #play: the one whose id is in the address — a link to it,
   or a reload — or else the newest in progress here, for Resume. */
function load() {
  const at = SCStore.urlId();
  const g = at ? SCStore.get(at.id) : SCStore.latest(TYPE);
  return g && g.type === TYPE ? g.state : null;
}

// Why a player is out, or null while they are still in.
function outReason(p) {
  if (S.life[p] <= 0) return 'Out of life';
  if (S.poison[p] >= POISON_OUT) return 'Poisoned';
  if (S.cmdr[p].some((d) => d >= CMDR_OUT)) return 'Commander damage';
  return null;
}

/* Every change goes through here. Commander damage is life lost as well —
   you record the hit once — so it moves both counters together, and taking
   it back off gives the life back. */
function change(p, what, d, q) {
  if (what === 'life') S.life[p] += d;
  if (what === 'poison') { d = Math.max(-S.poison[p], d); S.poison[p] += d; }
  if (what === 'cmdr') {
    d = Math.max(-S.cmdr[p][q], d);
    S.cmdr[p][q] += d;
    S.life[p] -= d;
  }
  if (!d) return;
  S.log.push({ p, what, q, d });
  if (S.log.length > 2000) S.log.shift();
}

function undo() {
  const e = S.log.pop();
  if (!e) return false;
  if (e.what === 'life') S.life[e.p] -= e.d;
  if (e.what === 'poison') S.poison[e.p] -= e.d;
  if (e.what === 'cmdr') { S.cmdr[e.p][e.q] -= e.d; S.life[e.p] += e.d; }
  return true;
}

/* ---------------- screens ---------------- */

function show(id) {
  for (const s of ['formats', 'setup', 'game']) $(s).classList.toggle('hidden', s !== id);
  document.body.classList.toggle('playing', id === 'game');
  window.scrollTo(0, 0);
}

// '' the format choice, #constructed or #commander its setup, #play the game.
function route() {
  const h = location.hash.slice(1);
  for (const o of ['menuOverlay', 'winOverlay', 'confirmOverlay']) $(o).classList.add('hidden');
  if (h === 'play') {
    S = load();
    // its id in the address, so a link to the page is a link to the game
    if (S) { SCStore.show(S.id, '#play'); showGame(); return; }
  }
  releaseWake();
  if (FORMATS[h]) { openSetup(h); return; }
  $('resumeBtn').classList.toggle('hidden', !SCStore.latest(TYPE));
  // Resume: the newest game in progress, whatever game was last in the address
  if (SCStore.urlId()) SCStore.leave();
  show('formats');
}
window.addEventListener('hashchange', route);

/* ---------------- setup ---------------- */

let fmt = 'constructed', setupN = 2;
let setupNames = (() => {
  try { return JSON.parse(localStorage.getItem(NAMES_KEY)) || []; } catch (e) { return []; }
})();

function openSetup(f) {
  fmt = f;
  const F = FORMATS[f];
  setupN = F.players;
  $('setupTitle').textContent = F.label;
  $('setupSub').textContent = F.sub;
  $('life').value = F.life;
  renderSetup();
  show('setup');
}

function renderSetup() {
  const F = FORMATS[fmt];
  $('pCount').textContent = setupN;
  $('pMinus').disabled = setupN <= F.min;
  $('pPlus').disabled = setupN >= F.max;
  const box = $('names');
  box.classList.toggle('one', setupN === 1);
  box.innerHTML = '';
  for (let i = 0; i < setupN; i++) {
    const row = document.createElement('label');
    row.className = 'name-row';
    row.innerHTML = `<span class="dot" style="background:${COLORS[i]}"></span>`;
    const inp = document.createElement('input');
    inp.type = 'text'; inp.maxLength = 12; inp.autocomplete = 'off';
    inp.placeholder = `Player ${i + 1}`;
    inp.value = setupNames[i] || '';
    inp.addEventListener('input', () => {
      setupNames[i] = inp.value;
      try { localStorage.setItem(NAMES_KEY, JSON.stringify(setupNames)); } catch (e) {}
    });
    row.appendChild(inp);
    box.appendChild(row);
  }
}

$('pMinus').onclick = () => { if (setupN > FORMATS[fmt].min) { setupN--; renderSetup(); } };
$('pPlus').onclick = () => { if (setupN < FORMATS[fmt].max) { setupN++; renderSetup(); } };

$('startBtn').onclick = async () => {
  // a new game of its own: any in progress stay, under Pick up where you left off
  const life = Math.max(1, Math.round(Number($('life').value)) || FORMATS[fmt].life);
  const names = Array.from({ length: setupN }, (_, i) => (setupNames[i] || '').trim() || `Player ${i + 1}`);
  S = newGame(fmt, names, life);
  save();
  SCStore.show(S.id, '#play');
  route();
};

/* ---------------- the table ----------------

   Panels fill the screen in two rows, the top row turned to face the far
   side of the table — 2 players: one each side; 3: one across, two near;
   4: two and two; 5: three and two; 6: three and three. One player gets
   the whole screen. */

const TOP = { 1: 0, 2: 1, 3: 1, 4: 2, 5: 3, 6: 3 };

function showGame() {
  show('game');
  buildTable();
  render();
  keepAwake();
  if (S.won) showWin();
}

function buildTable() {
  const n = S.names.length, top = TOP[n];
  const box = $('panels');
  box.className = `panels n${n}`;
  box.innerHTML = '';
  S.names.forEach((name, p) => {
    const panel = document.createElement('div');
    panel.className = 'panel' + (p < top ? ' flip' : '');
    panel.style.setProperty('--pc', COLORS[p]);
    panel.innerHTML = `
      <div class="inner">
        <span class="pname">${esc(name)}</span>
        <button class="half plus" aria-label="${esc(name)}: gain a life"><i>+</i></button>
        <button class="half minus" aria-label="${esc(name)}: lose a life"><i>−</i></button>
        <div class="life"><b class="num"></b><span class="delta"></span></div>
        <div class="out-tag"></div>
        <!-- In the far half, with the rarer gain-a-life side, so the near half
             is all for taking life. One button for both counters. -->
        <button class="chip counters" aria-label="Poison${S.format === 'commander' ? ' and commander damage' : ''}">
          ${S.format === 'commander' ? '<span class="ci">⚔ <b class="cc"></b></span>' : ''}
          <span class="ci">☠ <b class="cp"></b></span>
        </button>
        <div class="counter hidden"></div>
      </div>`;
    hold(panel.querySelector('.plus'), () => tapLife(p, +1));
    hold(panel.querySelector('.minus'), () => tapLife(p, -1));
    panel.querySelector('.counters').onclick = () => openCounter(p);
    box.appendChild(panel);
  });
  placeSides();
}

/* Each panel's outside: the edge of the screen it sits against, in the
   panel's own turned frame. The + and − marks and the name go on that side,
   the counters button in the upper inside corner, so nothing sits on the
   change bubble over the life total. A turned panel is mirrored, so its
   screen-left is its own right. A panel the full width of the screen has
   no inside: marks and name on its player's left, the button on their
   right. In a middle column, the left counts as outside. */
function placeSides() {
  const W = window.innerWidth;
  [...$('panels').children].forEach((panel) => {
    const r = panel.getBoundingClientRect();
    let screenLeft = true;
    if (r.width < W * 0.6) screenLeft = r.left + r.width / 2 <= W / 2 + 1;
    const flipped = panel.classList.contains('flip');
    const outLeft = r.width >= W * 0.6 ? true : screenLeft !== flipped;
    panel.dataset.out = outLeft ? 'l' : 'r';
  });
}
window.addEventListener('resize', () => { if (S && !$('game').classList.contains('hidden')) placeSides(); });

/* Hold to repeat: one step on press, then quicker steps while held. */
function hold(el, step) {
  let timer = null;
  const stop = () => { clearTimeout(timer); timer = null; };
  el.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    step();
    let wait = 420;
    const again = () => { step(); wait = Math.max(70, wait * 0.8); timer = setTimeout(again, wait); };
    timer = setTimeout(again, wait);
  });
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) el.addEventListener(ev, stop);
  el.addEventListener('contextmenu', (e) => e.preventDefault());
}

// The ± bubble beside a life total: the change so far, gone a moment after.
const deltas = {};
function tapLife(p, d) {
  change(p, 'life', d);
  const k = deltas[p] || (deltas[p] = { sum: 0, timer: null });
  k.sum += d;
  clearTimeout(k.timer);
  k.timer = setTimeout(() => { k.sum = 0; render(); }, 1600);
  afterChange();
}

function afterChange() {
  save();
  render();
  const alive = S.names.map((_, p) => p).filter((p) => !outReason(p));
  if (S.names.length > 1 && alive.length === 1 && !S.won) {
    S.won = true; save(); showWin();
    SCCloud.drop(S.id);      // won: no longer in progress anywhere
  }
  if (alive.length > 1 && S.won) { S.won = false; save(); }   // a fix brought someone back
}

function render() {
  [...$('panels').children].forEach((panel, p) => {
    panel.querySelector('.num').textContent = S.life[p];
    const k = deltas[p];
    const dl = panel.querySelector('.delta');
    dl.textContent = k && k.sum ? (k.sum > 0 ? '+' : '−') + Math.abs(k.sum) : '';
    dl.classList.toggle('up', !!(k && k.sum > 0));
    const out = outReason(p);
    panel.classList.toggle('out', !!out);
    panel.querySelector('.out-tag').textContent = out || '';
    // poison, and the most taken from any one commander — the one that counts
    const btn = panel.querySelector('.counters');
    btn.querySelector('.cp').textContent = S.poison[p];
    const cc = btn.querySelector('.cc');
    const worst = Math.max(...S.cmdr[p]);
    if (cc) cc.textContent = worst;
    btn.classList.toggle('some', S.poison[p] > 0 || worst > 0);
    if (openFor && openFor.p === p) updateCounter(panel);
  });
}

/* ---------------- poison and commander damage ----------------

   One counter opens over the player's own panel, facing them: a row for
   poison, then in Commander a row per opponent, since 21 from any one
   commander is what counts. */

let openFor = null;   // { p }

function openCounter(p) {
  closeCounter();
  openFor = { p };
  // the menu button shares a corner with the counter's rows; out of the way
  document.body.classList.add('counting');
  drawCounter($('panels').children[p]);
}

// a row's counter: 'poison', or 'cmdr' and the opponent it is from
const rowValue = (p, row) => (row.dataset.what === 'poison' ? S.poison[p] : S.cmdr[p][Number(row.dataset.q)]);
const rowMax = (row) => (row.dataset.what === 'poison' ? POISON_OUT : CMDR_OUT);

function closeCounter() {
  if (!openFor) return;
  $('panels').children[openFor.p].querySelector('.counter').classList.add('hidden');
  document.body.classList.remove('counting');
  openFor = null;
}

// Just the numbers: redrawing the rows would pull a held button out from
// under the finger, and its repeat would never hear the finger lift.
function updateCounter(panel) {
  const { p } = openFor;
  panel.querySelectorAll('.counter .crow').forEach((row) => {
    const v = rowValue(p, row);
    const b = row.querySelector('b');
    b.textContent = v;
    b.classList.toggle('lethal', v >= rowMax(row));
  });
}

function drawCounter(panel) {
  const { p } = openFor;
  const box = panel.querySelector('.counter');
  const row = (label, color, value, max, what, q) => `
    <div class="crow" data-what="${what}" data-q="${q == null ? '' : q}">
      <span class="clabel">${color ? `<i style="background:${color}"></i>` : ''}${esc(label)}</span>
      <button class="cstep" data-d="-1">−</button>
      <b class="${value >= max ? 'lethal' : ''}">${value}</b>
      <button class="cstep" data-d="1">+</button>
    </div>`;
  // A bar pinned to the top with the player and a close button, so the
  // counter can be shut without scrolling to Done — a long list scrolls, in
  // landscape especially — and the rows scroll under it, not under the ×.
  let html = `<div class="cbar"><b>${esc(S.names[p])}</b><button class="cx" aria-label="Close">×</button></div>`;
  // Commander damage first, poison last: poison is the rarer of the two.
  if (S.format === 'commander') {
    html += `<div class="chead"><span>Commander damage</span><small>out at ${CMDR_OUT} from any one</small></div>`;
    S.names.forEach((nm, q) => { if (q !== p) html += row(`From ${nm}`, COLORS[q], S.cmdr[p][q], CMDR_OUT, 'cmdr', q); });
  }
  html += `<div class="chead${S.format === 'commander' ? ' sec' : ''}"><span>Poison</span><small>out at ${POISON_OUT}</small></div>`;
  // the heading already says poison; the row needs no label of its own
  html += row('', null, S.poison[p], POISON_OUT, 'poison', null);
  // Done along the bottom, full width: the heading is too narrow for it
  // with five or six players across
  html += '<button class="cdone">Done</button>';
  box.innerHTML = html;
  box.classList.remove('hidden');
  // always open at the top, whatever it was scrolled to last time
  box.scrollTop = 0;
  for (const sel of ['.cdone', '.cx']) box.querySelector(sel).onclick = (e) => { e.stopPropagation(); closeCounter(); };
  box.querySelectorAll('.cstep').forEach((b) => {
    hold(b, () => {
      const row = b.closest('.crow');
      const q = row.dataset.q;
      change(p, row.dataset.what, Number(b.dataset.d), q === '' ? undefined : Number(q));
      afterChange();
    });
  });
}

/* ---------------- menu, winner ---------------- */

$('hubBtn').onclick = () => { closeCounter(); $('menuOverlay').classList.remove('hidden'); };
$('menuClose').onclick = () => $('menuOverlay').classList.add('hidden');
$('undoBtn').onclick = () => {
  if (undo()) { $('menuOverlay').classList.add('hidden'); afterChange(); }
  else $('undoBtn').textContent = 'Nothing to undo';
  setTimeout(() => { $('undoBtn').textContent = 'Undo the last change'; }, 1500);
};
$('restartBtn').onclick = async () => {
  $('menuOverlay').classList.add('hidden');
  if (S.log.length && !(await askConfirm('Start over at full life with the same players?', 'Restart'))) return;
  restart();
};
$('setupLink').onclick = (e) => { e.preventDefault(); $('menuOverlay').classList.add('hidden'); location.hash = S.format; };

// Starting over at full life is a new game: the old one goes, from the
// profile too while it was still in progress.
function restart() {
  if (!S.won) SCCloud.drop(S.id);
  SCStore.remove(S.id);
  S = newGame(S.format, S.names, S.start);
  for (const k of Object.keys(deltas)) delete deltas[k];
  save();
  SCStore.show(S.id, '#play');
  $('winOverlay').classList.add('hidden');
  buildTable(); render();
}

function showWin() {
  const p = S.names.findIndex((_, i) => !outReason(i));
  $('winName').textContent = `${S.names[p]} wins!`;
  $('winOverlay').classList.remove('hidden');
}
$('rematchBtn').onclick = restart;
$('keepBtn').onclick = () => $('winOverlay').classList.add('hidden');

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

/* ---------------- keep the screen on ----------------
   A phone left lying on the table would otherwise dim and lock mid-game.
   Where the browser can't, the game simply works as before. */

let wake = null;
async function keepAwake() {
  try { if ('wakeLock' in navigator && !wake) wake = await navigator.wakeLock.request('screen'); }
  catch (e) { /* not allowed or not supported */ }
  if (wake) wake.addEventListener('release', () => { wake = null; });
}
function releaseWake() { if (wake) { wake.release(); wake = null; } }
// the lock lapses when the page is hidden; take it again on return
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && location.hash === '#play' && S) keepAwake();
});

/* ?g=<id> — a game's own address: a link to it, or a reload. The game is
   opened from this device or, signed in, from the profile; ?resume=<id>
   asks for the profile's copy first, as it has been played on elsewhere. */
async function openFromUrl() {
  const at = SCStore.urlId();
  if (!at) { route(); return; }
  const st = await SCStore.open(TYPE, at.id, at.fresh);
  if (st) { SCStore.show(st.id, '#play'); route(); return; }
  SCStore.leave();
  route();
  SCStore.notice("That game isn't on this device. Sign in to open games saved to your profile.");
}

/* ---------------- boot ---------------- */

openFromUrl();
