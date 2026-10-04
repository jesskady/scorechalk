/* Score Chalk — Builder: a configurable scorekeeper for any game */

const KEY = 'builder-v1';          // the game in progress
const RULES_KEY = 'builder-rules-v1';     // { custom: {...}, farkle: {...} }
const PLAYERS_KEY = 'builder-players-v1'; // names, shared by every game
const OLD_CFG_KEY = 'builder-cfg-v1';     // before per-game rules; names only
const MAX_PLAYERS = 8;

const $ = (id) => document.getElementById(id);
const fmt = (n) => n.toLocaleString();
const signed = (n) => n === 0 ? '0' : (n > 0 ? '+' : '−') + fmt(Math.abs(n));

// WIN_OPTS, TEMPLATES, defaultRules, parseQuick and describeRules live in
// rules.js, loaded first: the home page and the profile list games by them too.

function setMode(mode) {
  if (mode === cfg.mode) return;
  cfg.mode = mode;
  // Swap the obvious starting value, but leave a number someone chose alone.
  if (mode === 'down' && cfg.start === 0) cfg.start = 20;
  if (mode === 'up' && cfg.start === 20) cfg.start = 0;
}

/* Where a setup's rules come from — its source:
     'custom'     your own, built here
     'farkle'     a template (TEMPLATES)
     'my:<id>'    one of My games, saved to your profile
   Custom and templates remember changes on this device: Custom what you
   built, a template only what you changed from it, so its own rules can still
   be corrected underneath. My games don't: a change is for tonight, and Save
   changes is how it reaches the profile. Players are shared by every game, so
   the people at the table follow you from game to game. */

let me = null;          // the signed-in user, or null
let myGames = null;     // My games once loaded; null until then

const RULE_KEYS = Object.keys(defaultRules());

function myGame(src) {
  return src.startsWith('my:') && myGames ? myGames.find(g => g.id === src.slice(3)) : null;
}

const baseRules = (src) => {
  const t = TEMPLATES.find(t => t.id === src);
  if (t) return { ...t.rules };
  const g = myGame(src);
  if (g) return { ...defaultRules(), ...g.rules, name: g.name };
  return defaultRules();
};

// the hash that opens a source's setup
const sourceHash = (src) => src === 'custom' ? '' : src.startsWith('my:') ? 'my/' + src.slice(3) : src;

// whether the rules on screen differ from where they came from
const rulesChanged = () => RULE_KEYS.some(k => cfg[k] !== baseRules(source)[k]);

function savedNames() {
  const n = loadJSON(PLAYERS_KEY) || (loadJSON(OLD_CFG_KEY) || {}).names;
  return Array.isArray(n) && n.length ? n : ['', ''];
}

function loadCfg(src) {
  const mine = src.startsWith('my:') ? {} : (loadJSON(RULES_KEY) || {})[src] || {};
  return { ...baseRules(src), ...mine, names: savedNames() };
}

let cfg = loadCfg('custom');
let source = 'custom';   // see above

/* ---------------- game state ---------------- */

// pend is this turn's running total, signed. sign is only the direction the
// next tap goes, so +5 +1 +1 then − 1 comes to +6, and −5 then + 1 to −4.
let S = null;       // { cfg, scores, cur, log, pend, sign }
let msgTimer = null;

function newGame(c) {
  const names = c.names.map((n, i) => n.trim() || `Player ${i + 1}`);
  const rounds = roundsOn(c);
  return {
    // Chosen here, as darts does, so saving the same game twice updates one
    // row on the profile rather than adding a second.
    id: crypto.randomUUID(),
    startedAt: Date.now(),
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
// '' the custom setup, a template id that template's setup, 'my/<id>' one of
// My games, 'play' the game.
function route() {
  const h = location.hash.slice(1);
  $('winOverlay').classList.add('hidden');
  $('confirmOverlay').classList.add('hidden');
  $('nameOverlay').classList.add('hidden');
  if (h === 'play') {
    S = loadJSON(KEY);
    if (S) { showGame(); return; }
  }
  if (h.startsWith('my/')) {
    if (myGames === null) return;        // loadMine() routes again when it lands
    if (myGame('my:' + h.slice(3))) { openSetup('my:' + h.slice(3)); return; }
  }
  openSetup(TEMPLATES.some(t => t.id === h) ? h : 'custom');
}
window.addEventListener('hashchange', route);

/* ---------------- setup screen ---------------- */

let rulesOpen = false;   // a template's rules, expanded for editing

function openSetup(src) {
  source = src;
  rulesOpen = false;
  cfg = loadCfg(src);
  renderTitle();
  renderPicker();

  const saved = loadJSON(KEY);
  $('resumeBtn').classList.toggle('hidden', !saved);
  if (saved) $('resumeBtn').textContent = `Resume ${saved.cfg.name || 'saved game'}`;

  renderSetup();
  show('setup');
}

function renderTitle() {
  // titled as the game when it is one, since the home page links here too
  const t = TEMPLATES.find(t => t.id === source), g = myGame(source);
  $('setupTitle').textContent = t ? t.label : g ? g.name : 'ScoreChalk Builder';
  // not the rules: the Rules card shows those, as you've set them
  $('setupSub').textContent = t || g ? 'Add the players and start' : 'Build a scorekeeper for any game';
}

function renderPicker() {
  const opt = (value, label) => `<option value="${value}">${esc(label)}</option>`;
  let html = opt('custom', 'Custom') +
    `<optgroup label="Templates">${TEMPLATES.map(t => opt(t.id, t.label)).join('')}</optgroup>`;
  if (myGames && myGames.length) {
    html += `<optgroup label="My games">${myGames.map(g => opt('my:' + g.id, g.name)).join('')}</optgroup>`;
  }
  $('templateSel').innerHTML = html;
  $('templateSel').value = source;
}

$('templateSel').addEventListener('change', (e) => {
  location.hash = sourceHash(e.target.value);
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

// Keeps this device's copy of the rules (see the sources comment above) and
// the players. My games keep no local copy: Save changes is their only save.
function saveCfg() {
  saveJSON(PLAYERS_KEY, cfg.names);
  if (source.startsWith('my:')) { renderRulesCard(); return; }
  const base = baseRules(source), mine = {};
  for (const k of Object.keys(base)) if (cfg[k] !== base[k]) mine[k] = cfg[k];
  const all = loadJSON(RULES_KEY) || {};
  if (Object.keys(mine).length) all[source] = mine; else delete all[source];
  saveJSON(RULES_KEY, all);
  saveJSON(PLAYERS_KEY, cfg.names);
  renderRulesCard();
}

function renderRulesCard() {
  const t = TEMPLATES.find(t => t.id === source), g = myGame(source);
  const named = !!(t || g);              // custom is the one that isn't
  const folded = named && !rulesOpen;
  document.querySelectorAll('#setup .rule').forEach(el => el.classList.toggle('hidden', folded));
  $('rulesText').textContent = describeRules(cfg);
  $('rulesText').classList.toggle('hidden', !named);
  $('rulesToggle').classList.toggle('hidden', !named);
  $('rulesToggle').textContent = rulesOpen ? 'Hide rules' : 'Edit rules';

  // nothing to reset or save when the rules already are the starting ones
  const changed = g ? rulesChanged() : !!(loadJSON(RULES_KEY) || {})[source];
  $('rulesReset').textContent = g ? 'Undo changes' : t ? `Reset to standard ${t.label}` : 'Clear all rules';
  $('rulesReset').classList.toggle('hidden', !changed);
  $('rulesSave').classList.toggle('hidden', !(g && changed));
  // Custom with nothing to reset has nothing to show here at all
  $('rulesCard').classList.toggle('hidden', !named && !changed);
  // Custom's card is only a reset button, so its heading would be noise
  $('rulesCard').querySelector('.field-label').classList.toggle('hidden', !named);

  // saving a new game is for rules that aren't one of yours already
  $('saveMine').classList.toggle('hidden', !me || !!g);
}

$('rulesToggle').onclick = () => { rulesOpen = !rulesOpen; renderRulesCard(); };

$('rulesReset').onclick = async () => {
  // a My game's changes were never saved anywhere, so undoing them is free
  if (myGame(source)) { cfg = loadCfg(source); renderSetup(); return; }
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

$('startAt').addEventListener('input', (e) => { cfg.start = Math.round(Number(e.target.value)) || 0; saveCfg(); });
$('target').addEventListener('input', (e) => { cfg.target = Math.max(1, Math.round(Number(e.target.value)) || 1); saveCfg(); });
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

/* ---------------- game history ----------------

   A finished game goes to the profile's history when signed in, through the
   same /api/games darts uses. Its config is a copy of the rules as they were
   played, not a pointer to them: editing, renaming or deleting one of My
   games later leaves the games already played with it exactly as they were.
   `origin` still says where the rules came from — 'custom', a template id,
   or 'my:<id>' — so games of one kind can be grouped later. */

function toPayload(r) {
  const c = S.cfg;
  // old in-progress games predate ids; give them one on their first save
  if (!S.id) { S.id = crypto.randomUUID(); S.startedAt = S.startedAt || Date.now(); save(); }

  const counts = [], running = c.names.map(() => c.start);
  const turns = S.log.map((e, i) => {
    const n = counts[e.p] || 0;
    counts[e.p] = n + 1;
    running[e.p] += e.d;
    return {
      player_idx: e.p,
      turn_no: n,              // each player's own count, as darts records it
      detail: [],              // a builder turn is just its points
      points: e.d,
      bust: false,
      score_after: running[e.p],
      created_at: S.startedAt + i,   // ordering only, as in darts
    };
  });

  return {
    id: S.id,
    game_type: 'builder',
    config: { name: c.name.trim(), rules: rulesOnly(c), origin: c.source || 'custom' },
    started_at: S.startedAt,
    me_idx: 0,
    ended_at: Date.now(),
    winner_idx: r.winners && r.winners.length === 1 ? r.winners[0] : null,
    players: c.names.map((name, idx) => ({ idx, name })),
    turns,
  };
}

async function saveToProfile(r) {
  const note = $('winSave');
  note.textContent = '';
  note.onclick = null;
  if (!me) return;                    // signed out: nothing to save to
  note.textContent = 'Saving to your profile…';
  try {
    const res = await fetch('/api/games', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(toPayload(r)),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'save failed');
    note.textContent = 'Saved to your profile';
  } catch (e) {
    note.textContent = 'Could not save to your profile. Tap to try again.';
    note.onclick = () => saveToProfile(r);
  }
}

/* ---------------- My games ---------------- */

async function loadMine() {
  try {
    const r = await fetch('/api/me', { headers: { accept: 'application/json' } });
    const data = r.ok ? await r.json() : null;
    me = (data && data.user) || null;
    if (me) {
      const g = await fetch('/api/custom-games', { headers: { accept: 'application/json' } });
      myGames = g.ok ? (await g.json()).games : [];
    }
  } catch (e) { /* offline: no My games this time */ }
  if (!myGames) myGames = [];

  // a #my/ address was waiting on this; anything else just gains the list
  if (location.hash.startsWith('#my/')) route();
  else if (!$('setup').classList.contains('hidden')) { renderPicker(); renderRulesCard(); }
}

function rulesOnly(c) {
  const r = {};
  for (const k of RULE_KEYS) if (k !== 'name') r[k] = c[k];
  return r;
}

async function putMine(id, name) {
  const res = await fetch('/api/custom-games/' + encodeURIComponent(id), {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, rules: rulesOnly(cfg) }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Could not save');
  const saved = { ...data.game };
  myGames = myGames.filter(g => g.id !== id).concat(saved)
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  return saved;
}

function askName(initial) {
  return new Promise((resolve) => {
    $('nameIn').value = initial;
    $('nameOverlay').classList.remove('hidden');
    $('nameIn').focus();
    const done = (v) => {
      $('nameOverlay').classList.add('hidden');
      $('nameSave').onclick = $('nameCancel').onclick = $('nameIn').onkeydown = null;
      resolve(v);
    };
    const ok = () => { const v = $('nameIn').value.trim(); if (v) done(v); };
    $('nameSave').onclick = ok;
    $('nameIn').onkeydown = (e) => { if (e.key === 'Enter') ok(); };
    $('nameCancel').onclick = () => done(null);
  });
}

$('saveMine').onclick = async () => {
  const t = TEMPLATES.find(t => t.id === source);
  const name = await askName(cfg.name.trim() || (t ? t.label : ''));
  if (!name) return;
  try {
    const g = await putMine(crypto.randomUUID(), name);
    location.hash = sourceHash('my:' + g.id);
  } catch (e) { flashSetup(e.message); }
};

$('rulesSave').onclick = async () => {
  const g = myGame(source);
  try {
    // the Game box can rename it too; an emptied box keeps the old name
    await putMine(g.id, cfg.name.trim() || g.name);
    renderTitle(); renderPicker(); renderSetup();
  } catch (e) { flashSetup(e.message); }
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
  $('gameBack').setAttribute('href', '#' + sourceHash(S.cfg.source || 'custom'));
  // only a game with no ending of its own needs telling when it is over
  const open = S.cfg.win === 'none' && !S.cfg.useRounds;
  $('finishBtn').classList.toggle('hidden', !open);
  document.querySelector('.mini-row').classList.toggle('two', !open);
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
  // whole numbers, as everywhere a score is entered; see parseQuick
  const v = Math.round(Math.abs(Number($('typedIn').value)));
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

// A game that only keeps score never ends by itself, so Finish ends it: the
// standings go up, and a signed-in game is saved to the profile like any
// other. The highest score is credited as the winner, unless it is shared.
$('finishBtn').onclick = async () => {
  if (!S.log.length) { flash('Nothing scored yet'); return; }
  if (!(await askConfirm('End the game here and show the final scores?', 'Finish'))) return;
  const top = best(Math.max);
  showWin({ ...top, final: true });
};

$('quitBtn').onclick = async () => {
  if (S.log.length && !(await askConfirm('This ends the current game and its scores.', 'New game'))) return;
  endGame();
};

/* ---------------- overlays ---------------- */

function showWin(r) {
  const c = S.cfg;
  $('winName').textContent =
    r.final ? 'Final scores' :
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
  saveToProfile(r);
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
loadMine();
