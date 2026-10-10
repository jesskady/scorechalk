/* Score Chalk — countdown scoring for one to four players */

// games are kept by id, every kind together: see /store.js
const TYPE = 'darts';
const MAX_DARTS = 3;

const $ = (id) => document.getElementById(id);

let S = null;      // game state, null until a game starts
let msgTimer = null;
let signedIn = false;   // set once /api/me answers; see buildSetup

/* ---------------- state ---------------- */

function makePlayer(name, start, doubleIn) {
  return { name, score: start, points: 0, turns: 0, opened: !doubleIn };
}

function newGame(names, start, rules) {
  return {
    // Chosen here, not by the server, so saving the same game twice updates
    // one row instead of creating two.
    id: crypto.randomUUID(),
    startedAt: Date.now(),
    // which player is the account holder, chosen on the setup screen
    meIdx: rules.meIdx || 0,
    players: names.map(n => makePlayer(n, start, rules.doubleIn)),
    start,
    doubleIn: !!rules.doubleIn,
    doubleOut: !!rules.doubleOut,
    cur: 0,
    darts: [],       // {label, val, dbl}
    mult: 1,
    log: [],         // completed turns, for undo
    over: false
  };
}

function save() {
  if (S) SCStore.put(TYPE, S, !!S.over);
}

// The newest darts game in progress here, for the setup's Resume.
function load() {
  const g = SCStore.latest(TYPE);
  return g ? g.state : null;
}

// A game on screen has its id in the address: a link to it opens it.
function openGame(state) {
  S = state;
  // a game saved before ids existed still needs one to sync
  if (!S.id) { S.id = crypto.randomUUID(); S.startedAt = S.startedAt || Date.now(); }
  save();
  SCStore.show(S.id);
  showGame();
}

// Leaving a game: back to the setup, the address without it.
function leaveGame() {
  location.replace(location.pathname);
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

  const showMeRow = () => meRow.classList.toggle('hidden', !signedIn || playerCount < 2);

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
      $('label1').textContent = playerCount === 1 ? 'Name' : 'Player 1';
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
      meIdx: playerCount === 1 ? 0 : meIdx
    });
    openGame(S);
  });

  const saved = load();
  if (saved && !saved.over) {
    const btn = $('resumeBtn');
    btn.textContent = 'Resume: ' + saved.players.map(p => p.name).join(' vs ');
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
  if (shared) { S = shared.state; showGame(); return; }
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

  $('confirmYes').addEventListener('click', () => closeConfirm(true));
  $('confirmNo').addEventListener('click', () => closeConfirm(false));
  $('confirmOverlay').addEventListener('click', e => {
    if (e.target === $('confirmOverlay')) closeConfirm(false);   // tap outside cancels
  });

  $('quitBtn').addEventListener('click', async () => {
    const names = S.players.map(p => `${p.name} on ${p.score}`).join(' and ');
    const ok = await askConfirm(S.over
      ? 'This clears the finished game and goes back to setup.'
      : `This discards the game in progress — ${names}${signedIn ? ', from your profile too' : ''} — and goes back to setup.`,
      'End game');
    if (!ok) return;
    if (!S.over && window.SCCloud) SCCloud.drop(S.id);
    SCStore.remove(S.id);
    leaveGame();
  });

  $('rematchBtn').addEventListener('click', () => {
    SCStore.remove(S.id);      // finished, and on the profile when signed in
    S = newGame(S.players.map(p => p.name), S.start,
                { doubleIn: S.doubleIn, doubleOut: S.doubleOut, meIdx: S.meIdx });
    save();
    SCStore.show(S.id);
    $('winOverlay').classList.add('hidden');
    render();
  });

  $('newBtn').addEventListener('click', () => { SCStore.remove(S.id); leaveGame(); });

  // tapping a player card switches whose turn it is (fixes mis-taps)
  [0, 1, 2, 3].forEach(i => {
    $('p' + i).addEventListener('click', () => {
      if (S.over || S.cur === i || i >= S.players.length) return;
      if (S.darts.length) { say('Clear the current turn first'); return; }
      S.cur = i;
      render(); save();
    });
  });
}

function showGame() {
  $('setup').classList.add('hidden');
  $('game').classList.remove('hidden');
  render();
}

/* ---------------- dart entry ---------------- */

function addDart(n, isBull = false) {
  if (S.over) return;
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

/* Where a turn of `pts` leaves the current player, and whether it's legal.
   Shared by the live projection, the submit button and submitTurn itself. */
function outcome(pts) {
  const left = S.players[S.cur].score - pts;

  if (left < 0) return { left, bust: true, win: false, why: 'overshot' };

  if (S.doubleOut) {
    if (left === 1) return { left, bust: true, win: false, why: 'left 1' };
    if (left === 0) {
      const last = S.darts[S.darts.length - 1];
      if (!last || !last.dbl) {
        return { left, bust: true, win: false, why: 'no double to finish' };
      }
    }
  }

  return { left, bust: false, win: left === 0, why: '' };
}

/* Splits the turn in progress into what actually scores and what doesn't.
   Under double-in, darts thrown before the opening double are shown but
   score nothing. `open` is the player's state once the turn is applied. */
function breakdown() {
  const p = S.players[S.cur];

  let open = p.opened;
  let pts = 0;
  const counted = [];

  for (const d of S.darts) {
    if (!open) {
      if (!d.dbl) { counted.push(false); continue; }  // still not in
      open = true;
    }
    counted.push(true);
    pts += d.val;
  }

  return { pts, counted, open };
}

function turnPoints() {
  return breakdown().pts;
}

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
   T20 T19 D12 and T19 T20 D12 as though they were different ideas. */
function searchFinish(target, darts, needDouble, mustOpenDouble) {
  const finishers = needDouble ? FINISH_DOUBLES : FINISH_ANY;
  const seen = new Map();   // signature -> { path, cost }

  const consider = (path, cost) => {
    const sig = path.slice(0, -1).map(t => t.label).sort().join(',')
      + '>' + path[path.length - 1].label;
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

/* Ways to finish, shortest first and cheapest first within that, or empty.
   Only the shortest dart count is offered: if a leg can be closed in one
   dart, walking the player through three-dart routes to the same number is
   noise, not an alternative. Capped so cycling stays a short loop.
   Memoised because render() asks on every dart tapped. */
const MAX_SUGGESTIONS = 6;
const finishCache = new Map();

function finishKey(target, dartsLeft, needDouble, mustOpenDouble) {
  return `${target}|${dartsLeft}|${needDouble ? 1 : 0}|${mustOpenDouble ? 1 : 0}`;
}

function findFinishes(target, dartsLeft, needDouble, mustOpenDouble) {
  if (target < 1 || dartsLeft < 1) return [];

  const key = finishKey(target, dartsLeft, needDouble, mustOpenDouble);
  if (finishCache.has(key)) return finishCache.get(key);

  let paths = [];
  for (let k = 1; k <= dartsLeft && !paths.length; k++) {
    paths = searchFinish(target, k, needDouble, mustOpenDouble);
  }
  paths = paths.slice(0, MAX_SUGGESTIONS);
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
  if (S.over) return;

  const { pts, open } = breakdown();
  if (pts > 180) { say('Max 180 in three darts'); return; }

  const p = S.players[S.cur];
  const before = p.score;
  const wasOpen = p.opened;
  const { left, bust, win, why } = outcome(pts);

  S.log.push({
    player: S.cur,
    before,
    wasOpen,
    pts,
    bust,
    darts: S.darts.slice()
  });

  p.turns += 1;
  p.opened = open;              // a landed double opens you even if the turn busts
  if (!bust) {
    p.score = left;
    p.points += pts;
  }

  S.darts = [];
  S.mult = 1;

  if (win) {
    S.over = true;
    S.winner = S.cur;
    render(); save();
    showWin(p);
    // fire and forget: the win is already safe locally
    autoSave();
    return;
  }

  if (bust) say(`Bust — ${why}. ${p.name} stays on ${before}`);
  else if (S.doubleIn && !wasOpen && open) say(`${p.name} is in`);
  else if (S.doubleIn && !open) say(`${p.name} still needs a double to open`);

  passTurn();
  render(); save();
  autoSave();
}

/* Manual bust: the turn scores nothing and play passes. For busts the app
   can't infer on its own — a bounce-out, a mis-entry, a throw out of turn. */
function bustTurn() {
  if (S.over) return;

  const p = S.players[S.cur];
  const { open } = breakdown();

  S.log.push({
    player: S.cur,
    before: p.score,
    wasOpen: p.opened,
    pts: 0,
    bust: true,
    darts: S.darts.slice()
  });

  p.turns += 1;
  p.opened = open;        // same as an automatic bust: a landed double still opens
  // p.score deliberately untouched — that is what a bust means

  S.darts = [];
  S.mult = 1;

  say(`Bust — ${p.name} stays on ${p.score}`);
  passTurn();
  render(); save();
  autoSave();
}

/* Signed in, the game goes to the profile after every turn — and after an
   Undo, and when it is won — so it can be picked up on another device and
   isn't lost with this one. Silent: localStorage is still the live game, and
   a save that fails is simply made whole by the next one. One save at a
   time, so an older one can never land after a newer; turns played while one
   is on its way go up together in the next. A game with no turns isn't
   saved until it has one. */
let saving = false, saveAgain = false;
async function autoSave() {
  if (!S || !window.SCSync) return;
  if (!S.log.length && typeof S.savedTurns !== 'number') return;
  if (saving) { saveAgain = true; return; }
  saving = true;
  const g = S;
  try {
    const who = await window.SCSync.me();
    if (who && who.user) await window.SCSync.saveNow(g);
    if (g === S) save();          // persist the new savedTurns mark
  } catch (e) { /* the next turn tries again */ }
  saving = false;
  if (saveAgain) { saveAgain = false; autoSave(); }
}

// play goes round the players in order
function passTurn() {
  S.cur = (S.cur + 1) % S.players.length;
}

async function undoTurn() {
  // a turn in progress is discarded first, whether or not anything is logged
  if (S.darts.length) {
    const thrown = S.darts.map(d => d.label).join(', ');
    const ok = await askConfirm(
      `This clears the ${S.darts.length} dart${S.darts.length > 1 ? 's' : ''} entered for this turn (${thrown}).`,
      'Clear turn');
    if (!ok) return;
    S.darts = []; S.mult = 1;
    render(); save();
    say('Current turn cleared');
    return;
  }

  if (!S.log.length) { say('Nothing to undo'); return; }

  const prev = S.log[S.log.length - 1];
  const who = S.players[prev.player];
  const okUndo = await askConfirm(
    `This rolls back ${who.name}'s last turn of ${prev.pts}` +
    (prev.bust ? ' (a bust)' : '') + `, back to ${prev.before}.`,
    'Undo turn');
  if (!okUndo) return;

  const last = S.log.pop();
  const p = S.players[last.player];
  p.score = last.before;
  p.turns -= 1;
  if (last.wasOpen !== undefined) p.opened = last.wasOpen;
  if (!last.bust) p.points -= last.pts;

  S.cur = last.player;
  S.over = false;
  S.winner = undefined;
  $('winOverlay').classList.add('hidden');

  render(); save();
  autoSave();
  say(`Undid ${p.name}'s ${last.pts}`);
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

function renderCheckout(left) {
  const box = $('checkout');
  const dartsLeft = MAX_DARTS - S.darts.length;
  const mustOpen = S.doubleIn && !S.players[S.cur].opened;

  if (S.over || dartsLeft < 1 || left < 1) {
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

function showWin(p) {
  const solo = S.players.length === 1;
  const avg = p.turns ? (p.points / p.turns).toFixed(1) : '0';
  $('winName').textContent = solo ? `${p.name} checked out!` : `${p.name} wins!`;
  $('winStats').textContent = `${S.start} down in ${p.turns} turns · ${avg} average`;
  $('rematchBtn').textContent = solo ? 'Go again' : 'Rematch';
  $('winOverlay').classList.remove('hidden');
}

/* ---------------- render ---------------- */

function render() {
  if (!S) return;

  const { pts, counted } = breakdown();
  const solo = S.players.length === 1;
  const p0 = S.players[S.cur];

  // rule badges; double-in turns red until the player has opened
  $('badges').classList.toggle('hidden', !S.doubleIn && !S.doubleOut);
  $('bIn').classList.toggle('hidden', !S.doubleIn);
  $('bOut').classList.toggle('hidden', !S.doubleOut);
  if (S.doubleIn) {
    const needs = !p0.opened && !S.over;
    $('bIn').classList.toggle('alert', needs);
    $('bIn').textContent = needs ? `${p0.name} needs a double to open` : 'Double in';
  }

  // scoreboard
  $('scoreboard').classList.toggle('solo', solo);
  // three or four across: the player on turn gets the wide card
  $('scoreboard').classList.toggle('crowded', S.players.length > 2);
  [0, 1, 2, 3].forEach(i => $('p' + i).classList.toggle('hidden', i >= S.players.length));

  S.players.forEach((p, i) => {
    const el = $('p' + i);
    const isTurn = i === S.cur && !S.over;
    el.classList.toggle('active', isTurn);
    el.querySelector('.pname').textContent = p.name;
    el.querySelector('.pnum').textContent = p.score;

    // live projection of where this turn leaves them
    const pend = el.querySelector('.ppend');
    el.classList.toggle('pending', isTurn && pts > 0);
    pend.classList.remove('bust', 'checkout');
    if (isTurn && pts > 0) {
      const o = outcome(pts);
      if (o.bust) {
        pend.textContent = '→ bust';
        pend.classList.add('bust');
      } else {
        pend.textContent = '→ ' + o.left;
        if (o.win) pend.classList.add('checkout');
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

  renderCheckout(outcome(pts).left);

  // submit button
  const btn = $('submitBtn');
  const o = outcome(pts);
  if (S.over) {
    btn.textContent = 'Game over';
  } else if (pts > 0 && o.bust) {
    btn.textContent = `Submit ${pts} — bust`;
  } else if (o.win) {
    btn.textContent = `Submit ${pts} — checkout!`;
  } else {
    btn.textContent = solo ? `Submit ${pts}` : `Submit ${pts} for ${p0.name}`;
  }
}

/* ---------------- boot ---------------- */

buildSetup();
buildBoard();

/* Shared by link (see /share.js): the game on screen, and how to show a
   newer one when it comes in from another phone. */
SCShare.attach({ type: TYPE, get: () => S, apply: applyShared });

/* A newer game from another phone. The darts this phone has entered for
   the turn on the oche carry over, while that turn is still waiting: the
   same player up, no turn entered since. If the turn has been entered on
   the other phone meanwhile, these darts are let go, and it says so. */
function applyShared(st) {
  const mine = S && !S.over && (S.darts.length || S.mult !== 1)
    ? { darts: S.darts, mult: S.mult, cur: S.cur, turns: S.log.length } : null;
  S = st;
  if (mine) {
    if (!S.over && S.cur === mine.cur && S.log.length === mine.turns) {
      S.darts = mine.darts;
      S.mult = mine.mult;
    } else if (mine.darts.length) {
      say(`${S.players[mine.cur].name}'s turn was entered on another phone`);
    }
  }
  save();
  showGame();
}

openFromUrl();
