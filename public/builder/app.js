/* Score Chalk — Builder: a configurable scorekeeper for any game */

// Games are kept by id, every kind together (see /store.js), and a game's
// address carries its id: /builder/?g=<id>. Its kind — Custom, a template,
// one of My games — is its cfg.source.
const TYPE = 'builder';
const RULES_KEY = 'builder-rules-v1';     // { custom: {...}, farkle: {...} }
const PLAYERS_KEY = 'builder-players-v1'; // names, shared by every game
const TEAMS_KEY = 'builder-teams-v1';     // each player's team, with the names
const OLD_CFG_KEY = 'builder-cfg-v1';     // before per-game rules; names only
const MAX_PLAYERS = 8;

// Team chips on the setup screen, and nothing else: in the game a team is
// just a side with a score, shown by its players' names.
const TEAM_COLORS = ['#2e9e63', '#d9534f', '#3b82f6', '#e0b341'];
const TEAM_LETTERS = ['A', 'B', 'C', 'D'];

const $ = (id) => document.getElementById(id);
const fmt = (n) => n.toLocaleString();
const signed = (n) => n === 0 ? '0' : (n > 0 ? '+' : '−') + fmt(Math.abs(n));
// one turn's score as the sheet writes it: counting down, which way it went
const turnText = (d) => (S.cfg.mode === 'down' ? signed(d) : fmt(d));

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
// The newest game in progress of one kind: Custom, a template, one of My games.
function latestOf(src) {
  const g = SCStore.latest(TYPE, (st) => (st.cfg && st.cfg.source || 'custom') === src);
  return g ? g.state : null;
}

// whether the rules on screen differ from where they came from
const rulesChanged = () => RULE_KEYS.some(k => cfg[k] !== baseRules(source)[k]);

// Every name typed, up to eight: a game opens with as many as it needs, and
// the rest wait for a game with more players.
function savedNames() {
  const n = loadJSON(PLAYERS_KEY) || (loadJSON(OLD_CFG_KEY) || {}).names;
  return Array.isArray(n) && n.length ? n : ['', ''];
}

function sized(list, n) {
  const out = list.slice(0, n);
  while (out.length < n) out.push('');
  return out;
}

function loadCfg(src) {
  const mine = src.startsWith('my:') ? {} : (loadJSON(RULES_KEY) || {})[src] || {};
  const teamOf = loadJSON(TEAMS_KEY);
  const rules = { ...baseRules(src), ...mine };
  // a game opens with its own number of players, whatever the last one had
  return { ...rules, names: sized(savedNames(), rules.players || 2), teamOf: Array.isArray(teamOf) ? teamOf : [] };
}

/* Which team each player is on. A player with no team yet, or one on a team
   that no longer exists, gets the usual seating: alternate sides round the
   table, so partners sit opposite — 1 & 3 against 2 & 4. */
function teamsFor(c) {
  const n = c.teamCount || 2;
  return c.names.map((_, i) => {
    const t = c.teamOf[i];
    return Number.isInteger(t) && t < n ? t : i % n;
  });
}

let cfg = loadCfg('custom');
let source = 'custom';   // see above

/* ---------------- game state ---------------- */

// pend is this turn's running total, signed. sign is only the direction the
// next tap goes, so +5 +1 +1 then − 1 comes to +6, and −5 then + 1 to −4.
let S = null;       // { cfg, scores, cur, log, pend, sign }
let msgTimer = null;

/* In teams, the sides are what is scored: each one's name is its players'
   (Jess & Sam), and from here on the game knows only sides. The players and
   their teams are kept so a rematch can deal the same teams again. */
function newGame(c) {
  const players = c.names.map((n, i) => n.trim() || `Player ${i + 1}`);
  let names = players, members = null, playerTeams = null;
  if (teamsOn(c, players.length)) {
    playerTeams = teamsFor(c);
    members = Array.from({ length: c.teamCount }, (_, t) => players.filter((_, i) => playerTeams[i] === t))
      .filter((m) => m.length);
    names = members.map((m) => m.join(' & '));
  }
  const rounds = roundsOn(c);
  return {
    // Chosen here, as darts does, so saving the same game twice updates one
    // row on the profile rather than adding a second.
    id: crypto.randomUUID(),
    startedAt: Date.now(),
    // Rounds are counted in turns, so a game with them always takes turns.
    cfg: { ...c, names, playerNames: players, members, playerTeams, quickKeys: parseQuick(c.quick).keys,
           useRounds: rounds, turns: c.turns || rounds },
    scores: names.map(() => c.start),
    cur: 0,
    log: [],          // { p, d, cur } — cur is who was on turn before it
    // scores changed after they were entered, oldest first:
    // { i, p, r, from, to, fromParts, after } — i the log entry, r its round,
    // after how long the log was then, which places it among the turns
    edits: [],
    pend: 0,
    parts: [],        // what made pend: { label, d } per tap, for the breakdown
    sign: c.mode === 'down' ? -1 : 1,
    // the scoresheet, for a game taken in turns; the switch changes this
    // game only, and every new game opens in the sheet again
    view: 'sheet',
  };
}

/* A score's breakdown, as said aloud: named keys by name and how many,
   anything else by its points. Empty when nothing named was tapped, since
   "+50 · +100" says no more than the total does. */
function partsText(parts) {
  if (!parts || !parts.some((p) => p.label)) return '';
  const out = [];
  for (const p of parts) {
    const text = p.label ? (p.d < 0 ? '−' : '') + p.label : signed(p.d);
    const last = out[out.length - 1];
    if (last && last.text === text) last.n++;
    else out.push({ text, n: 1 });
  }
  return out.map((o) => (o.n > 1 ? `${o.text} ×${o.n}` : o.text)).join(' · ');
}

function loadJSON(k) {
  try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; }
}
function saveJSON(k, v) {
  try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); }
  catch (e) { /* private mode, ignore */ }
}
const save = () => {
  SCStore.put(TYPE, S, !!S.endedAt);
  // and to the profile, when signed in (see /cloud.js)
  if (window.SCCloud) SCCloud.keep(cloudGame);
};

// The game as the profile keeps it: its history, and its own state to pick
// it up again by. Nothing until there is a score in it.
const cloudGame = () => (S && S.log.length ? { ...toPayload(), state: S } : null);

const isOut = (i) => S.cfg.win === 'zero' && S.scores[i] <= 0;

// Someone has reached the target, or the limit when lowest wins.
function lineCrossed() {
  const { win, target, useRounds } = S.cfg;
  if (useRounds || (win !== 'target' && win !== 'low')) return false;
  return S.scores.some((s) => s >= target);
}

// Every side has had the same number of turns: a round has just finished.
const roundDone = () => S.log.length % S.scores.length === 0;

// The line has been crossed, and the round is being played out.
const finalRound = () => S.cfg.turns && lineCrossed() && !roundDone();

// Who has won, or null while the game is still going.
function result() {
  const { win, target, useRounds, rounds } = S.cfg;
  const sc = S.scores, n = sc.length;
  if (useRounds) {
    return S.log.length >= rounds * n ? best(win === 'low' ? Math.min : Math.max) : null;
  }
  // Reaching the target (or the limit) ends the game — but in a game taken
  // in turns, only once the round is over, so everyone scores the last
  // round and the best score then wins, not merely the first past the line.
  if (lineCrossed()) {
    if (S.cfg.turns && !roundDone()) return null;
    return best(win === 'low' ? Math.min : Math.max);
  }
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
  // in a game, the sign-in button would sit on the view switch
  document.body.classList.toggle('playing', id === 'game');
  window.scrollTo(0, 0);
}

// The address decides the screen. A game is ?g=<id>; the setups are the
// hash: '' the custom setup, a template id that template's setup, 'my/<id>'
// one of My games. 'play/<game>', from before games had addresses of their
// own, opens the newest game in progress of that kind.
function route() {
  const h = location.hash.slice(1);
  $('winOverlay').classList.add('hidden');
  $('confirmOverlay').classList.add('hidden');
  $('nameOverlay').classList.add('hidden');
  const at = SCStore.urlId();
  if (at && !h) {
    const g = SCStore.get(at.id);
    if (g && g.type === TYPE) { S = g.state; showGame(); return; }
  }
  if (h.startsWith('play/')) {
    const g = h.slice(5);
    const src = g.startsWith('my/') ? 'my:' + g.slice(3) : g;
    const st = latestOf(src);
    if (st) { openGame(st); return; }
    location.replace('#' + sourceHash(src));   // nothing in progress: its setup
    return;
  }
  // a setup: the address no longer names a game
  if (at) SCStore.leave(location.hash);
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

// The page takes the game's room: the setup screen as it is being chosen,
// the game screen as it was started.
function setRoom(theme) {
  document.body.dataset.room = theme;
}

function renderThemes() {
  const row = $('themeRow');
  const cur = themeOf(cfg);
  row.innerHTML = '';
  for (const t of THEMES) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `swatch sw-${t.id}` + (t.id === cur ? ' is-on' : '');
    b.innerHTML = `<span class="sw-face" aria-hidden="true">Aa</span><b>${t.label}</b><small>${t.hint}</small>`;
    b.onclick = () => { cfg.theme = t.id; saveCfg(); renderSetup(); };
    row.appendChild(b);
  }
}

function renderSetup() {
  renderRulesCard();
  setRoom(themeOf(cfg));
  renderThemes();
  $('gameName').value = cfg.name;

  const n = cfg.names.length;
  $('pCount').textContent = n;
  $('pMinus').disabled = n <= 1;
  $('pPlus').disabled = n >= MAX_PLAYERS;
  const box = $('names');
  const teamed = teamsOn(cfg, n), teams = teamed ? teamsFor(cfg) : null;
  box.classList.toggle('one', n === 1);
  box.classList.toggle('teamed', teamed);
  box.innerHTML = '';
  cfg.names.forEach((name, i) => {
    const inp = document.createElement('input');
    inp.type = 'text'; inp.maxLength = 14; inp.autocomplete = 'off';
    inp.placeholder = `Player ${i + 1}`; inp.value = name;
    inp.addEventListener('input', () => { cfg.names[i] = inp.value; saveCfg(); });
    if (!teamed) { box.appendChild(inp); return; }
    // in teams, each player has a chip for their side: tap it to move them
    const row = document.createElement('div');
    row.className = 'name-row';
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'team-chip';
    chip.textContent = TEAM_LETTERS[teams[i]];
    chip.style.setProperty('--tc', TEAM_COLORS[teams[i]]);
    chip.setAttribute('aria-label', `Team ${TEAM_LETTERS[teams[i]]} — tap to change`);
    chip.onclick = () => {
      cfg.teamOf = teamsFor(cfg);
      cfg.teamOf[i] = (cfg.teamOf[i] + 1) % cfg.teamCount;
      saveCfg(); renderSetup();
    };
    row.append(chip, inp);
    box.appendChild(row);
  });

  // teams need four players or more
  $('teamsBox').classList.toggle('hidden', maxTeams(n) < 2);
  setToggle($('teamsTgl'), teamed);
  const tcRow = $('teamCountRow');
  tcRow.classList.toggle('hidden', !teamed || maxTeams(n) < 3);
  tcRow.innerHTML = '';
  for (let t = 2; t <= maxTeams(n); t++) {
    const b = document.createElement('button');
    b.className = 'seg' + (t === cfg.teamCount ? ' is-on' : '');
    b.textContent = `${t} teams`;
    b.onclick = () => { cfg.teamCount = t; saveCfg(); renderSetup(); };
    tcRow.appendChild(b);
  }

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
  const { keys, bad } = parseQuick(cfg.quick);
  const el = $('quickPreview');
  el.innerHTML = '';
  for (const k of keys) {
    const b = document.createElement('b');
    b.textContent = keyText(k);
    el.appendChild(b);
  }
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
  // the names on screen over the saved ones, keeping any beyond them
  const names = savedNames();
  cfg.names.forEach((v, i) => { names[i] = v; });
  saveJSON(PLAYERS_KEY, names.slice(0, MAX_PLAYERS));
  saveJSON(TEAMS_KEY, cfg.teamOf);
  if (source.startsWith('my:')) { renderRulesCard(); return; }
  const base = baseRules(source), mine = {};
  for (const k of Object.keys(base)) if (cfg[k] !== base[k]) mine[k] = cfg[k];
  const all = loadJSON(RULES_KEY) || {};
  if (Object.keys(mine).length) all[source] = mine; else delete all[source];
  saveJSON(RULES_KEY, all);
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

  // Reset is always there, so a bumped button or dial can always be put
  // back; it is greyed out when the rules, and the player count, already are
  // the game's own: Custom's plain tally, a template's standard rules, or a
  // My game as it was saved.
  const ruleEdits = g ? rulesChanged() : !!(loadJSON(RULES_KEY) || {})[source];
  const changed = ruleEdits || cfg.names.length !== (baseRules(source).players || 2);
  $('rulesReset').textContent = g ? 'Undo changes' : t ? `Reset to standard ${t.label}` : 'Reset to defaults';
  $('rulesReset').disabled = !changed;
  // a template's reset belongs with its rules: folded away, it isn't offered
  $('rulesReset').classList.toggle('hidden', !!t && folded);
  $('rulesSave').classList.toggle('hidden', !(g && ruleEdits));
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
    : 'Put Custom back to its defaults: count up, with 1, 5 and 10 buttons?', 'Reset');
  if (!ok) return;
  const all = loadJSON(RULES_KEY) || {};
  delete all[source];
  saveJSON(RULES_KEY, all);
  cfg = loadCfg(source);
  renderSetup();
}

$('gameName').addEventListener('input', (e) => { cfg.name = e.target.value; saveCfg(); });

$('teamsTgl').onclick = () => {
  cfg.teams = !teamsOn(cfg, cfg.names.length);
  // the team count can't be more than the players allow
  cfg.teamCount = Math.min(cfg.teamCount || 2, maxTeams(cfg.names.length)) || 2;
  saveCfg(); renderSetup();
};

/* The player count. For a template it is tonight's only: Canasta opens with
   four every time. For Custom and My games it is the game's own default —
   Custom remembers it, and a change to one of My games is saved with Save
   changes, like any other rule. */
function setPlayers(n) {
  // adding a player brings back the name last typed in that place
  const saved = savedNames();
  cfg.names = Array.from({ length: n }, (_, i) => (i < cfg.names.length ? cfg.names[i] : saved[i] || ''));
  if (!TEMPLATES.some((t) => t.id === source)) cfg.players = n;
  saveCfg(); renderSetup();
}
$('pMinus').onclick = () => { if (cfg.names.length > 1) setPlayers(cfg.names.length - 1); };
$('pPlus').onclick = () => { if (cfg.names.length < MAX_PLAYERS) setPlayers(cfg.names.length + 1); };

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
  if (!parseQuick(cfg.quick).keys.length && !cfg.typed) {
    flashSetup('Add at least one quick-score button, or switch on typed scores.');
    return;
  }
  if (teamsOn(cfg, cfg.names.length)) {
    const t = teamsFor(cfg);
    for (let k = 0; k < cfg.teamCount; k++) {
      if (!t.includes(k)) { flashSetup(`Team ${TEAM_LETTERS[k]} has no players yet.`); return; }
    }
  }
  // A game of this kind already in progress: picking it back up may be what
  // was meant. Starting another keeps it, under Pick up where you left off.
  const prior = latestOf(source);
  if (prior) {
    const name = (prior.cfg && prior.cfg.name) || cfg.name;
    const a = await askConfirm(`You have a game${name ? ` of ${name}` : ''} in progress. It stays in progress if you start another.`,
      'Start a new one', 'Resume it');
    if (a === 'alt') { openGame(prior); return; }
    if (!a) return;
  }
  saveCfg();
  S = newGame({ ...cfg, source });
  save();
  openGame(S);
};

// A game on screen has its id in the address: a link to it opens it.
function openGame(state) {
  S = state;
  SCStore.show(S.id);
  route();
}

/* ---------------- game history ----------------

   A finished game goes to the profile's history when signed in, through the
   same /api/games darts uses. Its config is a copy of the rules as they were
   played, not a pointer to them: editing, renaming or deleting one of My
   games later leaves the games already played with it exactly as they were.
   `origin` still says where the rules came from — 'custom', a template id,
   or 'my:<id>' — so games of one kind can be grouped later. */

function toPayload() {
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
      // what the points were made of, when named keys were used
      detail: (e.parts || []).slice(0, 64).map((x) => ({ label: x.label, d: x.d })),
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
    ended_at: S.endedAt || null,
    winner_idx: S.endedAt && S.winnerIdx != null ? S.winnerIdx : null,
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
    await SCCloud.now(cloudGame);
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
    // the players on screen become the saved game's own number of players
    body: JSON.stringify({ name, rules: { ...rulesOnly(cfg), players: cfg.names.length } }),
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
  setRoom(themeOf(S.cfg));
  // only a game with no ending of its own needs telling when it is over
  const open = S.cfg.win === 'none' && !S.cfg.useRounds;
  $('finishBtn').classList.toggle('hidden', !open);
  // Undo, Share, New game — and Finish, for a game with no end of its own
  document.querySelector('.mini-row').classList.toggle('four', open);
  closeEntry();
  // a phone that joined by seat is always on its own player
  if (SCShare.seat() !== null) S.cur = SCShare.seat();
  applyView();
  buildBoard();
  buildPad();
  render();
  if (sheetOn()) requestAnimationFrame(() => showCurrent(false));
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
  board.innerHTML = '';
  c.names.forEach((name, i) => {
    const b = document.createElement('button');
    b.className = 'player';
    b.innerHTML = '<span class="pname"></span><span class="pscore"><b class="pnum"></b><i class="ppend"></i></span><span class="pmeta"></span>';
    b.querySelector('.pname').textContent = name;
    b.onclick = () => { if (S.cur !== i && mayScore(i)) { S.cur = i; save(); render(); } };
    board.appendChild(b);
  });
  layoutBoard();

  // Off, every entry goes the game's natural way. A game saved before the
  // switch existed has no value for it, and keeps the switch it had.
  $('signRow').classList.toggle('hidden', c.signs === false);
}

/* The board's rows. As many players to a row as fit at a readable width —
   four on a phone — and the players shared out evenly over the rows it
   takes, the fuller rows first: six is 3 + 3, seven 4 + 3, ten 4 + 3 + 3,
   never a row of four over a row of one. Each row spans the whole width:
   the grid has 60 columns, which every row of one to six divides. Where
   there is room — a laptop — the board goes wider than the pad under it,
   to hold everyone in one row, as the sheet does. */
const BOARD_COL = 92;   // the narrowest a player's column gets
const BOARD_ROOMY = 116;  // what one is given when there is room to spare

function layoutBoard() {
  const board = $('scoreboard');
  if (!S || !board.children.length) return;
  const n = board.children.length;
  const screen = document.documentElement.clientWidth - 20;
  const page = $('game').clientWidth - 20;
  // wider than the page only to fit everyone in one row
  const width = Math.min(screen, Math.max(page, n * BOARD_ROOMY));
  const fit = Math.max(1, Math.floor(width / BOARD_COL));
  const rows = Math.ceil(n / fit);
  const sizes = Array.from({ length: rows }, (_, k) => Math.floor(n / rows) + (k < n % rows ? 1 : 0));
  const widest = Math.max(...sizes);

  board.style.width = rows === 1 && n * BOARD_ROOMY > page ? width + 'px' : '';
  board.style.gridTemplateColumns = rows === 1 ? `repeat(${n}, 1fr)` : 'repeat(60, 1fr)';
  // smaller numbers once columns are narrow
  const colW = (rows === 1 && n * BOARD_ROOMY > page ? width : page) / widest;
  board.className = 'scoreboard' + (n === 1 ? ' solo' : colW < 110 ? ' many' : '');

  let i = 0;
  sizes.forEach((size, row) => {
    for (let k = 0; k < size; k++, i++) {
      const el = board.children[i];
      el.style.gridColumn = rows === 1 ? '' : `span ${60 / size}`;
      el.classList.toggle('rowstart', k === 0);
      el.classList.toggle('newrow', row > 0);
    }
  });
}
window.addEventListener('resize', () => {
  if (!S || $('game').classList.contains('hidden')) return;
  layoutBoard();
  if (sheetOn()) renderSheet();
});

function buildPad() {
  // a game started before keys had names has only their values
  const keys = S.cfg.quickKeys || (S.cfg.quickVals || []).map((v) => ({ label: '', v }));
  const named = keys.some((k) => k.label);
  const pad = $('quickpad');
  pad.className = 'quickpad' + (named ? ' named' : keys.length === 4 || keys.length > 6 ? ' four' : '');
  pad.innerHTML = '';
  if (!S.parts) S.parts = [];
  for (const k of keys) {
    const b = document.createElement('button');
    b.className = 'key' + (k.label ? ' nkey' : '');
    b.dataset.v = k.v;
    if (k.label) b.innerHTML = `<b>${esc(k.label)}</b><small></small>`;
    b.onclick = () => {
      S.pend += S.sign * k.v;
      S.parts.push({ label: k.label, d: S.sign * k.v });
      save(); render();
    };
    pad.appendChild(b);
  }
  $('typedRow').classList.toggle('hidden', !S.cfg.typed);
}

function render() {
  const c = S.cfg, n = c.names.length;

  // The round is the first that a side still in the game hasn't scored, as
  // the sheet shows it — and undo winds it back for free.
  if (c.turns) {
    const round = sheetRound(turnsBySide());
    $('roundBadge').textContent = c.useRounds
      ? `Round ${round} of ${c.rounds}`
      : finalRound() ? 'Final round' : `Round ${round}`;
    $('roundBadge').classList.toggle('final', finalRound());
  }

  const leader = leaderOf();

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
  [...$('quickpad').children].forEach((b) => {
    const text = (S.sign < 0 ? '−' : '+') + fmt(Number(b.dataset.v));
    if (b.classList.contains('nkey')) b.querySelector('small').textContent = text;
    else b.textContent = text;
  });

  $('pendAmt').textContent = signed(S.pend);
  // what has been tapped, by name, once any of it has one
  const who = entry ? entry.p : S.cur;
  $('pendFor').textContent = partsText(S.parts) || `for ${c.names[who]}`;
  // With nothing entered, a turn-based game scores 0 — a bust, a hole with
  // nothing on it — and play moves on. Without turns a 0 would change
  // nothing, so there is nothing to enter.
  const zero = S.pend === 0, idle = zero && !c.turns;
  $('commitBtn').textContent = zero && c.turns
    ? `Score 0 for ${c.names[S.cur]}`
    : `Enter for ${c.names[S.cur]}`;
  let off = idle;
  // changing a score: what it goes from and to, once it is different
  if (entry && entry.i != null) {
    const was = S.log[entry.i].d;
    off = S.pend === was;
    $('commitBtn').textContent = off ? 'No change yet' : `Change ${turnText(was)} → ${turnText(S.pend)}`;
  }
  $('commitBtn').disabled = off;
  $('commitBtn').style.opacity = off ? .5 : 1;

  // The last few things done, newest first: each score, and any change made
  // to one since, in its place among them. A score is tapped to change it.
  const rounds = roundsOfLog(), items = [];
  S.log.forEach((e, i) => {
    items.push({ e, i });
    for (const x of S.edits || []) if (x.after === i + 1) items.push({ x });
  });
  $('history').innerHTML = items.slice(-6).map(({ e, i, x }) => {
    if (x) {
      const diff = x.to - x.from;
      return `<div class="hedit"><span>${esc(c.names[x.p])}<em>${c.turns ? `round ${x.r} ` : ''}changed</em></span><small>${turnText(x.from)} → ${turnText(x.to)}</small><b class="${diff < 0 ? 'neg' : ''}">${signed(diff)}</b></div>`;
    }
    // an empty cell without turns keeps the score in its column
    const round = `<small>${c.turns ? `Round ${rounds[i]}` : ''}</small>`;
    const parts = partsText(e.parts);
    return `<div class="hturn" data-i="${i}"><span>${esc(c.names[e.p])}${parts ? `<em>${esc(parts)}</em>` : ''}</span>${round}<b class="${e.d < 0 ? 'neg' : ''}">${signed(e.d)}</b></div>`;
  }).reverse().join('');

  if (sheetOn()) renderSheet();
}

// The leader: only once someone is actually ahead, and never in a solo game.
function leaderOf() {
  const n = S.scores.length;
  if (n < 2 || new Set(S.scores).size < 2) return -1;
  const v = S.cfg.win === 'low' ? Math.min(...S.scores) : Math.max(...S.scores);
  return S.scores.filter(s => s === v).length === 1 ? S.scores.indexOf(v) : -1;
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
  if (!mayScore(p)) return;
  const crossedBefore = lineCrossed();
  S.log.push({ p, d, cur: S.cur, parts: S.parts || [] });
  S.scores[p] += d;
  S.pend = 0;
  S.parts = [];
  S.sign = S.cfg.mode === 'down' ? -1 : 1;
  if (isOut(p)) flash(`${S.cfg.names[p]} is out`);
  if (S.cfg.turns) S.cur = nextPlayer(p);
  // a phone scoring one player stays on that player
  if (SCShare.seat() !== null) S.cur = SCShare.seat();
  save();
  closeEntry();
  render();
  if (sheetOn()) showCurrent(true);
  const r = result();
  if (r) showWin(r);
  // the line was crossed with turns still to come this round
  else if (!crossedBefore && lineCrossed()) {
    flash(`${S.cfg.names[p]} reached ${fmt(S.cfg.target)} — finishing the round`);
  }
}

$('signRow').addEventListener('click', (e) => {
  const b = e.target.closest('[data-sign]');
  if (!b) return;
  S.sign = Number(b.dataset.sign);
  save(); render();
});

$('clearBtn').onclick = () => { S.pend = 0; S.parts = []; $('typedIn').value = ''; save(); render(); };

function addTyped() {
  // whole numbers, as everywhere a score is entered; see parseQuick
  const v = Math.round(Math.abs(Number($('typedIn').value)));
  if (!v) return;
  S.pend += S.sign * v;
  S.parts.push({ label: '', d: S.sign * v });
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
  if (entry && entry.i != null) { changeTurn(); return; }
  if (Date.now() - lastCommit < 700) return;
  if (!S.pend && !S.cfg.turns) return;
  lastCommit = Date.now();
  commit(S.pend);
};

$('undoBtn').onclick = () => {
  if (S.pend || (S.parts && S.parts.length)) { S.pend = 0; S.parts = []; save(); render(); return; }
  // the last thing done was changing a score: put it back as it was
  const seat = SCShare.seat();
  const x = S.edits && S.edits[S.edits.length - 1];
  if (x && x.after === S.log.length && (seat === null || x.p === seat)) {
    const t = S.log[x.i];
    S.scores[t.p] += x.from - t.d;
    t.d = x.from;
    t.parts = x.fromParts;
    S.edits.pop();
    settleEnd();
    save(); render();
    flash(`Undid the change to ${S.cfg.names[x.p]}${S.cfg.turns ? `'s round ${x.r}` : ''}`);
    return;
  }
  // A phone scoring one player takes back that player's last score, wherever
  // it is in the log: everyone else's are theirs to take back.
  if (seat !== null) {
    let j = -1;
    for (let k = S.log.length - 1; k >= 0; k--) if (S.log[k].p === seat) { j = k; break; }
    if (j < 0) { flash('Nothing to undo'); return; }
    const [mine] = S.log.splice(j, 1);
    S.scores[mine.p] -= mine.d;
    S.edits = (S.edits || []).filter((y) => y.i !== j)
      .map((y) => ({ ...y, i: y.i > j ? y.i - 1 : y.i, after: y.after > j ? y.after - 1 : y.after }));
    if (S.endedAt && !result()) { S.endedAt = null; S.winnerIdx = null; }
    save(); render();
    flash(`Undid ${S.cfg.names[mine.p]} ${signed(mine.d)}`);
    return;
  }
  const e = S.log.pop();
  if (!e) { flash('Nothing to undo'); return; }
  S.scores[e.p] -= e.d;
  S.cur = e.cur;
  // changes to that score go with it
  if (S.edits) S.edits = S.edits.filter((y) => y.i < S.log.length);
  // an undo that takes back the win, or a Finish, opens the game again
  if (S.endedAt && !result()) { S.endedAt = null; S.winnerIdx = null; }
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
  if (!S.endedAt) SCCloud.drop(S.id);
  endGame();
};

/* ---------------- the sheet view ----------------

   For a game taken in turns, the scores can be kept as on paper: a row a
   round, a column a player. With a fixed number of rounds every row is
   there from the start; without, a round's row appears once the one before
   it is complete. The round being played is picked out, and the cells still
   to score in it are open: tapping one scores that player, in a bubble
   beside the cell holding the same pad as the board.

   Nothing is kept for it but which view is showing: a side's k-th entry in
   the log is its score for round k, so Undo, the board and the sheet all
   read the same log. */

const sheetOn = () => !!S.cfg.turns && S.view === 'sheet';

function applyView() {
  const on = sheetOn();
  $('viewRow').classList.toggle('hidden', !S.cfg.turns);
  $('game').classList.toggle('sheet-view', on);
  $('sheetWrap').classList.toggle('hidden', !on);
  document.querySelectorAll('#viewRow .vseg').forEach((b) =>
    b.classList.toggle('is-on', b.dataset.view === (on ? 'sheet' : 'board')));
}

$('viewRow').addEventListener('click', (e) => {
  const b = e.target.closest('[data-view]');
  if (!b || b.dataset.view === S.view) return;
  S.view = b.dataset.view;
  save(); applyView(); render();
  if (sheetOn()) requestAnimationFrame(() => showCurrent(false));
});

// Each side's entries, in order: the k-th is its score for round k.
function turnsBySide() {
  const t = S.scores.map(() => []);
  for (const e of S.log) t[e.p].push(e);
  return t;
}

// The round being played: the first that a side still in the game has no
// score for. A side that is out is waited for no longer. Once the game is
// over, the last round played.
function sheetRound(t) {
  // over: the last round played, with no next one waiting
  if (S.endedAt || result()) return Math.max(1, ...t.map((x) => x.length));
  const live = t.map((_, p) => p).filter((p) => !isOut(p));
  const r = live.length ? Math.min(...live.map((p) => t[p].length)) + 1 : Math.max(...t.map((x) => x.length));
  return S.cfg.useRounds ? Math.min(r, S.cfg.rounds) : r;
}

/* The sheet can be turned on its side, a row a player and a column a
   round — the better way round for a table of many players on a phone,
   where the rounds then scroll sideways instead of the players. Either way
   the names stay put down one edge and the rounds along the other, with
   the totals kept in view at the far end. A round is the same size from
   the first, and the totals sit at the far edge of the screen from the
   start: until the rounds reach them, the space between is left blank,
   ruled like the rest. */
/* Which way round the sheet is: as tapped for this game, or else on its
   side whenever the right way up wouldn't fit across the screen — on a
   phone, five players or more, whose columns would otherwise scroll. It is
   decided where the game is shown, so a game picked up on a laptop opens
   the right way up there. */
function sheetFlipped() {
  if (typeof S.flip === 'boolean') return S.flip;
  const n = S.cfg.names.length;
  // the narrowest the right-way-up columns go: see .sheet and .sheet.wide
  const need = n > 4 ? 86 + n * 66 : 82 + n * 52;
  return need > document.documentElement.clientWidth - 20;
}

function renderSheet() {
  const c = S.cfg, n = c.names.length, t = turnsBySide();
  const over = !!S.endedAt || !!result();
  const cur = sheetRound(t);
  const rows = c.useRounds ? c.rounds : Math.max(cur, ...t.map((x) => x.length));
  const leader = leaderOf();
  const flip = sheetFlipped();
  // the entries changed since they were made, marked on their cells
  const changed = new Set((S.edits || []).map((x) => S.log[x.i]));

  // one round's cell for one side, the same either way round
  const cell = (p, r) => {
    const here = r === cur && !over;
    const e = t[p][r - 1];
    const at = `data-p="${p}" data-r="${r}"`;
    if (e) {
      const neg = c.mode === 'down' ? e.d > 0 : e.d < 0;
      return `<button class="cell${here ? ' cur done' : ''}${e.d === 0 ? ' zero' : neg ? ' neg' : ''}${changed.has(e) ? ' edited' : ''}" ${at}>${turnText(e.d)}</button>`;
    }
    if (isOut(p)) return `<div class="cell gone${here ? ' cur' : ''}">—</div>`;
    const open = here && t[p].length === r - 1;
    return `<button class="cell${here ? ' cur' : ''}${open ? ' open' : ''}${open && p === S.cur ? ' turn' : ''}" ${at}></button>`;
  };
  const name = (p) => `<div class="ptile${p === S.cur && !over ? ' turn' : ''}${isOut(p) ? ' out' : ''}" data-p="${p}"><span class="pname">${esc(c.names[p])}</span></div>`;
  const total = (p) => `<div class="cell tot${p === leader ? ' leader' : ''}">${fmt(S.scores[p])}</div>`;
  const corner = `<div class="corner"><button class="flipbtn" aria-label="Swap the players and the rounds" title="Swap the players and the rounds">⇄ Flip</button></div>`;

  const sheet = $('sheet');
  let html = corner;
  if (!flip) {
    // four share the width; from five, columns keep a readable width and scroll
    sheet.className = 'sheet' + (n > 4 ? ' wide' : '');
    sheet.style.gridTemplateColumns = '';
    sheet.style.gridTemplateRows = `auto ${c.start ? '42px ' : ''}repeat(${rows}, 42px) 1fr 46px`;
    $('sheetWrap').classList.remove('flipped');
    sheet.style.setProperty('--cols', n);
    $('sheetWrap').style.setProperty('--sheet-w', (110 + n * 96) + 'px');
    for (let p = 0; p < n; p++) html += name(p);
    // where play starts, when it isn't at nothing
    if (c.start) {
      html += '<div class="lab start">Start</div>';
      for (let p = 0; p < n; p++) html += `<div class="cell start">${fmt(c.start)}</div>`;
    }
    for (let r = 1; r <= rows; r++) {
      html += `<div class="lab${r === cur && !over ? ' cur' : ''}" data-r="${r}">Round ${r}</div>`;
      for (let p = 0; p < n; p++) html += cell(p, r);
    }
    // the blank between the last round and the totals
    html += '<div class="lab fill"></div>';
    for (let p = 0; p < n; p++) html += '<div class="cell fill"></div>';
    html += '<div class="lab tot">Total</div>';
    for (let p = 0; p < n; p++) html += total(p);
  } else {
    /* A phone keeps the names to a narrow column, wrapping a long one onto
       more lines. With room to spare, the names get as wide as the longest,
       the rounds a little wider, and the sheet grows past the page to hold
       them, up to the width of the screen. */
    const roomy = document.documentElement.clientWidth >= 700;
    const cellW = roomy ? 76 : 60, totalW = roomy ? 86 : 70;
    const longest = Math.max(...c.names.map((s) => s.length));
    const nameW = roomy ? Math.min(260, Math.max(120, Math.round(longest * 8.5) + 30)) : 96;
    sheet.className = 'sheet flip' + (roomy ? ' roomy' : '');
    sheet.style.gridTemplateColumns = `${nameW}px ${c.start ? '64px ' : ''}repeat(${rows}, ${cellW}px) 1fr ${totalW}px`;
    sheet.style.gridTemplateRows = '';
    $('sheetWrap').classList.add('flipped');
    // what the columns need, borders and all, with a little over; and with
    // room, a wide sheet from the start, so it isn't growing round by round
    const need = nameW + (c.start ? 64 : 0) + rows * cellW + totalW + 24;
    $('sheetWrap').style.setProperty('--sheet-w', (roomy ? Math.max(need, 960) : need) + 'px');
    if (c.start) html += '<div class="rh start">Start</div>';
    for (let r = 1; r <= rows; r++) {
      html += `<div class="rh${r === cur && !over ? ' cur' : ''}" data-r="${r}"><small>Round</small>${r}</div>`;
    }
    html += '<div class="rh fill"></div><div class="rh tot">Total</div>';
    for (let p = 0; p < n; p++) {
      html += name(p);
      if (c.start) html += `<div class="cell start">${fmt(c.start)}</div>`;
      for (let r = 1; r <= rows; r++) html += cell(p, r);
      html += '<div class="cell fill"></div>';
      html += total(p);
    }
  }
  sheet.innerHTML = html;
}

$('sheet').addEventListener('click', (e) => {
  if (e.target.closest('.flipbtn')) {
    S.flip = !sheetFlipped();
    save(); render();
    requestAnimationFrame(() => showCurrent(false));
    return;
  }
  const cell = e.target.closest('button.cell');
  if (!cell) return;
  const p = Number(cell.dataset.p), r = Number(cell.dataset.r);
  if ((cell.classList.contains('open') || cell.textContent) && !mayScore(p)) return;
  if (cell.classList.contains('open')) { openEntry(p, r); return; }
  if (cell.textContent) {
    openEdit(S.log.indexOf(turnsBySide()[p][r - 1]), `#sheet button.cell[data-p="${p}"][data-r="${r}"]`);
    return;
  }
  flash(S.endedAt || result() ? 'The game is over' : `Round ${r} comes after this one`);
});

/* Bring the cell to play into view — the next player's, in the round being
   played — clear of the names along the top and left and the totals along
   the bottom, which stay put over the scrolling grid. */
function showCurrent(smooth) {
  const wrap = $('sheetWrap');
  const flip = $('sheet').classList.contains('flip');
  const cell = wrap.querySelector('button.cell.open.turn') || wrap.querySelector('button.cell.open')
    || wrap.querySelector(flip ? '.rh.cur' : '.lab.cur');
  if (!cell) return;
  const w = wrap.getBoundingClientRect(), r = cell.getBoundingClientRect();
  const corner = wrap.querySelector('.corner');
  // what stays put over the edges: the names and rounds, and the totals —
  // along the bottom, or down the right when the sheet is on its side
  const edge = { top: corner.offsetHeight, left: corner.offsetWidth, bottom: 0, right: 0 };
  if (flip) edge.right = wrap.querySelector('.cell.tot').offsetWidth;
  else edge.bottom = wrap.querySelector('.lab.tot').offsetHeight;
  let top = wrap.scrollTop, left = wrap.scrollLeft;
  const across = !cell.classList.contains('lab'), down = !cell.classList.contains('rh');
  if (down) {
    if (r.top < w.top + edge.top) top += r.top - (w.top + edge.top);
    else if (r.bottom > w.bottom - edge.bottom) top += r.bottom - (w.bottom - edge.bottom);
  }
  if (across) {
    if (r.left < w.left + edge.left) left += r.left - (w.left + edge.left);
    else if (r.right > w.right - edge.right) left += r.right - (w.right - edge.right);
  }
  wrap.scrollTo({ top, left, behavior: smooth ? 'smooth' : 'auto' });
}

/* Scoring a cell: the pad moves into a bubble beside it, pointing at it —
   below the cell when there is room, above when there is not, slid sideways
   to stay on screen, as the Yahtzee sheet's does. */
let entry = null;   // { p, r }: the cell being scored

function openEntry(p, r) {
  entry = { p, r };
  S.cur = p;
  S.pend = 0; S.parts = [];
  S.sign = S.cfg.mode === 'down' ? -1 : 1;
  $('typedIn').value = '';
  save(); render();
  showPad(`Round ${r}`, S.cfg.names[p]);
}

/* Changing a score already entered — a typo, or a rule remembered too late.
   The pad opens on the score as it stands, with what made it, so a missed
   +5 is one tap and a wrong total is Clear and the right one. Whose turn it
   is doesn't change. sel is the cell or history row the bubble points at. */
function openEdit(i, sel) {
  const e = S.log[i];
  if (!e) return;
  const r = roundsOfLog()[i];
  entry = { p: e.p, r, i, sel };
  S.pend = e.d;
  S.parts = (e.parts || []).slice();
  S.sign = S.cfg.mode === 'down' ? -1 : 1;
  $('typedIn').value = '';
  render();
  showPad(S.cfg.turns ? `Round ${r}: change the score` : 'Change the score', `${S.cfg.names[e.p]} · was ${turnText(e.d)}`);
}

function showPad(title, who) {
  $('entryTitle').textContent = title;
  $('entryWho').textContent = who;
  $('entrySlot').appendChild($('entry'));
  $('entryOverlay').classList.remove('hidden');
  placeEntry();
}

// Each log entry's round: how many scores its side has had, it included.
function roundsOfLog() {
  const seen = [];
  return S.log.map((e) => (seen[e.p] = (seen[e.p] || 0) + 1));
}

/* A change is asked about first, then kept: the score takes its new value,
   and the change goes in the game's list of them, which the history shows
   and Undo can take back. */
async function changeTurn() {
  const { i, r } = entry, e = S.log[i];
  const from = e.d, to = S.pend, name = S.cfg.names[e.p];
  if (from === to) return;
  const where = S.cfg.turns ? ` in round ${r}` : '';
  if (!(await askConfirm(`Change ${name}'s score${where} from ${turnText(from)} to ${turnText(to)}?`, 'Change'))) return;
  if (!S.edits) S.edits = [];
  S.edits.push({ i, p: e.p, r, from, to, fromParts: e.parts || [], after: S.log.length });
  e.d = to;
  e.parts = S.parts;
  S.scores[e.p] += to - from;
  S.pend = 0; S.parts = [];
  settleEnd();
  save();
  closeEntry();
  render();
  flash(`${name}${where}: ${turnText(from)} → ${turnText(to)}`);
  // the change decided the game
  const res = result();
  if (res && !S.endedAt) showWin(res);
}

/* After a score changes under a game that has ended, the end is looked at
   again: it may have a new winner, or no longer be over at all. A game
   ended with Finish stays finished, its winner the new highest. */
function settleEnd() {
  if (!S.endedAt) return;
  const open = S.cfg.win === 'none' && !S.cfg.useRounds;
  const r = open ? best(Math.max) : result();
  if (!r) { S.endedAt = null; S.winnerIdx = null; return; }
  S.winnerIdx = r.winners && r.winners.length === 1 ? r.winners[0] : null;
}

$('history').addEventListener('click', (e) => {
  const row = e.target.closest('[data-i]');
  if (row && S.log[row.dataset.i] && mayScore(S.log[row.dataset.i].p)) openEdit(Number(row.dataset.i), `#history [data-i="${row.dataset.i}"]`);
});

// Back to the page, and anything half-entered with it is let go.
function closeEntry() {
  if (!entry) return;
  entry = null;
  $('entryOverlay').classList.add('hidden');
  $('game').insertBefore($('entry'), document.querySelector('#game .actions'));
  if (S && (S.pend || (S.parts && S.parts.length))) { S.pend = 0; S.parts = []; save(); render(); }
}

function placeEntry() {
  if (!entry) return;
  const cell = document.querySelector(entry.sel || `#sheet button.cell[data-p="${entry.p}"][data-r="${entry.r}"]`);
  const card = $('entryCard');
  if (!cell) return;
  const vv = window.visualViewport;
  const viewH = vv ? vv.height : window.innerHeight, viewW = window.innerWidth;
  const top0 = vv ? vv.offsetTop : 0;
  const c = cell.getBoundingClientRect();
  const w = card.offsetWidth, h = card.offsetHeight, gap = 10, edge = 8;
  const left = Math.min(Math.max(c.left + c.width / 2 - w / 2, edge), viewW - w - edge);
  const below = c.bottom + gap + h <= top0 + viewH - edge || c.top - gap - h < top0 + edge;
  let top = below ? c.bottom + gap : c.top - gap - h;
  top = Math.min(Math.max(top, top0 + edge), top0 + viewH - h - edge);
  card.style.left = left + 'px';
  card.style.top = top + 'px';
  card.classList.toggle('below', below);
  card.classList.toggle('above', !below);
  card.style.setProperty('--ax', Math.min(Math.max(c.left + c.width / 2 - left, 18), w - 18) + 'px');
}
window.addEventListener('resize', placeEntry);
if (window.visualViewport) window.visualViewport.addEventListener('resize', placeEntry);

$('entryClose').onclick = closeEntry;
$('entryOverlay').addEventListener('click', (e) => { if (e.target === $('entryOverlay')) closeEntry(); });

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
  // the game is over: kept on it, so every save from here says so
  if (!S.endedAt) S.endedAt = Date.now();
  S.winnerIdx = r.winners && r.winners.length === 1 ? r.winners[0] : null;
  SCStore.put(TYPE, S, true);
  saveToProfile(r);
}

$('rematchBtn').onclick = () => {
  const { quickVals, quickKeys, members, ...c } = S.cfg;
  // a game in teams is rebuilt from its players, not from the team names
  if (c.playerNames) { c.names = c.playerNames; c.teamOf = c.playerTeams || []; }
  SCStore.remove(S.id);      // finished, and on the profile when signed in
  S = newGame(c);
  save();
  SCStore.show(S.id);
  $('winOverlay').classList.add('hidden');
  render();
};
$('keepBtn').onclick = () => $('winOverlay').classList.add('hidden');
$('newBtn').onclick = endGame;

// Clear the game and go back to the setup it came from.
function endGame() {
  const back = sourceHash(S.cfg.source || 'custom');
  SCStore.remove(S.id);
  S = null;
  SCStore.leave(back ? '#' + back : '');
  route();
}

// Resolves true for yes, false for cancel, and 'alt' for the middle choice
// when there is one.
function askConfirm(text, yesLabel, altLabel) {
  return new Promise((resolve) => {
    $('confirmText').textContent = text;
    $('confirmYes').textContent = yesLabel || 'Yes';
    $('confirmAlt').textContent = altLabel || '';
    $('confirmAlt').classList.toggle('hidden', !altLabel);
    $('confirmOverlay').classList.remove('hidden');
    const done = (v) => {
      $('confirmOverlay').classList.add('hidden');
      $('confirmYes').onclick = $('confirmAlt').onclick = $('confirmNo').onclick = null;
      resolve(v);
    };
    $('confirmYes').onclick = () => done(true);
    $('confirmAlt').onclick = () => done('alt');
    $('confirmNo').onclick = () => done(false);
  });
}

/* ?g=<id> — a game's own address: a link to it, or a reload. The game is
   opened from this device or, signed in, from the profile; ?resume=<id>
   asks for the profile's copy first, as it has been played on elsewhere. */
async function openFromUrl() {
  // ?s=<token>: a shared game, to score in together or to watch
  const shared = await SCShare.fromUrl(TYPE);
  if (shared && shared.kind === 'edit') { openGame(shared.state); return; }
  if (shared) { S = shared.state; showGame(); return; }
  const at = SCStore.urlId();
  if (at && !location.hash) {
    const st = await SCStore.open(TYPE, at.id, at.fresh);
    if (st && st.cfg) { openGame(st); return; }
    SCStore.leave();
    SCStore.notice("That game isn't on this device. Sign in to open games saved to your profile.");
  }
  route();
}


/* Shared by link (see /share.js): the game on screen, and how to show a
   newer one when it comes in from another phone. */
SCShare.attach({
  type: TYPE,
  get: () => S,
  apply: (st) => {
    closeEntry();
    S = st;
    settleEnd();
    save();
    showGame();
    // the score that came in decided the game
    const r = result();
    if (r && !S.endedAt) showWin(r);
  },
  // Shared by seat: a cell a score, '<player>:<round>'.
  cells: {
    names: (st) => st.cfg.names,
    of: (st) => {
      const out = {}, seen = [];
      for (const e of st.log) {
        const r = (seen[e.p] = (seen[e.p] || 0) + 1);
        out[`${e.p}:${r}`] = { d: e.d, parts: e.parts || [] };
      }
      return out;
    },
    build: fromCells,
  },
});

/* A game rebuilt from its cells (see /share.js), on what this phone had.
   The log runs round by round, each round in the order its scores came;
   the totals, whose turn it is and the changes made since a score went in
   all follow from it. A score that has changed since this phone last saw
   it goes in the history as a change, as one made here would. */
function fromCells(base, list) {
  const c = base.cfg, n = c.names.length;
  const before = {};
  { const seen = []; for (const e of base.log || []) before[`${e.p}:${(seen[e.p] = (seen[e.p] || 0) + 1)}`] = e; }

  const log = [];
  list.forEach(({ key, value }, k) => {
    const [p, r] = key.split(':').map(Number);
    if (p >= 0 && p < n && value) log.push({ p, r, k, d: Number(value.d) || 0, parts: value.parts || [] });
  });
  log.sort((a, b) => a.r - b.r || a.k - b.k);

  const scores = c.names.map(() => c.start);
  for (const e of log) scores[e.p] += e.d;
  const at = (p, r) => log.findIndex((e) => e.p === p && e.r === r);

  // changes already known here keep their place; new ones from elsewhere join them
  const edits = (base.edits || []).map((x) => ({ ...x, i: at(x.p, x.r) })).filter((x) => x.i >= 0);
  log.forEach((e, i) => {
    const was = before[`${e.p}:${e.r}`];
    if (was && was.d !== e.d) edits.push({ i, p: e.p, r: e.r, from: was.d, to: e.d, fromParts: was.parts || [], after: log.length });
  });

  // whose turn: the first still in the game without a score this round
  let cur = base.cur;
  if (c.turns) {
    const counts = c.names.map((_, p) => log.filter((e) => e.p === p).length);
    const live = counts.map((_, p) => p).filter((p) => !(c.win === 'zero' && scores[p] <= 0));
    const round = live.length ? Math.min(...live.map((p) => counts[p])) : 0;
    const next = live.find((p) => counts[p] === round);
    if (next !== undefined) cur = next;
  }
  return {
    ...base,
    log: log.map(({ p, d, parts }) => ({ p, d, parts, cur: p })),
    scores, edits, cur, pend: 0, parts: [],
  };
}

// Whether this phone may score player p: one that joined by seat scores
// its own player only.
function mayScore(p) {
  if (SCShare.canScore(p)) return true;
  flash(`${S.cfg.names[p]} is scored on their own phone`);
  return false;
}

$('shareBtn').onclick = () => SCShare.open();

/* ---------------- boot ---------------- */

openFromUrl();
loadMine();
