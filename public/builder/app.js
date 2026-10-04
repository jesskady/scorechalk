/* Score Chalk — Builder: a configurable scorekeeper for any game */

const KEY = 'builder-v1';          // the game in progress
const RULES_KEY = 'builder-rules-v1';     // { custom: {...}, farkle: {...} }
const PLAYERS_KEY = 'builder-players-v1'; // names, shared by every game
const OLD_CFG_KEY = 'builder-cfg-v1';     // before per-game rules; names only
const MAX_PLAYERS = 8;

const $ = (id) => document.getElementById(id);
const fmt = (n) => n.toLocaleString();
const signed = (n) => n === 0 ? '0' : (n > 0 ? '+' : '−') + fmt(Math.abs(n));

/* ---------------- configuration ---------------- */

// How a game can end. Most endings only work one way round, so `mode` is the
// scoring direction an ending needs: choosing it sets that direction and
// disables the other. null works either way.
//
// `roundsHint` marks an ending that can instead finish after a fixed number of
// rounds, and replaces `hint` when it does. Endings with a finish line of
// their own — a target, or one player left — don't offer it.
const WIN_OPTS = [
  { id: 'none',   mode: null,   label: 'Just keep score', hint: 'No winner is declared. Stop whenever you like.',
    roundsHint: 'After the last round, the highest score wins.' },
  { id: 'target', mode: 'up',   label: 'First to target', hint: 'The first player to reach the target wins.', target: 'Target' },
  { id: 'low',    mode: 'up',   label: 'Lowest wins',     hint: 'When anyone reaches the limit the game ends, and the lowest score wins — like Hearts.', target: 'Limit',
    roundsHint: 'After the last round, the lowest score wins — like golf.' },
  { id: 'zero',   mode: 'down', label: 'Out at zero',     hint: 'Scores count down. A player who reaches 0 is out; last one standing wins — like life in Magic.' },
];

const ending = (c) => WIN_OPTS.find(o => o.id === c.win) || WIN_OPTS[0];

// A fixed round count, when the ending allows one and it is switched on.
const roundsOn = (c) => !!(c.useRounds && ending(c).roundsHint);

// The rules of a game: everything on the setup screen except who is playing.
function defaultRules() {
  return {
    name: '', mode: 'up', start: 0, win: 'none', target: 100,
    useRounds: false, rounds: 9,
    quick: '1, 5, 10', typed: true, signs: true, turns: false,
  };
}

// Ready-made games, offered under Start from and linked from the home page.
// Opening one fills in the setup form and nothing is locked. `id` is also
// its address: /builder/#farkle.
const TEMPLATES = [
  { id: 'farkle', label: 'Farkle',
    rules: {
      ...defaultRules(), name: 'Farkle', win: 'target', target: 10000,
      quick: '50, 100, 500, 1000', typed: false, signs: false, turns: true,
    } },
];

function setMode(mode) {
  if (mode === cfg.mode) return;
  cfg.mode = mode;
  // Swap the obvious starting value, but leave a number someone chose alone.
  if (mode === 'down' && cfg.start === 0) cfg.start = 20;
  if (mode === 'up' && cfg.start === 20) cfg.start = 0;
}

// Quick-score text → the numbers it names, plus whatever could not be read.
function parseQuick(text) {
  const vals = [], bad = [];
  for (const tok of String(text).split(/[\s,]+/).filter(Boolean)) {
    const n = Number(tok);
    if (Number.isFinite(n) && n > 0) { if (!vals.includes(n)) vals.push(n); }
    else bad.push(tok);
  }
  return { vals: vals.slice(0, 12), bad };
}

/* Each game remembers its own rules: Custom what you built, a template only
   the rules you changed from it, so a template's own rules can still be
   corrected underneath an edit. Players are shared, so the people at the
   table follow you from game to game. */

const baseRules = (id) => {
  const t = TEMPLATES.find(t => t.id === id);
  return t ? { ...t.rules } : defaultRules();
};

function savedNames() {
  const n = loadJSON(PLAYERS_KEY) || (loadJSON(OLD_CFG_KEY) || {}).names;
  return Array.isArray(n) && n.length ? n : ['', ''];
}

function loadCfg(id) {
  const mine = (loadJSON(RULES_KEY) || {})[id] || {};
  return { ...baseRules(id), ...mine, names: savedNames() };
}

let cfg = loadCfg('custom');
let source = 'custom';   // 'custom', or the id of the template being set up

/* ---------------- game state ---------------- */

// pend is this turn's running total, signed. sign is only the direction the
// next tap goes, so +5 +1 +1 then − 1 comes to +6, and −5 then + 1 to −4.
let S = null;       // { cfg, scores, cur, log, pend, sign }
let msgTimer = null;

function newGame(c) {
  const names = c.names.map((n, i) => n.trim() || `Player ${i + 1}`);
  const rounds = roundsOn(c);
  return {
    // Rounds are counted in turns, so a game with them always takes turns.
    cfg: { ...c, names, quickVals: parseQuick(c.quick).vals,
           useRounds: rounds, turns: c.turns || rounds },
    scores: names.map(() => c.start),
    cur: 0,
    log: [],          // { p, d, cur } — cur is who was on turn before it
    pend: 0,
    sign: c.mode === 'down' ? -1 : 1,
  };
}

function loadJSON(k) {
  try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; }
}
function saveJSON(k, v) {
  try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); }
  catch (e) { /* private mode, ignore */ }
}
const save = () => saveJSON(KEY, S);

const isOut = (i) => S.cfg.win === 'zero' && S.scores[i] <= 0;

// Who has won, or null while the game is still going.
function result() {
  const { win, target, useRounds, rounds } = S.cfg;
  const sc = S.scores, n = sc.length;
  if (useRounds) {
    return S.log.length >= rounds * n ? best(win === 'low' ? Math.min : Math.max) : null;
  }
  if (win === 'target' && sc.some(s => s >= target)) return best(Math.max);
  if (win === 'low' && sc.some(s => s >= target)) return best(Math.min);
  if (win === 'zero') {
    const alive = sc.map((s, i) => i).filter(i => !isOut(i));
    if (n === 1 && alive.length === 0) return { winners: [], solo: true };
    if (n > 1 && alive.length <= 1) return { winners: alive };
  }
  return null;
}
function best(pick) {
  const v = pick(...S.scores);
  return { winners: S.scores.map((s, i) => i).filter(i => S.scores[i] === v) };
}

function nextPlayer(from) {
  const n = S.scores.length;
  for (let k = 1; k <= n; k++) {
    const i = (from + k) % n;
    if (!isOut(i)) return i;
  }
  return from;
}

/* ---------------- screens ---------------- */

function show(id) {
  for (const s of ['setup', 'game']) $(s).classList.toggle('hidden', s !== id);
  window.scrollTo(0, 0);
}

// The hash decides the screen, so back and forward move between them:
// '' the custom setup, a template id that template's setup, 'play' the game.
function route() {
  const h = location.hash.slice(1);
  $('winOverlay').classList.add('hidden');
  $('confirmOverlay').classList.add('hidden');
  if (h === 'play') {
    S = loadJSON(KEY);
    if (S) { showGame(); return; }
  }
  openSetup(TEMPLATES.some(t => t.id === h) ? h : 'custom');
}
window.addEventListener('hashchange', route);

/* ---------------- setup screen ---------------- */

let rulesOpen = false;   // a template's rules, expanded for editing

function openSetup(id) {
  source = id;
  rulesOpen = false;
  const t = TEMPLATES.find(t => t.id === id);
  cfg = loadCfg(id);

  // titled as the game when it is one, since the home page links here too
  $('setupTitle').textContent = t ? t.label : 'ScoreChalk Builder';
  // not the template's rules: the Rules card shows those, as you've set them
  $('setupSub').textContent = t ? 'Add the players and start' : 'Build a scorekeeper for any game';

  const sel = $('templateSel');
  sel.innerHTML = '<option value="custom">Custom</option>' +
    TEMPLATES.map(t => `<option value="${t.id}">${esc(t.label)}</option>`).join('');
  sel.value = id;

  const saved = loadJSON(KEY);
  $('resumeBtn').classList.toggle('hidden', !saved);
  if (saved) $('resumeBtn').textContent = `Resume ${saved.cfg.name || 'saved game'}`;

  renderSetup();
  show('setup');
}

$('templateSel').addEventListener('change', (e) => {
  location.hash = e.target.value === 'custom' ? '' : e.target.value;
});

function renderSetup() {
  renderRulesCard();
  $('gameName').value = cfg.name;

  const n = cfg.names.length;
  $('pCount').textContent = n;
  $('pMinus').disabled = n <= 1;
  $('pPlus').disabled = n >= MAX_PLAYERS;
  const box = $('names');
  box.classList.toggle('one', n === 1);
  box.innerHTML = '';
  cfg.names.forEach((name, i) => {
    const inp = document.createElement('input');
    inp.type = 'text'; inp.maxLength = 14; inp.autocomplete = 'off';
    inp.placeholder = `Player ${i + 1}`; inp.value = name;
    inp.addEventListener('input', () => { cfg.names[i] = inp.value; saveCfg(); });
    box.appendChild(inp);
  });

  $('startAt').value = cfg.start;

  const row = $('winRow');
  row.innerHTML = '';
  for (const o of WIN_OPTS) {
    const b = document.createElement('button');
    b.className = 'seg' + (o.id === cfg.win ? ' is-on' : '');
    b.textContent = o.label;
    b.onclick = () => {
      cfg.win = o.id;
      if (o.mode) setMode(o.mode);
      saveCfg();
      renderSetup();
    };
    row.appendChild(b);
  }
  const cur = ending(cfg), rounds = roundsOn(cfg);
  $('winHint').textContent = rounds ? cur.roundsHint : cur.hint;
  // with a round count, Lowest wins ends on rounds instead of a score limit
  $('targetField').classList.toggle('hidden', !cur.target || rounds);
  $('targetLabel').textContent = cur.target || 'Target';
  $('target').value = cfg.target;

  $('roundsBox').classList.toggle('hidden', !cur.roundsHint);
  setToggle($('useRounds'), rounds);
  $('roundsField').classList.toggle('hidden', !rounds);
  $('rounds').value = cfg.rounds;

  document.querySelectorAll('#modeRow .seg').forEach(b => {
    b.classList.toggle('is-on', b.dataset.mode === cfg.mode);
    b.disabled = !!cur.mode && b.dataset.mode !== cur.mode;
  });

  $('quick').value = cfg.quick;
  renderQuickPreview();
  setToggle($('typed'), cfg.typed);
  setToggle($('signs'), cfg.signs);
  setToggle($('turns'), cfg.turns || rounds);
  $('turns').disabled = rounds;
  $('turnsNote').textContent = rounds
    ? 'Always on with a fixed number of rounds: a round is everyone taking one turn.'
    : 'Entering a score passes play to the next player. Off: tap anyone and score them at any time.';

}

function renderQuickPreview() {
  const { vals, bad } = parseQuick(cfg.quick);
  const el = $('quickPreview');
  el.innerHTML = '';
  for (const v of vals) el.insertAdjacentHTML('beforeend', `<b>${fmt(v)}</b>`);
  for (const t of bad) {
    const b = document.createElement('b');
    b.className = 'bad'; b.textContent = t;
    el.appendChild(b);
  }
}

function setToggle(btn, on) {
  btn.classList.toggle('is-on', on);
  btn.setAttribute('aria-checked', on);
}

// Only Custom's rules are kept. Changes made to a template last until you
// leave it, so opening Farkle tomorrow gives Farkle, and tweaking it never
// overwrites your own custom game. The players are kept from either.
function saveCfg() {
  const base = baseRules(source), mine = {};
  for (const k of Object.keys(base)) if (cfg[k] !== base[k]) mine[k] = cfg[k];
  const all = loadJSON(RULES_KEY) || {};
  if (Object.keys(mine).length) all[source] = mine; else delete all[source];
  saveJSON(RULES_KEY, all);
  saveJSON(PLAYERS_KEY, cfg.names);
  renderRulesCard();
}

/* A template's rules fold away into one line, since most of the time you only
   want to say who is playing. Custom always shows them: they are the point. */
function describeRules(c) {
  const parts = [];
  const r = roundsOn(c);
  if (c.win === 'none') parts.push(r ? `${c.rounds} rounds, highest wins` : 'Just keep score');
  if (c.win === 'target') parts.push(`First to ${fmt(c.target)}`);
  if (c.win === 'low') parts.push(r ? `${c.rounds} rounds, lowest wins` : `Ends at ${fmt(c.target)}, lowest wins`);
  if (c.win === 'zero') parts.push(`Start at ${fmt(c.start)}, out at 0`);
  else if (c.start !== 0) parts.push(`${c.mode === 'down' ? 'counts down from' : 'starts at'} ${fmt(c.start)}`);
  const vals = parseQuick(c.quick).vals;
  if (vals.length) parts.push(`keys ${vals.map(fmt).join(', ')}`);
  if (c.typed) parts.push('any score typed');
  if (c.signs) parts.push('can subtract');
  parts.push(c.turns || r ? 'takes turns' : 'score anyone any time');
  return parts.join(' · ');
}

function renderRulesCard() {
  const t = TEMPLATES.find(t => t.id === source);
  const folded = !!t && !rulesOpen;
  document.querySelectorAll('#setup .rule').forEach(el => el.classList.toggle('hidden', folded));
  $('rulesText').textContent = describeRules(cfg);
  $('rulesText').classList.toggle('hidden', !t);
  $('rulesToggle').classList.toggle('hidden', !t);
  $('rulesToggle').textContent = rulesOpen ? 'Hide rules' : 'Edit rules';
  $('rulesReset').textContent = t ? `Reset to standard ${t.label}` : 'Clear all rules';
  // nothing to reset when the rules already are the starting ones
  const changed = !!(loadJSON(RULES_KEY) || {})[source];
  $('rulesReset').classList.toggle('hidden', !changed);
  // Custom with nothing to reset has nothing to show here at all
  $('rulesCard').classList.toggle('hidden', !t && !changed);
  // Custom's card is only a reset button, so its heading would be noise
  $('rulesCard').querySelector('.field-label').classList.toggle('hidden', !t);
}

$('rulesToggle').onclick = () => { rulesOpen = !rulesOpen; renderRulesCard(); };

$('rulesReset').onclick = async () => {
  const t = TEMPLATES.find(t => t.id === source);
  const ok = await askConfirm(t
    ? `Put ${t.label} back to its standard rules?`
    : 'Clear your custom rules back to a blank tally?', 'Reset');
  if (!ok) return;
  const all = loadJSON(RULES_KEY) || {};
  delete all[source];
  saveJSON(RULES_KEY, all);
  cfg = loadCfg(source);
  renderSetup();
}

$('gameName').addEventListener('input', (e) => { cfg.name = e.target.value; saveCfg(); });

$('pMinus').onclick = () => { if (cfg.names.length > 1) { cfg.names.pop(); saveCfg(); renderSetup(); } };
$('pPlus').onclick = () => { if (cfg.names.length < MAX_PLAYERS) { cfg.names.push(''); saveCfg(); renderSetup(); } };

$('modeRow').addEventListener('click', (e) => {
  const b = e.target.closest('[data-mode]');
  // disabled buttons never fire, so the ending always allows this direction
  if (!b || b.dataset.mode === cfg.mode) return;
  setMode(b.dataset.mode);
  saveCfg();
  renderSetup();
});

$('startAt').addEventListener('input', (e) => { cfg.start = Number(e.target.value) || 0; saveCfg(); });
$('target').addEventListener('input', (e) => { cfg.target = Math.max(1, Number(e.target.value) || 1); saveCfg(); });
$('useRounds').onclick = () => { cfg.useRounds = !cfg.useRounds; saveCfg(); renderSetup(); };
$('rounds').addEventListener('input', (e) => { cfg.rounds = Math.max(1, Math.round(Number(e.target.value)) || 1); saveCfg(); });
$('quick').addEventListener('input', (e) => { cfg.quick = e.target.value; saveCfg(); renderQuickPreview(); });
$('typed').onclick = () => { cfg.typed = !cfg.typed; setToggle($('typed'), cfg.typed); saveCfg(); };
$('signs').onclick = () => { cfg.signs = !cfg.signs; setToggle($('signs'), cfg.signs); saveCfg(); };
$('turns').onclick = () => { cfg.turns = !cfg.turns; setToggle($('turns'), cfg.turns); saveCfg(); };

$('startBtn').onclick = async () => {
  if (!parseQuick(cfg.quick).vals.length && !cfg.typed) {
    flashSetup('Add at least one quick-score button, or switch on typed scores.');
    return;
  }
  if (loadJSON(KEY) && !(await askConfirm('This replaces the saved game.', 'Start new game'))) return;
  saveCfg();
  S = newGame({ ...cfg, source });
  save();
  location.hash = 'play';
};

function flashSetup(text) {
  const btn = $('startBtn'), was = btn.textContent;
  btn.textContent = text;
  btn.classList.add('danger');
  setTimeout(() => { btn.textContent = was; btn.classList.remove('danger'); }, 2200);
}

/* ---------------- game screen ---------------- */

function showGame() {
  show('game');
  // back to this game's own setup, template or custom
  // (a bare '#' rather than no hash, so leaving is a hash change, not a reload)
  $('gameBack').setAttribute('href', '#' + (S.cfg.source && S.cfg.source !== 'custom' ? S.cfg.source : ''));
  buildBoard();
  buildPad();
  render();
}

function buildBoard() {
  const c = S.cfg, n = c.names.length;
  $('gTitle').textContent = c.name || 'Scores';

  const badges = [];
  if (c.mode === 'down') badges.push(`Start ${fmt(c.start)}`);
  if (c.win === 'target') badges.push(`First to ${fmt(c.target)}`);
  if (c.win === 'low') badges.push(c.useRounds ? 'Low wins' : `Ends at ${fmt(c.target)} · low wins`);
  if (c.win === 'zero') badges.push('Out at 0');
  $('badges').innerHTML = badges.map(b => `<span class="badge">${b}</span>`).join('');
  // the round counter, kept current by render()
  if (c.turns) $('badges').insertAdjacentHTML('beforeend', '<span class="badge round" id="roundBadge"></span>');

  const board = $('scoreboard');
  board.className = 'scoreboard' + (n === 1 ? ' solo' : n >= 5 ? ' many' : '');
  board.innerHTML = '';
  c.names.forEach((name, i) => {
    const b = document.createElement('button');
    b.className = 'player';
    b.innerHTML = '<span class="pname"></span><span class="pscore"><b class="pnum"></b><i class="ppend"></i></span><span class="pmeta"></span>';
    b.querySelector('.pname').textContent = name;
    b.onclick = () => { if (S.cur !== i) { S.cur = i; save(); render(); } };
    board.appendChild(b);
  });

  // Off, every entry goes the game's natural way. A game saved before the
  // switch existed has no value for it, and keeps the switch it had.
  $('signRow').classList.toggle('hidden', c.signs === false);
}

function buildPad() {
  const vals = S.cfg.quickVals;
  const pad = $('quickpad');
  pad.className = 'quickpad' + (vals.length === 4 || vals.length > 6 ? ' four' : '');
  pad.innerHTML = '';
  for (const v of vals) {
    const b = document.createElement('button');
    b.className = 'key';
    b.dataset.v = v;
    b.onclick = () => { S.pend += S.sign * v; save(); render(); };
    pad.appendChild(b);
  }
  $('typedRow').classList.toggle('hidden', !S.cfg.typed);
}

function render() {
  const c = S.cfg, n = c.names.length;

  // Every entry, pass included, is one turn, so the round is just the count of
  // turns over the table — and undo winds it back for free.
  if (c.turns) {
    const round = Math.floor(S.log.length / n) + 1;
    $('roundBadge').textContent = c.useRounds
      ? `Round ${Math.min(round, c.rounds)} of ${c.rounds}`
      : `Round ${round}`;
  }

  // Leader: only once someone is actually ahead, and never in a solo game.
  let leader = -1;
  if (n > 1 && new Set(S.scores).size > 1) {
    const v = c.win === 'low' ? Math.min(...S.scores) : Math.max(...S.scores);
    if (S.scores.filter(s => s === v).length === 1) leader = S.scores.indexOf(v);
  }

  [...$('scoreboard').children].forEach((el, i) => {
    el.classList.toggle('active', i === S.cur);
    el.classList.toggle('out', isOut(i));
    el.classList.toggle('leader', i === leader);
    el.classList.toggle('pending', i === S.cur && S.pend !== 0);
    el.querySelector('.pnum').textContent = fmt(S.scores[i]);
    el.querySelector('.ppend').textContent = '→ ' + fmt(S.scores[i] + S.pend);
    const mine = S.log.filter(e => e.p === i);
    const last = mine[mine.length - 1];
    el.querySelector('.pmeta').textContent = isOut(i) ? 'out'
      : last ? `last ${signed(last.d)}` : '';
  });

  document.querySelectorAll('#signRow .sgn').forEach(b =>
    b.classList.toggle('is-on', Number(b.dataset.sign) === S.sign));
  $('quickpad').classList.toggle('neg', S.sign < 0);
  [...$('quickpad').children].forEach(b =>
    b.textContent = (S.sign < 0 ? '−' : '+') + fmt(Number(b.dataset.v)));

  $('pendAmt').textContent = signed(S.pend);
  $('pendFor').textContent = `for ${c.names[S.cur]}`;
  // With nothing entered, a turn-based game scores 0 — a bust, a hole with
  // nothing on it — and play moves on. Without turns a 0 would change
  // nothing, so there is nothing to enter.
  const zero = S.pend === 0, idle = zero && !c.turns;
  $('commitBtn').textContent = zero && c.turns
    ? `Score 0 for ${c.names[S.cur]}`
    : `Enter for ${c.names[S.cur]}`;
  $('commitBtn').disabled = idle;
  $('commitBtn').style.opacity = idle ? .5 : 1;

  // The round an entry belongs to follows from its place in the log, the
  // same way the round badge does.
  const from = Math.max(0, S.log.length - 6);
  $('history').innerHTML = S.log.slice(from).map((e, k) => {
    // an empty cell without turns keeps the score in its column
    const round = `<small>${c.turns ? `Round ${Math.floor((from + k) / n) + 1}` : ''}</small>`;
    return `<div><span>${esc(c.names[e.p])}</span>${round}<b class="${e.d < 0 ? 'neg' : ''}">${signed(e.d)}</b></div>`;
  }).reverse().join('');
}

function esc(s) {
  return s.replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);
}

function flash(text) {
  $('msg').textContent = text;
  clearTimeout(msgTimer);
  msgTimer = setTimeout(() => { $('msg').textContent = ''; }, 2200);
}

function commit(d) {
  const p = S.cur;
  S.log.push({ p, d, cur: S.cur });
  S.scores[p] += d;
  S.pend = 0;
  S.sign = S.cfg.mode === 'down' ? -1 : 1;
  if (isOut(p)) flash(`${S.cfg.names[p]} is out`);
  if (S.cfg.turns) S.cur = nextPlayer(p);
  save();
  render();
  const r = result();
  if (r) showWin(r);
}

$('signRow').addEventListener('click', (e) => {
  const b = e.target.closest('[data-sign]');
  if (!b) return;
  S.sign = Number(b.dataset.sign);
  save(); render();
});

$('clearBtn').onclick = () => { S.pend = 0; $('typedIn').value = ''; save(); render(); };

function addTyped() {
  const v = Math.abs(Number($('typedIn').value));
  if (!v) return;
  S.pend += S.sign * v;
  $('typedIn').value = '';
  save(); render();
}
$('typedAdd').onclick = addTyped;
$('typedIn').addEventListener('keydown', (e) => { if (e.key === 'Enter') addTyped(); });

// Taps landing just after an entry are dropped. Score 0 is live whenever
// nothing is entered, so a double tap on Enter would otherwise give the
// next player a 0 they never scored.
let lastCommit = 0;
$('commitBtn').onclick = () => {
  if (Date.now() - lastCommit < 700) return;
  if (!S.pend && !S.cfg.turns) return;
  lastCommit = Date.now();
  commit(S.pend);
};

$('undoBtn').onclick = () => {
  if (S.pend) { S.pend = 0; save(); render(); return; }
  const e = S.log.pop();
  if (!e) { flash('Nothing to undo'); return; }
  S.scores[e.p] -= e.d;
  S.cur = e.cur;
  save(); render();
  flash(`Undid ${S.cfg.names[e.p]} ${signed(e.d)}`);
};

$('quitBtn').onclick = async () => {
  if (S.log.length && !(await askConfirm('This ends the current game and its scores.', 'New game'))) return;
  endGame();
};

/* ---------------- overlays ---------------- */

function showWin(r) {
  const c = S.cfg;
  $('winName').textContent =
    r.solo ? `${c.names[0]} is out` :
    r.winners.length === 0 ? 'Nobody left standing' :
    r.winners.length === 1 ? `${c.names[r.winners[0]]} wins!` :
    `Tie: ${r.winners.map(i => c.names[i]).join(' & ')}`;

  // Standings in finishing order: lowest first when low wins, else highest.
  const order = c.names.map((_, i) => i)
    .sort((a, b) => c.win === 'low' ? S.scores[a] - S.scores[b] : S.scores[b] - S.scores[a]);
  $('winTable').innerHTML = order.map(i =>
    `<li><span>${esc(c.names[i])}</span><b>${fmt(S.scores[i])}</b></li>`).join('');
  $('winTable').classList.toggle('hidden', c.names.length === 1);
  $('winOverlay').classList.remove('hidden');
}

$('rematchBtn').onclick = () => {
  const { quickVals, ...c } = S.cfg;
  S = newGame(c);
  save();
  $('winOverlay').classList.add('hidden');
  render();
};
$('keepBtn').onclick = () => $('winOverlay').classList.add('hidden');
$('newBtn').onclick = endGame;

// Clear the game and go back to the setup it came from.
function endGame() {
  const back = $('gameBack').getAttribute('href').slice(1);
  S = null; save();
  location.hash = back;
}

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

/* ---------------- boot ---------------- */

route();
