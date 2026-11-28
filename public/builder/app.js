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
  // saved before live games had a choice of buttons: they had them
  if (g) return { ...defaultRules(), pad: true, ...g.rules, name: g.name };
  return defaultRules();
};

// the hash that opens a source's setup
const sourceHash = (src) => src === 'custom' ? '' : src.startsWith('my:') ? 'my/' + src.slice(3) : src;
// The newest game in progress of one kind: Custom, a template, one of My games.
function latestOf(src) {
  const g = SCStore.latest(TYPE, (st) => (st.cfg && st.cfg.source || 'custom') === src);
  return g ? g.state : null;
}

// one rule against another: a list, like the counters, by what is in it
const sameRule = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

// whether the rules on screen differ from where they came from
const rulesChanged = () => RULE_KEYS.some(k => !sameRule(cfg[k], baseRules(source)[k]));

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
  // a game's own scoring (Spades, Skyjo) is part of the game, not a house
  // rule: whatever was kept for it, it scores as its template does
  const rules = { ...baseRules(src), ...mine, rule: baseRules(src).rule || '' };
  // copied, as they are changed in place: a template's own stay as they are
  rules.counters = (Array.isArray(rules.counters) ? rules.counters : []).map((k) => ({ ...k }));
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
    // live is decided here, so a game begun before there were live games
    // goes on being scored as it was
    cfg: { ...c, names, playerNames: players, members, playerTeams, quickKeys: parseQuick(c.quick).keys,
           useRounds: rounds, turns: c.turns || rounds || !!ruleOf(c), live: !ruleOf(c) && isLive(c), pad: padOn(c) },
    scores: names.map(() => c.start),
    // each side's counters, by counter id; see counterOf
    counts: names.map(() => Object.fromEntries((c.counters || []).map((k) => [k.id, k.start]))),
    // counter changes, oldest first: { p, id, from, to, after, ts } — after
    // how long the log was then, as for edits. A quick run of taps on one
    // counter is one change, so Undo takes back the run.
    clog: [],
    cur: 0,
    log: [],          // { p, d, cur, ts } — cur is who was on turn before it
    // scores changed after they were entered, oldest first:
    // { i, p, r, from, to, fromParts, after } — i the log entry, r its round,
    // after how long the log was then, which places it among the turns
    edits: [],
    pend: 0,
    parts: [],        // what made pend: { label, d } per tap, for the breakdown
    // a rule's entry being made: what happened this turn (see ROUND_RULES)
    rin: ruleBlank(c.rule),
    sign: c.mode === 'down' ? -1 : 1,
    // the scoresheet, for a game taken in turns; the switch changes this
    // game only; a new game opens as chosen at Start (see PICKS), or here
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
    // a rule's part says itself whether it was won or lost: "Bid 5, took 3: set"
    const text = p.label ? (p.d < 0 && !p.said ? '−' : '') + p.label : signed(p.d);
    const last = out[out.length - 1];
    if (last && last.text === text) last.n++;
    else out.push({ text, n: 1 });
  }
  return out.map((o) => (o.n > 1 ? `${o.text} ×${o.n}` : o.text)).join(' · ');
}

/* A game scored by a rule (see ROUND_RULES) has its scores worked out from
   every entry's `in`, again whenever anything changes: a score can depend
   on the rest of its round, or on the game so far. */
const ruleOn = () => !!(S && ruleOf(S.cfg));
function rescore(st = S) {
  if (!ruleOf(st.cfg)) return;
  const res = ruleScores(st.cfg, st.log, st.cfg.names.length);
  st.log.forEach((e, i) => { e.d = res[i].d; e.parts = res[i].parts; });
  st.scores = st.cfg.names.map(() => st.cfg.start);
  for (const e of st.log) st.scores[e.p] += e.d;
}

// What the entry being made would score, shown before it goes in: the
// pad's total and its breakdown, for a new entry or one being changed.
function ruleDraft() {
  const p = entry ? entry.p : S.cur;
  const i = entry && entry.i != null ? entry.i : null;
  const log = S.log.map((e) => ({ p: e.p, in: e.in }));
  const me = { p, in: { ...S.rin } };
  if (i === null) log.push(me); else log[i] = me;
  const res = ruleScores(S.cfg, log, S.cfg.names.length)[i === null ? log.length - 1 : i];
  S.pend = res.d;
  S.parts = res.parts;
}
// Skyjo's minus: on, the number typed is below zero, even before one is
let cardsBelow = false;
const freshRin = () => { S.rin = ruleBlank(S.cfg.rule); cardsBelow = false; };

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

/* ---------------- counters ----------------

   Counters live beside the log, not in it: a side's k-th log entry is its
   round k, and a counter can change at any moment without taking a turn.
   A game from before counters has none, and reads as having none. */
const countersOf = (st) => st.cfg.counters || [];
function counterOf(st, p, k) {
  const v = st.counts && st.counts[p] && st.counts[p][k.id];
  return Number.isInteger(v) ? v : k.start;
}

// A side is out at 0 in an Out at zero game, or on reaching any counter's
// Out at line.
function outOf(st, i) {
  if (st.cfg.win === 'zero' && st.scores[i] <= 0) return true;
  return countersOf(st).some((k) => k.end === 'out' && counterReached(k, counterOf(st, i, k)));
}
const isOut = (i) => outOf(S, i);
// whether anyone can go out at all, which makes the last left the winner
const outs = (c) => c.win === 'zero' || (c.counters || []).some((k) => k.end === 'out');

// the first side to reach a Wins at line, and the counter it reached
function counterWin() {
  for (const k of countersOf(S)) {
    if (k.end !== 'win') continue;
    const p = S.scores.findIndex((_, i) => counterReached(k, counterOf(S, i, k)));
    if (p >= 0) return { winners: [p], by: k };
  }
  return null;
}

const COUNTER_RUN = 4000;   // taps closer together than this are one change

/* ---------------- live scoring ----------------

   A game without turns is live: a tap changes the score at once, with no
   Enter. The log still keeps each change, so the history, Undo, sharing
   and the profile all read it as before — a quick run of taps on one
   player being one entry, as with the counters. Only a run made on this
   phone is added to, so one never takes over an entry from elsewhere. */
const liveOn = () => !!(S && S.cfg.live);
let liveRun = null;   // { i, p, ts }: the entry this phone's taps are adding to

function liveAdd(p, d, label = '') {
  if (!d || !mayScore(p)) return;
  const now = Date.now(), last = S.log[S.log.length - 1];
  // the run goes on only while nothing else has happened since it began
  const later = (xs) => (xs || []).some((y) => y.after === S.log.length && (y.ts || 0) > last.ts);
  const going = liveRun && last && liveRun.i === S.log.length - 1 && liveRun.p === p && last.p === p
    && now - liveRun.ts < COUNTER_RUN && !later(S.clog) && !later(S.edits);
  const crossedBefore = lineCrossed(), wasOut = isOut(p);
  if (going) {
    last.d += d;
    last.parts = [...(last.parts || []), { label, d }];
    last.ts = now;
    liveRun.ts = now;
    // tapped back to where it began: no change at all
    if (last.d === 0) { S.log.pop(); liveRun = null; }
  } else {
    S.log.push({ p, d, cur: S.cur, parts: [{ label, d }], ts: now });
    liveRun = { i: S.log.length - 1, p, ts: now };
  }
  S.scores[p] += d;
  if (isOut(p) && !wasOut) flash(`${S.cfg.names[p]} is out`);
  settleEnd();
  save(); render();
  const r = result();
  if (r && !S.endedAt) decide(r);
  else if (!crossedBefore && lineCrossed()) flash(`${S.cfg.names[p]} reached ${fmt(S.cfg.target)}`);
}

function bump(p, id, d) {
  const k = countersOf(S).find((x) => x.id === id);
  if (!k || !mayScore(p)) return;
  if (!S.counts) S.counts = S.scores.map(() => ({}));
  if (!S.clog) S.clog = [];
  const from = counterOf(S, p, k), to = from + d;
  S.counts[p] = { ...S.counts[p], [id]: to };
  const last = S.clog[S.clog.length - 1], now = Date.now();
  if (last && last.p === p && last.id === id && last.after === S.log.length && !last.remote && now - last.ts < COUNTER_RUN) {
    last.to = to; last.ts = now;
    if (last.to === last.from) S.clog.pop();   // tapped back to where it was
  } else {
    S.clog.push({ p, id, from, to, after: S.log.length, ts: now });
  }
  const wasOut = counterReached(k, from) && k.end === 'out';
  if (k.end === 'out' && counterReached(k, to) && !wasOut) flash(`${S.cfg.names[p]} is out`);
  // a player gone out can't be the one on turn
  if (isOut(S.cur) && S.cfg.turns) S.cur = nextPlayer(S.cur);
  settleEnd();
  save(); render();
  const r = result();
  if (r && !S.endedAt) decide(r);
}

// Someone has reached the target, or the limit when lowest wins.
function lineCrossed() {
  const { win, target, useRounds } = S.cfg;
  if (useRounds || (win !== 'target' && win !== 'low')) return false;
  return S.scores.some((s) => s >= target);
}

// How many turns each side has had, and the sides still in the game.
const turnCounts = () => S.scores.map((_, p) => S.log.filter((e) => e.p === p).length);
const liveSides = () => S.scores.map((_, p) => p).filter((p) => !isOut(p));

// Every side still in has had the same number of turns: a round has just
// finished. A side gone out is waited for no longer.
function roundDone() {
  const t = turnCounts(), live = liveSides();
  return live.every((p) => t[p] === t[live[0]]);
}

// The line has been crossed, and the round is being played out.
const finalRound = () => S.cfg.turns && lineCrossed() && !roundDone();

// Who has won, or null while the game is still going.
function result() {
  const { win, target, useRounds, rounds } = S.cfg;
  const sc = S.scores, n = sc.length;
  // a counter's Wins at line is a finish line of its own, crossed at once
  const byCounter = counterWin();
  if (byCounter) return byCounter;
  // every side still in has played the last round
  if (useRounds) {
    const t = turnCounts(), live = liveSides();
    if (live.length && live.every((p) => t[p] >= rounds)) return best(win === 'low' ? Math.min : Math.max);
  } else if (lineCrossed()) {
    // Reaching the target (or the limit) ends the game — but in a game taken
    // in turns, only once the round is over, so everyone scores the last
    // round and the best score then wins, not merely the first past the line.
    if (S.cfg.turns && !roundDone()) return null;
    return best(win === 'low' ? Math.min : Math.max);
  }
  if (outs(S.cfg)) {
    const alive = sc.map((s, i) => i).filter(i => !isOut(i));
    if (n === 1 && alive.length === 0) return { winners: [], solo: true };
    if (n > 1 && alive.length <= 1) return { winners: alive };
  }
  return null;
}
// the best score among the sides still in, or among all when none are
function best(pick) {
  const live = liveSides(), from = live.length ? live : S.scores.map((_, i) => i);
  const v = pick(...from.map((i) => S.scores[i]));
  return { winners: from.filter(i => S.scores[i] === v) };
}

/* Whose turn follows from's: the next side still in that has had the
   fewest turns, so a round always finishes before anyone plays again, even
   after Edit has changed the order part-way through it, or a turn was
   taken out of order (see nextTurn in /editgame.js). Whoever it passes
   over is said, in skipSaid. */
let skipSaid = null;
function nextPlayer(from) {
  const { next, skipped } = SCEditGame.nextTurn(from, turnCounts(), (i) => !isOut(i));
  skipSaid = skipped.length ? SCEditGame.skipNote(S.cfg.names, skipped, next) : null;
  return next;
}

/* ---------------- screens ---------------- */

function show(id) {
  for (const s of ['setup', 'pick', 'game']) $(s).classList.toggle('hidden', s !== id);
  // in a game, the sign-in button would sit on the view switch
  document.body.classList.toggle('playing', id === 'game');
  // and the screen stays on through it: see /awake.js
  SCAwake.keep(id === 'game');
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

function openSetup(src) {
  source = src;
  cfg = loadCfg(src);
  // a ready-made game opens on its players; Custom walks the steps
  editing = false;
  step = src === 'custom' ? 'game' : 'players';
  renderTitle();
  renderPicker();

  renderSetup();
  show('setup');
}

function renderTitle() {
  // titled as the game when it is one, since the home page links here too
  const t = TEMPLATES.find(t => t.id === source), g = myGame(source);
  $('setupTitle').textContent = t ? t.label : g ? g.name : 'Score Chalk Builder';
  // not the rules: the Rules card shows those, as you've set them
  $('setupSub').textContent = t || g ? 'Add the players and start' : 'Build a scorekeeper for any game';
  setGuide($('setupGuide'), source);
}

// a link to a game's scoring guide (see GUIDES in rules.js)
function setGuide(a, src) {
  const gd = guideOf(src);
  a.href = gd.href;
  a.textContent = gd.text;
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

let setupMe = SCShare.lastMe();   // who is holding the phone: see /share.js
/* Which player is you is marked in the players' list itself: a person
   beside each name, the one that is you showing You. Tapping it again
   marks no one. Shown without redrawing the list, so a name being typed
   keeps hold of its box. */
function renderYou() {
  const n = cfg.names.length;
  if (setupMe !== null && setupMe >= n) setupMe = 0;
  $('names').querySelectorAll('.me-btn').forEach((b, i) => {
    if (i >= n) return;   // a row on its way out
    const on = i === setupMe, name = cfg.names[i].trim() || `Player ${i + 1}`;
    b.classList.toggle('is-on', on);
    b.setAttribute('aria-pressed', on);
    b.setAttribute('aria-label', on ? `${name} is you — tap to mark no one` : `Mark ${name} as you`);
  });
}

function pickMe(i) {
  setupMe = setupMe === i ? null : i;
  SCShare.rememberMe(setupMe);
  renderYou();
}

function renderSetup() {
  renderRulesCard();
  setRoom(themeOf(cfg));
  renderThemes();
  $('gameName').value = cfg.name;

  const n = cfg.names.length;
  const teamed = teamsOn(cfg, n);
  renderRoster();   // and who is you, in it

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

  // With a fixed number of rounds, chosen on the first step, the game ends
  // on them: only the endings that can are offered, and Just keep score is
  // the highest after the last round.
  const rounds = roundsOn(cfg);
  const row = $('winRow');
  row.innerHTML = '';
  for (const o of WIN_OPTS) {
    const b = document.createElement('button');
    b.className = 'seg' + (o.id === cfg.win ? ' is-on' : '');
    b.textContent = rounds && o.id === 'none' ? 'Highest wins' : o.label;
    b.disabled = rounds && !o.roundsHint;
    b.onclick = () => {
      cfg.win = o.id;
      if (o.mode) setMode(o.mode);
      saveCfg();
      renderSetup();
    };
    row.appendChild(b);
  }
  const cur = ending(cfg);
  $('winHint').textContent = rounds ? cur.roundsHint : cur.hint;
  // with a round count, Lowest wins ends on rounds instead of a score limit
  $('targetField').classList.toggle('hidden', !cur.target || rounds);
  $('targetLabel').textContent = cur.target || 'Target';
  $('target').value = cfg.target;

  $('roundsBox').classList.toggle('hidden', !cfg.turns);
  setToggle($('useRounds'), rounds);
  $('roundsField').classList.toggle('hidden', !rounds);
  $('rounds').value = cfg.rounds;

  document.querySelectorAll('#modeRow .seg').forEach(b => {
    b.classList.toggle('is-on', b.dataset.mode === cfg.mode);
    b.disabled = !!cur.mode && b.dataset.mode !== cur.mode;
  });

  // live: the buttons are a choice, and only shown once chosen
  const live = isLive(cfg);
  $('pad').classList.toggle('hidden', !live);
  setToggle($('pad'), padOn(cfg));
  $('padRules').classList.toggle('hidden', live && !padOn(cfg));
  $('quickLabel').classList.toggle('hidden', live);
  $('quick').value = cfg.quick;
  renderQuickPreview();
  setToggle($('typed'), cfg.typed);
  setToggle($('signs'), cfg.signs);
  document.querySelectorAll('#turnsRow .way').forEach((b) => {
    const on = (b.dataset.turns === '1') === !!(cfg.turns || rounds);
    b.classList.toggle('is-on', on);
    b.setAttribute('aria-checked', on);
  });
  renderCounterList();
  renderRuleLimits();

  $('playersTab').textContent = String(n);
  showStep(step);
}

/* A game with scoring of its own (see ROUND_RULES) takes turns and counts
   up, so the ways and endings that can't go with it are out of reach, as an
   ending does for the direction. Its scoring is said in place of the
   quick-score buttons, which it doesn't use. */
function renderRuleLimits() {
  const rule = ruleOf(cfg);
  $('ruleCard').classList.toggle('hidden', !rule);
  $('keysCard').classList.toggle('hidden', !!rule);
  if (rule) $('ruleHint').textContent = rule.hint;
  document.querySelectorAll('#turnsRow .way').forEach((b) => { b.disabled = !!rule && b.dataset.turns === '0'; });
  if (rule) {
    document.querySelectorAll('#modeRow .seg').forEach((b) => { if (b.dataset.mode === 'down') b.disabled = true; });
    document.querySelectorAll('#winRow .seg').forEach((b, i) => { if (WIN_OPTS[i].id === 'zero') b.disabled = true; });
  }
}

/* The setup's three steps, a screen each; the tabs reach any of them. The
   button at the foot is Next until the last, which starts the game — and
   for a game whose rules are already made, a template or one of My games,
   the players are enough: it starts from there too. */
const STEPS = ['game', 'players', 'scoring'];
const STEP_NAMES = { game: 'Game', players: 'Players', scoring: 'Scoring' };
let step = 'game';
// A ready-made game opens on its players alone, its rules in a line; going
// to any other step (Change the rules, or a problem found at Start) opens
// the steps for the rest of this visit.
let editing = false;
const quickSetup = () => source !== 'custom' && !editing;

function showStep(s) {
  if (s !== 'players') editing = true;
  const moved = s !== step;
  step = s;
  $('stages').classList.toggle('hidden', quickSetup());
  $('quickRules').classList.toggle('hidden', !quickSetup());
  document.querySelectorAll('#stages .stage').forEach((b) => b.classList.toggle('is-on', b.dataset.step === s));
  document.querySelectorAll('#setup .pane').forEach((el) => el.classList.toggle('hidden', el.dataset.step !== s));
  const ready = source !== 'custom' && s === 'players';
  const last = s === STEPS[STEPS.length - 1] || ready;
  $('nextBtn').classList.toggle('hidden', last);
  $('startBtn').classList.toggle('hidden', !last);
  if (!last) $('nextBtn').textContent = `Next: ${STEP_NAMES[STEPS[STEPS.indexOf(s) + 1]]}`;
  if (moved) window.scrollTo(0, 0);
}

$('stages').addEventListener('click', (e) => {
  const b = e.target.closest('.stage');
  if (b) showStep(b.dataset.step);
});
$('nextBtn').onclick = () => showStep(STEPS[STEPS.indexOf(step) + 1]);
$('editRules').onclick = () => showStep('game');

/* The counters on the setup screen, one row each: its name, where it
   starts, and what reaching a number does. Typing changes the rules
   without drawing the list again, so the box being typed in keeps hold. */
function renderCounterList() {
  const box = $('counterList');
  box.innerHTML = '';
  cfg.counters.forEach((k, i) => {
    const row = document.createElement('div');
    row.className = 'crow';
    row.innerHTML = `
      <div class="crow-top">
        <input class="c-name" type="text" maxlength="16" autocomplete="off" placeholder="Counter ${i + 1}" aria-label="Counter name">
        <button type="button" class="c-del" aria-label="Remove this counter">&times;</button>
      </div>
      <div class="crow-rules">
        <label class="c-start"><span>Starts at</span><input type="number" inputmode="numeric"></label>
        <select class="c-end" aria-label="What it does">${COUNTER_ENDS.map((o) => `<option value="${o.id}">${o.label}</option>`).join('')}</select>
        <input class="c-at" type="number" inputmode="numeric" aria-label="The number it reaches">
      </div>`;
    const [name, start, end, at] = ['.c-name', '.c-start input', '.c-end', '.c-at'].map((s) => row.querySelector(s));
    name.value = k.name;
    start.value = k.start;
    end.value = k.end;
    at.value = k.at;
    at.classList.toggle('hidden', k.end === 'none');
    const whole = (v) => Math.round(Number(v)) || 0;
    name.addEventListener('input', () => { k.name = name.value; saveCfg(); });
    start.addEventListener('input', () => { k.start = whole(start.value); saveCfg(); });
    at.addEventListener('input', () => { k.at = whole(at.value); saveCfg(); });
    end.addEventListener('change', () => { k.end = end.value; saveCfg(); renderCounterList(); });
    row.querySelector('.c-del').onclick = () => { cfg.counters.splice(i, 1); saveCfg(); renderCounterList(); };
    box.appendChild(row);
  });
  $('addCounter').classList.toggle('hidden', cfg.counters.length >= MAX_COUNTERS);
}

$('addCounter').onclick = () => {
  if (cfg.counters.length >= MAX_COUNTERS) return;
  cfg.counters.push(newCounter(cfg.counters.length + 1));
  saveCfg(); renderCounterList();
  const ins = $('counterList').querySelectorAll('.c-name');
  ins[ins.length - 1].select();
};

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
  for (const k of Object.keys(base)) if (k !== 'rule' && !sameRule(cfg[k], base[k])) mine[k] = cfg[k];
  const all = loadJSON(RULES_KEY) || {};
  if (Object.keys(mine).length) all[source] = mine; else delete all[source];
  saveJSON(RULES_KEY, all);
  renderRulesCard();
}

function renderRulesCard() {
  const t = TEMPLATES.find(t => t.id === source), g = myGame(source);
  const named = !!(t || g);              // custom is the one that isn't
  $('rulesText').textContent = describeRules(cfg);
  // only when they differ from the game's own, not merely when some were kept
  const own = rulesChanged();
  $('quickText').textContent = (own ? 'Your rules: ' : '') + describeRules(cfg);
  $('rulesText').classList.toggle('hidden', !named);

  // Reset is always there, so a bumped button or dial can always be put
  // back; it is greyed out when the rules, and the player count, already are
  // the game's own: Custom's plain tally, a template's standard rules, or a
  // My game as it was saved.
  const ruleEdits = g ? rulesChanged() : !!(loadJSON(RULES_KEY) || {})[source];
  const changed = ruleEdits || cfg.names.length !== (baseRules(source).players || 2);
  $('rulesReset').textContent = g ? 'Undo changes' : t ? `Reset to standard ${t.label}` : 'Reset to defaults';
  $('rulesReset').disabled = !changed;
  $('rulesSave').classList.toggle('hidden', !(g && ruleEdits));

  // saving a new game is for rules that aren't one of yours already
  $('saveMine').classList.toggle('hidden', !me || !!g);
}


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

/* The players: a numbered list as the tournament's, under a box for the
   next name. A name already listed can be changed
   where it is — names are kept from game to game, and a template opens with
   its own number of seats, any without a name yet showing as Player 3. In
   teams, a player's team chip stands in for the number: tap it to move
   them.

   How many are listed is the player count. For a template it is tonight's
   only: Canasta opens with four every time. For Custom and My games it is
   the game's own default — Custom remembers it, and a change to one of My
   games is saved with Save changes, like any other rule. */
function renderRoster() {
  const n = cfg.names.length;
  const teamed = teamsOn(cfg, n), teams = teamed ? teamsFor(cfg) : null;
  const list = $('names');
  list.innerHTML = '';
  cfg.names.forEach((name, i) => {
    const li = document.createElement('li');
    let mark;
    if (teamed) {
      mark = document.createElement('button');
      mark.type = 'button';
      mark.className = 'team-chip';
      mark.textContent = TEAM_LETTERS[teams[i]];
      mark.style.setProperty('--tc', TEAM_COLORS[teams[i]]);
      mark.setAttribute('aria-label', `Team ${TEAM_LETTERS[teams[i]]} — tap to change`);
      mark.onclick = () => {
        cfg.teamOf = teamsFor(cfg);
        cfg.teamOf[i] = (cfg.teamOf[i] + 1) % cfg.teamCount;
        saveCfg(); renderSetup();
      };
    } else {
      mark = document.createElement('i');
      mark.textContent = `${i + 1}.`;
    }
    const inp = document.createElement('input');
    inp.type = 'text'; inp.maxLength = 14; inp.autocomplete = 'off';
    inp.className = 'roster-name';
    inp.placeholder = `Player ${i + 1}`; inp.value = name;
    inp.setAttribute('aria-label', `Player ${i + 1}'s name`);
    inp.addEventListener('input', () => { cfg.names[i] = inp.value; saveCfg(); renderYou(); });
    const del = document.createElement('button');
    del.type = 'button';
    del.textContent = '×';
    del.disabled = n <= 1;
    del.setAttribute('aria-label', `Remove ${name.trim() || `Player ${i + 1}`}`);
    del.onclick = () => removePlayer(i);
    // whether this one is you: see renderYou
    const me = document.createElement('button');
    me.type = 'button';
    me.className = 'me-btn';
    me.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8"/></svg><b>You</b>';
    me.onclick = () => pickMe(i);
    // and a grip, to drag it up or down the list (see /roster.js)
    li.append(mark, inp, me, del, SCRoster.grip(`Move ${name.trim() || `Player ${i + 1}`}`));
    list.appendChild(li);
  });
  renderYou();
  $('addForm').classList.toggle('hidden', n >= MAX_PLAYERS);
  $('playersNote').textContent = n >= MAX_PLAYERS ? `${MAX_PLAYERS} players, the most a game takes` : '';
}

const countPlayers = () => { if (!TEMPLATES.some((t) => t.id === source)) cfg.players = cfg.names.length; };

$('addForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const name = $('addName').value.trim();
  if (!name || cfg.names.length >= MAX_PLAYERS) return;
  cfg.names.push(name);
  countPlayers();
  $('addName').value = '';
  saveCfg(); renderSetup();
  $('addName').focus();
});

/* The order of the list is the order of play. A player moved takes their
   team with them, and You are follows them; the names kept on this device
   take the new order when the rules are saved. */
SCRoster.sortable($('names'), (from, to) => {
  const move = (a) => { if (Array.isArray(a) && a.length > Math.max(from, to)) a.splice(to, 0, a.splice(from, 1)[0]); };
  cfg.teamOf = teamsFor(cfg);
  move(cfg.names);
  move(cfg.teamOf);
  if (setupMe !== null) {
    const order = cfg.names.map((_, i) => i);
    move(order);   // where each place's player came from
    setupMe = order.indexOf(setupMe);
    SCShare.rememberMe(setupMe);
  }
  saveCfg(); renderSetup();
});

// The names kept on this device lose the same place, so the ones after it
// move up with the list rather than coming back under the wrong number.
function removePlayer(i) {
  if (cfg.names.length <= 1) return;
  const saved = savedNames();
  saved.splice(i, 1);
  saveJSON(PLAYERS_KEY, saved);
  cfg.names.splice(i, 1);
  if (Array.isArray(cfg.teamOf)) cfg.teamOf.splice(i, 1);
  // you go with your name, and move up with the list
  if (setupMe !== null) {
    setupMe = setupMe === i ? null : setupMe > i ? setupMe - 1 : setupMe;
    SCShare.rememberMe(setupMe);
  }
  countPlayers();
  // fewer players may allow fewer teams
  cfg.teamCount = Math.min(cfg.teamCount || 2, maxTeams(cfg.names.length)) || 2;
  saveCfg(); renderSetup();
}

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
// Rounds are chosen ahead of the ending: one that can't end on rounds
// gives way to Highest wins.
$('useRounds').onclick = () => {
  cfg.useRounds = !roundsOn(cfg);
  if (cfg.useRounds && !ending(cfg).roundsHint) cfg.win = 'none';
  saveCfg(); renderSetup();
};
$('rounds').addEventListener('input', (e) => { cfg.rounds = Math.max(1, Math.round(Number(e.target.value)) || 1); saveCfg(); });
$('quick').addEventListener('input', (e) => { cfg.quick = e.target.value; saveCfg(); renderQuickPreview(); });
$('typed').onclick = () => { cfg.typed = !cfg.typed; setToggle($('typed'), cfg.typed); saveCfg(); };
$('signs').onclick = () => { cfg.signs = !cfg.signs; setToggle($('signs'), cfg.signs); saveCfg(); };
// rounds are counted in turns, so they go with them
$('turnsRow').addEventListener('click', (e) => {
  const b = e.target.closest('.way');
  if (!b) return;
  cfg.turns = b.dataset.turns === '1';
  if (!cfg.turns) cfg.useRounds = false;
  saveCfg(); renderSetup();
});
$('pad').onclick = () => { cfg.pad = !padOn(cfg); saveCfg(); renderSetup(); };

$('startBtn').onclick = async () => {
  const usesPad = !ruleOf(cfg) && (!isLive(cfg) || padOn(cfg));
  if (usesPad && !parseQuick(cfg.quick).keys.length && !cfg.typed) {
    flashSetup('Add at least one quick-score button, or switch on typed scores.', 'scoring');
    return;
  }
  cfg.counters.forEach((k, i) => { k.name = k.name.trim() || `Counter ${i + 1}`; });
  const flat = cfg.counters.find((k) => k.end !== 'none' && k.at === k.start);
  if (flat) {
    flashSetup(`${flat.name} starts at ${fmt(flat.at)}: pick a different number for it to reach.`, 'scoring');
    return;
  }
  if (teamsOn(cfg, cfg.names.length)) {
    const t = teamsFor(cfg);
    for (let k = 0; k < cfg.teamCount; k++) {
      if (!t.includes(k)) { flashSetup(`Team ${TEAM_LETTERS[k]} has no players yet.`, 'players'); return; }
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
  // a game taken in turns can be kept as a board or a sheet: ask which
  if (cfg.turns || roundsOn(cfg)) { showPick(0); return; }
  beginGame();
};

function beginGame(view) {
  S = newGame({ ...cfg, source });
  if (view) S.view = view;
  // in teams, you are the side your player is on
  S.me = setupMe === null ? null : (S.cfg.playerTeams ? S.cfg.playerTeams[setupMe] : setupMe);
  save();
  openGame(S);
}

/* ---------------- board or sheet: chosen before the first turn ----------------

   A game taken in turns can be kept as a board (a big score each, the turn
   entered below) or a sheet (a row a round, a column a player). The switch
   at the top of the game has always changed it, but a switch never noticed
   is no choice at all — so Start Game offers both, with a picture of each,
   and says it can be switched. The choice is remembered on the device for
   the next game; the switch in a game changes only that game. PICKS and
   pickAt are shared in shape with cribbage's, which has two screens. */
const VIEW_KEY = 'builder-view';
const viewPref = () => { try { return localStorage.getItem(VIEW_KEY); } catch (e) { return null; } };
const PICKS = [
  { title: 'How do you want to keep score?',
    lede: 'Everyone takes turns in this game, so it can be kept two ways.',
    note: 'You can switch any time during the game, with Board · Sheet at the top.',
    get: () => viewPref() || 'sheet', chosen: () => viewPref() !== null,
    set: (m) => { try { localStorage.setItem(VIEW_KEY, m); } catch (e) {} },
    opts: [
      { mode: 'sheet', label: 'Sheet', text: 'Like a paper score sheet: a row for each round, a column for each player.' },
      { mode: 'board', label: 'Board', text: 'A big running total for each player, with the turn entered underneath.' },
    ] },
];
let pickAt = 0;

function showPick(i) {
  pickAt = i;
  const k = PICKS[i], now = k.chosen() ? k.get() : null;
  // pictured in the room this game is played in
  const room = themeOf(cfg);
  $('pickTitle').textContent = k.title;
  $('pickLede').textContent = k.lede;
  $('pickNote').textContent = k.note;
  $('pickOpts').innerHTML = k.opts.map((o) => `
    <button class="pick-opt${o.mode === now ? ' is-current' : ''}" type="button" data-mode="${o.mode}">
      <img src="previews/view-${o.mode}-${room}.webp" alt="${esc(o.label)}: ${esc(o.text)}" loading="lazy">
      <span class="pick-label"><b>${esc(o.label)}</b>${o.mode === now ? '<i>Last time</i>' : ''}</span>
      <span class="pick-text">${esc(o.text)}</span>
    </button>`).join('');
  show('pick');
}

$('pickOpts').addEventListener('click', (e) => {
  const b = e.target.closest('[data-mode]');
  if (!b) return;
  PICKS[pickAt].set(b.dataset.mode);
  if (pickAt + 1 < PICKS.length) { showPick(pickAt + 1); return; }
  beginGame(b.dataset.mode);
});

$('pickBack').onclick = () => {
  if (pickAt > 0) { showPick(pickAt - 1); return; }
  show('setup');
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
    // who You are, picked at the setup (their side, in a game of teams);
    // No one leaves it to the first
    me_idx: Number.isInteger(S.me) ? S.me : 0,
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

// A problem with the setup, said on the button at the foot — on the step
// it belongs to, when it has one.
function flashSetup(text, at) {
  if (at) showStep(at);
  const btn = $('startBtn').classList.contains('hidden') ? $('nextBtn') : $('startBtn'), was = btn.textContent;
  btn.textContent = text;
  btn.classList.add('danger');
  setTimeout(() => { btn.textContent = was; btn.classList.remove('danger'); }, 2200);
}

/* ---------------- game screen ---------------- */

function showGame() {
  show('game');
  setGuide($('gameGuide'), S.cfg.source || 'custom');
  setRoom(themeOf(S.cfg));
  // only a game with no ending of its own needs telling when it is over
  const open = S.cfg.win === 'none' && !S.cfg.useRounds;
  $('finishBtn').classList.toggle('hidden', !open);
  // Undo, Share, New game — and Finish, for a game with no end of its own
  // and Edit, always: see editGame
  document.querySelector('.mini-row').classList.toggle('four', !open);
  document.querySelector('.mini-row').classList.toggle('five', open);
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
  buildCounters();
  buildTiles();
  applyLayout();

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
  // its own classes only: whether it is shown at all is applyLayout's
  board.classList.toggle('solo', n === 1);
  board.classList.toggle('many', n > 1 && colW < 110);

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
  layoutTiles();
  if (sheetOn()) renderSheet();
});

/* ---------------- the tiles ----------------

   A tile a side, holding all of its numbers: the name, the score, and each
   counter. In a live game the score has its own − and + too. They stand in
   for the board in a live game and in any game with counters; the sheet,
   for a game taken in turns, keeps the counters' table under it instead. */
const tiled = () => liveOn() || countersOf(S).length > 0;

function applyLayout() {
  const sheet = sheetOn(), tiles = tiled();
  $('tiles').classList.toggle('hidden', !tiles || sheet);
  $('scoreboard').classList.toggle('hidden', tiles);
  $('counters').classList.toggle('hidden', !countersOf(S).length || !sheet);
  // live with no buttons: the − and + on the tiles are all there is
  $('entry').classList.toggle('hidden', liveOn() && !S.cfg.pad);
  $('entry').classList.toggle('live', liveOn());
  layoutTiles();
}

function buildTiles() {
  const box = $('tiles'), ks = countersOf(S), live = liveOn();
  box.innerHTML = '';
  if (!tiled()) return;
  S.cfg.names.forEach((name, p) => {
    const t = document.createElement('div');
    t.className = 'tile';
    t.dataset.p = p;
    const step = (d) => live ? `<button class="tstep" data-d="${d}" aria-label="${d < 0 ? 'Take one from' : 'Add one to'} ${esc(name)}">${d < 0 ? '&minus;' : '+'}</button>` : '';
    t.innerHTML = `<div class="tname"></div>`
      + `<div class="tscore">${step(-1)}<span class="tnum"><b class="pnum"></b><i class="ppend"></i></span>${step(1)}</div>`
      + `<div class="pmeta"></div>`
      + ks.map((k) => `<div class="trow" data-id="${k.id}"><span>${esc(k.name || 'Counter')}</span>`
        + `<button class="cstep" data-d="-1" aria-label="${esc(k.name)} down for ${esc(name)}">&minus;</button><b></b>`
        + `<button class="cstep" data-d="1" aria-label="${esc(k.name)} up for ${esc(name)}">+</button></div>`).join('');
    t.querySelector('.tname').textContent = name;
    box.appendChild(t);
  });
}

// Tiles share the width as the board's columns do: as many to a row as fit
// at a readable width — two on a phone — spread evenly over the rows. Two or
// three players get a tile each across the whole width, and bigger numbers.
const TILE_W = 160;
function layoutTiles() {
  const box = $('tiles');
  if (!S || !box.children.length) return;
  const n = box.children.length;
  const roomy = n <= 3;
  const fit = roomy ? 1 : Math.max(1, Math.min(4, Math.floor(($('game').clientWidth - 20) / TILE_W)));
  const rows = Math.ceil(n / fit);
  const sizes = Array.from({ length: rows }, (_, k) => Math.floor(n / rows) + (k < n % rows ? 1 : 0));
  let i = 0;
  for (const size of sizes) for (let k = 0; k < size; k++, i++) box.children[i].style.gridColumn = `span ${60 / size}`;
  box.classList.toggle('solo', n === 1);
  box.classList.toggle('roomy', roomy);
}

function renderTiles() {
  if (!tiled()) return;
  const ks = countersOf(S), leader = leaderOf();
  [...$('tiles').children].forEach((t) => {
    const p = Number(t.dataset.p);
    // who the buttons, or the next score, go to: only once there is a choice
    t.classList.toggle('active', p === S.cur && (!liveOn() || S.cfg.pad) && S.scores.length > 1);
    t.classList.toggle('out', isOut(p));
    t.classList.toggle('leader', p === leader);
    t.classList.toggle('pending', p === S.cur && S.pend !== 0);
    t.classList.toggle('mine', SCShare.canScore(p));
    t.querySelector('.pnum').textContent = fmt(S.scores[p]);
    t.querySelector('.ppend').textContent = '→ ' + fmt(S.scores[p] + S.pend);
    const mine = S.log.filter((e) => e.p === p), last = mine[mine.length - 1];
    t.querySelector('.pmeta').textContent = isOut(p) ? 'out' : !liveOn() && last ? `last ${signed(last.d)}` : '';
    t.querySelectorAll('.trow').forEach((row) => {
      const k = ks.find((x) => x.id === row.dataset.id), v = counterOf(S, p, k);
      row.querySelector('b').textContent = fmt(v);
      row.classList.toggle('hit', counterReached(k, v));
    });
  });
}

$('tiles').addEventListener('click', (e) => {
  const t = e.target.closest('.tile');
  if (!t) return;
  const p = Number(t.dataset.p);
  const b = e.target.closest('button');
  if (b && b.classList.contains('tstep')) { liveAdd(p, Number(b.dataset.d)); return; }
  if (b && b.classList.contains('cstep')) { bump(p, b.closest('.trow').dataset.id, Number(b.dataset.d)); return; }
  // anywhere else on a tile picks who the buttons go to
  if (S.cur !== p && mayScore(p)) { S.cur = p; save(); render(); }
});

/* The counters: a column a counter, a row a side, each value between its
   − and +. They change at any time, whoever's turn it is, and never pass
   the turn. On a phone that joined by seat only its own row can be changed. */
function buildCounters() {
  const ks = countersOf(S), c = S.cfg;
  if (!ks.length) { $('ctable').innerHTML = ''; return; }
  const t = $('ctable');
  t.style.gridTemplateColumns = `minmax(64px, 1fr) repeat(${ks.length}, minmax(96px, auto))`;
  let html = '<div class="chd"></div>';
  for (const k of ks) {
    const line = k.end === 'win' ? `wins at ${fmt(k.at)}` : k.end === 'out' ? `out at ${fmt(k.at)}` : '';
    html += `<div class="chd"><b>${esc(k.name || 'Counter')}</b>${line ? `<small>${line}</small>` : ''}</div>`;
  }
  c.names.forEach((name, p) => {
    html += `<div class="cname" data-p="${p}">${esc(name)}</div>`;
    for (const k of ks) {
      html += `<div class="cval" data-p="${p}" data-id="${k.id}">`
        + `<button class="cstep" data-d="-1" aria-label="${esc(k.name)} down for ${esc(name)}">&minus;</button>`
        + `<b></b>`
        + `<button class="cstep" data-d="1" aria-label="${esc(k.name)} up for ${esc(name)}">+</button></div>`;
    }
  });
  t.innerHTML = html;
}

function renderCounters() {
  const ks = countersOf(S);
  if (!ks.length) return;
  $('ctable').querySelectorAll('.cname').forEach((el) => {
    const p = Number(el.dataset.p);
    el.classList.toggle('turn', S.cfg.turns && p === S.cur);
    el.classList.toggle('out', isOut(p));
  });
  $('ctable').querySelectorAll('.cval').forEach((el) => {
    const p = Number(el.dataset.p), k = ks.find((x) => x.id === el.dataset.id);
    const v = counterOf(S, p, k);
    el.querySelector('b').textContent = fmt(v);
    el.classList.toggle('hit', counterReached(k, v));
    el.classList.toggle('mine', SCShare.canScore(p));
  });
}

$('ctable').addEventListener('click', (e) => {
  const b = e.target.closest('.cstep');
  if (!b) return;
  const cell = b.closest('.cval');
  bump(Number(cell.dataset.p), cell.dataset.id, Number(b.dataset.d));
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
      // live: straight onto the score of whoever is picked
      if (liveOn()) { liveAdd(S.cur, S.sign * k.v, k.label); return; }
      S.pend += S.sign * k.v;
      S.parts.push({ label: k.label, d: S.sign * k.v });
      save(); render();
    };
    pad.appendChild(b);
  }
  $('typedRow').classList.toggle('hidden', !S.cfg.typed);
  const rule = ruleOn();
  for (const id of ['quickpad', 'clearBtn']) $(id).classList.toggle('hidden', rule);
  // the + and − switch: not for a rule's pad, nor a game whose scores only
  // go one way (Farkle, Qwirkle); built after the board, so it decides here
  $('signRow').classList.toggle('hidden', rule || S.cfg.signs === false);
  if (rule) $('typedRow').classList.add('hidden');
  $('rulePad').classList.toggle('hidden', !rule);
  if (rule) buildRulePad();
}

/* ---------------- a rule's pad ----------------

   What happened this turn, for the rule to score: steppers for a bid and
   the tricks taken, a box for what the cards or the rack add up to, and
   switches for who ended the round or went out. Each change shows the
   score it makes above, before Enter. */
const stepper = (k, label) =>
  `<div class="rp-row"><span>${label}</span><div class="stepper" data-k="${k}"><button type="button" data-d="-1" aria-label="${label} one less">&minus;</button><output></output><button type="button" data-d="1" aria-label="${label} one more">+</button></div></div>`;
const numBox = (k, label, signed) =>
  `<div class="rp-row"><span>${label}</span><div class="rp-num">${signed ? '<button type="button" class="sgn" data-neg aria-label="Below zero">&minus;</button>' : ''}<input data-k="${k}" type="number" inputmode="numeric" min="0" aria-label="${label}"></div></div>`;
const segs = (k, opts) =>
  `<div class="rp-segs" data-k="${k}">${opts.map(([v, t]) => `<button type="button" class="seg" data-v="${v}">${t}</button>`).join('')}</div>`;

function buildRulePad() {
  const r = S.cfg.rule, pad = $('rulePad');
  if (!S.rin) freshRin();
  if (r === 'spades') pad.innerHTML = stepper('bid', 'Bid') + stepper('took', 'Took') +
    segs('nil', [['', 'No nil'], ['made', 'Nil made'], ['missed', 'Nil missed']]);
  else if (r === 'ohhell') pad.innerHTML = stepper('bid', 'Bid') + stepper('took', 'Took');
  else if (r === 'skyjo') pad.innerHTML = numBox('cards', 'Cards left add up to', true) +
    segs('ended', [['', 'Didn\'t end it'], ['1', 'Ended the round']]) + '<p class="rp-note" id="rpNote"></p>';
  else if (r === 'rummikub') pad.innerHTML = segs('out', [['', 'Still holding tiles'], ['1', 'Went out']]) +
    numBox('rack', 'Tiles left add up to', false) + '<p class="rp-note" id="rpNote"></p>';
}

// The round the pad is entering, and who else has already ended it or gone
// out in it: there is one of those a round.
function rulePadRound() {
  const p = entry ? entry.p : S.cur;
  return entry ? entry.r : turnsBySide()[p].length + 1;
}
function takenBy(flag) {
  const r = rulePadRound(), rounds = roundsOfLog();
  const i = S.log.findIndex((e, k) => rounds[k] === r && e.in && e.in[flag] && !(entry && entry.i === k));
  return i < 0 ? null : S.cfg.names[S.log[i].p];
}

function renderRulePad() {
  const pad = $('rulePad'), rin = S.rin;
  pad.querySelectorAll('.stepper').forEach((st) => { st.querySelector('output').textContent = rin[st.dataset.k]; });
  pad.querySelectorAll('input[data-k]').forEach((inp) => {
    const v = Math.abs(rin[inp.dataset.k]);
    if (document.activeElement !== inp) inp.value = v ? v : '';
    inp.placeholder = '0';
    inp.disabled = inp.dataset.k === 'rack' && !!rin.out;
  });
  const neg = pad.querySelector('[data-neg]');
  if (neg) neg.classList.toggle('is-on', cardsBelow);
  pad.querySelectorAll('.rp-segs').forEach((g) => {
    const k = g.dataset.k;
    g.querySelectorAll('.seg').forEach((b) => {
      const on = typeof rin[k] === 'boolean' ? rin[k] === !!b.dataset.v : rin[k] === b.dataset.v;
      b.classList.toggle('is-on', on);
    });
  });
  // one player ends the round, or goes out, each round
  const flag = S.cfg.rule === 'skyjo' ? 'ended' : S.cfg.rule === 'rummikub' ? 'out' : null;
  if (flag) {
    const who = takenBy(flag);
    const btn = pad.querySelector(`.rp-segs[data-k="${flag}"] [data-v="1"]`);
    btn.disabled = !!who && !rin[flag];
    $('rpNote').textContent = who ? `${who} ${flag === 'ended' ? 'ended' : 'went out in'} this round.`
      : flag === 'ended' ? 'Doubled when the round is in, unless theirs is the lowest.' : 'Takes the other racks when the round is in.';
  }
}

$('rulePad').addEventListener('click', (ev) => {
  const b = ev.target.closest('button');
  if (!b || !S || !ruleOn()) return;
  const rin = S.rin;
  const st = b.closest('.stepper');
  if (st) rin[st.dataset.k] = Math.min(20, Math.max(0, rin[st.dataset.k] + Number(b.dataset.d)));
  else if (b.hasAttribute('data-neg')) { cardsBelow = !cardsBelow; rin.cards = (cardsBelow ? -1 : 1) * Math.abs(rin.cards); }
  else {
    const g = b.closest('.rp-segs');
    if (!g) return;
    const k = g.dataset.k;
    rin[k] = typeof ruleBlank(S.cfg.rule)[k] === 'boolean' ? !!b.dataset.v : b.dataset.v;
    if (k === 'out' && rin.out) rin.rack = 0;
  }
  save(); render();
});
$('rulePad').addEventListener('input', (ev) => {
  const inp = ev.target.closest('input[data-k]');
  if (!inp || !S || !ruleOn()) return;
  const v = Math.min(999, Math.round(Math.abs(Number(inp.value) || 0)));
  S.rin[inp.dataset.k] = inp.dataset.k === 'cards' && cardsBelow ? -v : v;
  save(); render();
});

function render() {
  const c = S.cfg, n = c.names.length;
  if (ruleOn()) { if (!S.rin) freshRin(); ruleDraft(); renderRulePad(); }
  renderWinBar();

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
  $('pendFor').textContent = liveOn() ? `Buttons go to ${c.names[S.cur]}`
    : partsText(S.parts) || `for ${c.names[who]}`;
  // With nothing entered, a turn-based game scores 0 — a bust, a hole with
  // nothing on it — and play moves on. Without turns a 0 would change
  // nothing, so there is nothing to enter.
  const zero = S.pend === 0 && !ruleOn(), idle = zero && !c.turns;
  $('commitBtn').textContent = zero && c.turns
    ? `Score 0 for ${c.names[S.cur]}`
    : `Enter for ${c.names[S.cur]}`;
  let off = idle;
  // changing a score: what it goes from and to, once it is different
  if (entry && entry.i != null) {
    const was = S.log[entry.i].d;
    off = ruleOn() ? sameRule({ ...ruleBlank(c.rule), ...(S.log[entry.i].in || {}) }, S.rin) : S.pend === was;
    $('commitBtn').textContent = off ? 'No change yet' : `Change ${turnText(was)} → ${turnText(S.pend)}`;
  }
  $('commitBtn').disabled = off;
  $('commitBtn').style.opacity = off ? .5 : 1;

  // The last few things done, newest first: each score, and any change made
  // to one since, in its place among them. A score is tapped to change it.
  // Counter changes go in among them too, by when they were made.
  const rounds = roundsOfLog(), items = historyItems();
  const ks = countersOf(S);
  $('history').innerHTML = items.slice(-6).map(({ e, i, x, y }) => {
    if (y) {
      const k = ks.find((z) => z.id === y.id), diff = y.to - y.from;
      return `<div class="hcount"><span>${esc(c.names[y.p])}<em>${esc((k && k.name) || 'Counter')}</em></span><small>${fmt(y.from)} → ${fmt(y.to)}</small><b class="${diff < 0 ? 'neg' : ''}">${signed(diff)}</b></div>`;
    }
    if (x) {
      const diff = x.to - x.from;
      return `<div class="hedit"><span>${esc(c.names[x.p])}<em>${c.turns ? `round ${x.r} ` : ''}changed</em></span><small>${turnText(x.from)} → ${turnText(x.to)}</small><b class="${diff < 0 ? 'neg' : ''}">${signed(diff)}</b></div>`;
    }
    // an empty cell without turns keeps the score in its column
    const round = `<small>${c.turns ? `Round ${rounds[i]}` : ''}</small>`;
    const parts = partsText(e.parts);
    return `<div class="hturn" data-i="${i}"><span>${esc(c.names[e.p])}${parts ? `<em>${esc(parts)}</em>` : ''}</span>${round}<b class="${e.d < 0 ? 'neg' : ''}">${signed(e.d)}</b></div>`;
  }).reverse().join('');

  renderCounters();
  renderTiles();
  if (sheetOn()) renderSheet();
}

/* Everything done, oldest first: each score as { e, i }, and any change made
   to one since (x) or to a counter (y), in its place among them, by when. */
function historyItems() {
  const items = [];
  const since = (n) => [
    ...(S.edits || []).filter((x) => x.after === n).map((x) => ({ x, ts: x.ts || 0 })),
    ...(S.clog || []).filter((y) => y.after === n).map((y) => ({ y, ts: y.ts || 0 })),
  ].sort((a, b) => a.ts - b.ts);
  items.push(...since(0));
  S.log.forEach((e, i) => {
    items.push({ e, i });
    items.push(...since(i + 1));
  });
  return items;
}

/* The whole history for Edit's History (see /editgame.js), in the words of
   the last few shown under the scores. */
function historyRows() {
  const c = S.cfg, rounds = roundsOfLog(), ks = countersOf(S);
  return historyItems().map(({ e, i, x, y }) => {
    if (y) {
      const k = ks.find((z) => z.id === y.id), diff = y.to - y.from;
      return { who: c.names[y.p], what: (k && k.name) || 'Counter', when: `${fmt(y.from)} → ${fmt(y.to)}`, pts: signed(diff), neg: diff < 0 };
    }
    if (x) {
      const diff = x.to - x.from;
      return { who: c.names[x.p], what: `${c.turns ? `round ${x.r} ` : ''}changed`, when: `${turnText(x.from)} → ${turnText(x.to)}`, pts: signed(diff), neg: diff < 0 };
    }
    const edit = !SCShare.watching && SCShare.canScore(e.p) ? () => fixTurn(i) : null;
    return { who: c.names[e.p], what: partsText(e.parts), when: c.turns ? `round ${rounds[i]}` : '', pts: signed(e.d), neg: e.d < 0, edit };
  });
}

/* Changing a score from the history: the same bubble as tapping it on the
   sheet (see openEdit), pointing at it there, or at its player on the
   board. It asks before changing, keeps the change in the history, and
   leaves the turn where it is. */
function fixTurn(i) {
  const e = S.log[i];
  if (!e) return;
  const r = roundsOfLog()[i];
  const at = [
    sheetOn() && `#sheet button.cell[data-p="${e.p}"][data-r="${r}"]`,
    `#history [data-i="${i}"]`,
    `#scoreboard .player:nth-child(${e.p + 1})`,
    `#tiles .tile[data-p="${e.p}"]`,
  ].find((sel) => { const x = sel && document.querySelector(sel); return x && x.offsetParent; });
  if (at) document.querySelector(at).scrollIntoView({ block: 'nearest', inline: 'nearest' });
  openEdit(i, at || undefined);
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
  const e = { p, d, cur: S.cur, parts: S.parts || [], ts: Date.now() };
  if (ruleOn()) { e.in = { ...S.rin }; freshRin(); }
  S.log.push(e);
  if (ruleOn()) rescore(); else S.scores[p] += d;
  S.pend = 0;
  S.parts = [];
  S.sign = S.cfg.mode === 'down' ? -1 : 1;
  if (isOut(p)) flash(`${S.cfg.names[p]} is out`);
  if (S.cfg.turns) {
    S.cur = nextPlayer(p);
    if (skipSaid) flash(skipSaid);
  }
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
  if (liveOn()) { $('typedIn').value = ''; liveAdd(S.cur, S.sign * v); return; }
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
  if (ruleOn()) ruleDraft();
  commit(S.pend);
};

$('undoBtn').onclick = () => {
  liveRun = null;   // whatever is taken back, the next tap starts afresh
  if (!ruleOn() && (S.pend || (S.parts && S.parts.length))) { S.pend = 0; S.parts = []; save(); render(); return; }
  const seat = SCShare.seat();
  const x = S.edits && S.edits[S.edits.length - 1];
  const editNext = !!x && x.after === S.log.length && (seat === null || x.p === seat);
  // A counter change newer than the score Undo would otherwise take back
  // goes first. It is taken back by its own amount, so a change to the same
  // counter made since, on another phone, is kept.
  const ours = (e) => seat === null || e.p === seat;
  const cx = [...(S.clog || [])].reverse().find(ours);
  const scoreNext = editNext ? x : [...S.log].reverse().find(ours);
  if (cx && (cx.ts || 0) > ((scoreNext && scoreNext.ts) || 0)) {
    const k = countersOf(S).find((y) => y.id === cx.id);
    S.counts[cx.p] = { ...S.counts[cx.p], [cx.id]: counterOf(S, cx.p, k) - (cx.to - cx.from) };
    S.clog.splice(S.clog.lastIndexOf(cx), 1);
    if (S.cfg.turns && isOut(S.cur)) S.cur = nextPlayer(S.cur);
    settleEnd();
    if (S.endedAt && !result()) { S.endedAt = null; S.winnerIdx = null; }
    save(); render();
    flash(`Undid ${k.name} ${signed(cx.to - cx.from)} for ${S.cfg.names[cx.p]}`);
    return;
  }
  // the last thing done was changing a score: put it back as it was
  if (editNext) {
    const t = S.log[x.i];
    S.scores[t.p] += x.from - t.d;
    t.d = x.from;
    t.parts = x.fromParts;
    if (x.fromIn) { t.in = x.fromIn; rescore(); }
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
    S.clog = (S.clog || []).map((y) => ({ ...y, after: y.after > j ? y.after - 1 : y.after }));
    rescore();
    if (S.endedAt && !result()) { S.endedAt = null; S.winnerIdx = null; }
    save(); render();
    flash(`Undid ${S.cfg.names[mine.p]} ${signed(mine.d)}`);
    return;
  }
  const e = S.log.pop();
  if (!e) { flash('Nothing to undo'); return; }
  S.scores[e.p] -= e.d;
  S.cur = e.cur;
  rescore();
  // changes to that score go with it
  if (S.edits) S.edits = S.edits.filter((y) => y.i < S.log.length);
  if (S.clog) S.clog.forEach((y) => { y.after = Math.min(y.after, S.log.length); });
  // an undo that takes back the win, or a Finish, opens the game again
  if (S.endedAt && !result()) { S.endedAt = null; S.winnerIdx = null; }
  save(); render();
  flash(`Undid ${S.cfg.names[e.p]} ${signed(e.d)}`);
};

// A game that only keeps score never ends by itself, so Finish ends it: the
// standings go up, and a signed-in game is saved to the profile like any
// other. The highest score is credited as the winner, unless it is shared.
// A game with no ending of its own: Finish shows the final scores, or,
// for a game whose highest wins at the end (finishWins: Rummikub,
// Qwirkle), names the winner.
$('finishBtn').onclick = async () => {
  if (!S.log.length) { flash('Nothing scored yet'); return; }
  const wins = !!S.cfg.finishWins;
  if (!(await askConfirm(wins ? 'End the game here? The highest score wins.' : 'End the game here and show the final scores?', 'Finish'))) return;
  const top = best(Math.max);
  showWin({ ...top, final: !wins });
};

/* ---------------- editing the game ----------------

   Players, or in a game of teams the sides, can be put in another order and
   renamed once the game has started (see /editgame.js). Everything kept by
   a side's place moves with it: its score and counters, every entry and
   change in the history, the edits to past scores, whose turn it is, the
   winner and who You are; in a game of teams, which side each player is on
   too, so a rematch keeps the new order. The turn stays with whoever had
   it and passes on in the new order. A shared game stays as it is, as the
   other phones know the players by their place. */

async function editGame() {
  const c = S.cfg;
  const locked = SCStore.get(S.id)?.share
    ? `This game is shared with other phones, which know the ${c.members ? 'teams' : 'players'} by their place, so they can’t be moved or renamed now.`
    : null;
  // who a new order would pass over for the rest of this round (see nextPlayer)
  const warn = (order, names) => {
    if (!c.turns || S.endedAt || result()) return null;
    const { list, place } = SCEditGame.moves(order);
    const out = list(c.names.map((_, i) => isOut(i)));
    return SCEditGame.skipWarning({ names, counts: list(turnCounts()), cur: place(S.cur), playing: (i) => !out[i] });
  };
  const got = await SCEditGame.open({ names: c.names, locked, hint: c.turns ? 'Whoever’s turn it is keeps it.' : null, warn, history: historyRows });
  if (!got) return;
  const moved = got.order.some((from, i) => from !== i);
  if (!moved && got.names.every((n, i) => n === c.names[i])) return;
  const { list, place } = SCEditGame.moves(got.order);
  closeEntry();
  c.names = got.names;
  if (c.members) {
    c.members = list(c.members);
    if (c.playerTeams) c.playerTeams = c.playerTeams.map(place);
    if (Array.isArray(c.teamOf)) c.teamOf = c.teamOf.map(place);
  } else if (c.playerNames) {
    c.playerNames = got.names;
  }
  S.scores = list(S.scores);
  S.counts = list(S.counts);
  for (const e of S.log) { e.p = place(e.p); e.cur = place(e.cur); }
  for (const e of S.clog || []) e.p = place(e.p);
  for (const e of S.edits || []) e.p = place(e.p);
  S.cur = place(S.cur);
  if (S.winnerIdx != null) S.winnerIdx = place(S.winnerIdx);
  S.me = place(S.me);
  S.series = SCSeries.move(S.series, place);
  save();
  showGame();
  flash(moved && c.turns ? `${c.names[S.cur]}'s turn` : 'Players changed');
}
$('editBtn').onclick = editGame;

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
  applyLayout();
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
    // open to score here: on a phone that joined by seat, only its own player's
    const open = here && t[p].length === r - 1 && SCShare.canScore(p);
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
  if (!mayScore(p)) return;
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
  if (ruleOn()) freshRin();
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
  if (ruleOn()) { S.rin = { ...ruleBlank(S.cfg.rule), ...(e.in || {}) }; cardsBelow = S.rin.cards < 0; }
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
  if (ruleOn()) ruleDraft();
  const from = e.d, to = S.pend, name = S.cfg.names[e.p];
  const fromIn = e.in ? { ...e.in } : null;
  if (ruleOn() ? sameRule(fromIn, S.rin) : from === to) return;
  const where = S.cfg.turns ? ` in round ${r}` : '';
  if (!(await askConfirm(`Change ${name}'s score${where} from ${turnText(from)} to ${turnText(to)}?`, 'Change'))) return;
  if (!S.edits) S.edits = [];
  S.edits.push({ i, p: e.p, r, from, to, fromParts: e.parts || [], ...(fromIn ? { fromIn } : {}), after: S.log.length, ts: Date.now() });
  e.d = to;
  e.parts = S.parts;
  S.scores[e.p] += to - from;
  if (ruleOn()) { e.in = { ...S.rin }; freshRin(); rescore(); }
  S.pend = 0; S.parts = [];
  settleEnd();
  save();
  closeEntry();
  render();
  flash(`${name}${where}: ${turnText(from)} → ${turnText(to)}`);
  // the change decided the game
  const res = result();
  if (res && !S.endedAt) decide(res);
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
  // live, a score is changed by tapping it again, and Undo takes one back
  if (liveOn()) return;
  if (row && S.log[row.dataset.i] && mayScore(S.log[row.dataset.i].p)) openEdit(Number(row.dataset.i), `#history [data-i="${row.dataset.i}"]`);
});

// Back to the page, and anything half-entered with it is let go.
function closeEntry() {
  if (!entry) return;
  entry = null;
  $('entryOverlay').classList.add('hidden');
  $('game').insertBefore($('entry'), document.querySelector('#game .actions'));
  if (S && ruleOn()) { freshRin(); S.pend = 0; S.parts = []; save(); render(); return; }
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

// how a result is said, on the win screen and the bar that offers it
function winText(r) {
  const c = S.cfg;
  return r.final ? 'Final scores' :
    r.solo ? `${c.names[0]} is out` :
    r.winners.length === 0 ? 'Nobody left standing' :
    r.winners.length === 1 ? `${c.names[r.winners[0]]} wins!` :
    `Tie: ${r.winners.map(i => c.names[i]).join(' & ')}`;
}

/* A game has reached its end. Taken in turns, that is the end: the round
   has been played out (see result). Live, a hand is often scored in several
   taps, and the one that crosses the line may not be the last of them — so
   the win is offered, not declared: the bar under the scores says who has
   won, scoring and Undo go on, and End game shows the result. The bar
   follows the scores (see renderWinBar), so an Undo back below the line
   takes it away. */
function decide(r) {
  if (!r || S.endedAt) return;
  if (liveOn()) { renderWinBar(); return; }
  showWin(r);
}

// The bar stays while the scores say someone has won, ended or not: after
// End game and back to the scores, its button opens the result again.
function renderWinBar() {
  const r = S && liveOn() ? result() : null;
  $('winBar').classList.toggle('hidden', !r);
  if (!r) return;
  const over = !!S.endedAt;
  $('winBarText').innerHTML = `${esc(winText(r))}<small>${over
    ? 'The game is over. Undo takes it back.'
    : "Keep scoring, or Undo, if that wasn't the end."}</small>`;
  $('winBarBtn').textContent = over ? 'See results' : 'End game';
}
$('winBarBtn').onclick = () => {
  const r = result();
  if (r) showWin(r); else renderWinBar();
};

function showWin(r) {
  const c = S.cfg;
  $('winName').textContent = winText(r);

  // Standings in finishing order: lowest first when low wins, else highest.
  // Whoever won comes first, as a counter can win from behind on points,
  // and anyone out comes last.
  const won = (i) => (r.winners || []).includes(i) ? 0 : 1;
  const order = c.names.map((_, i) => i)
    .sort((a, b) => won(a) - won(b) || Number(isOut(a)) - Number(isOut(b))
      || (c.win === 'low' ? S.scores[a] - S.scores[b] : S.scores[b] - S.scores[a]));
  $('winTable').innerHTML = order.map(i =>
    `<li><span>${esc(c.names[i])}</span><b>${fmt(S.scores[i])}</b></li>`).join('');
  $('winBy').textContent = r.by ? `${r.by.name} reached ${fmt(r.by.at)}` : '';
  $('winTable').classList.toggle('hidden', c.names.length === 1);
  $('winOverlay').classList.remove('hidden');
  // the game is over: kept on it, so every save from here says so
  if (!S.endedAt) S.endedAt = Date.now();
  S.winnerIdx = r.winners && r.winners.length === 1 ? r.winners[0] : null;
  SCSeries.show($('winSeries'), c.names, S.series && SCSeries.add(S.series, S.winnerIdx));
  SCStore.put(TYPE, S, true);
  saveToProfile(r);
}

$('rematchBtn').onclick = () => {
  const { quickVals, quickKeys, members, ...c } = S.cfg;
  // a game in teams is rebuilt from its players, not from the team names
  if (c.playerNames) { c.names = c.playerNames; c.teamOf = c.playerTeams || []; }
  SCStore.remove(S.id);      // finished, and on the profile when signed in
  // the series goes on: this game's winner with the ones before (see
  // /series.js); in a game of teams, the side, as the sides stay as they were
  const series = SCSeries.add(S.series, S.winnerIdx);
  S = newGame(c);
  if (S.cfg.names.length > 1) S.series = series;
  save();
  SCStore.show(S.id);
  $('winOverlay').classList.add('hidden');
  render();
  const said = SCSeries.next(S.cfg.names, S.series);
  if (said) flash(said);
};
$('keepBtn').onclick = () => { $('winOverlay').classList.add('hidden'); renderWinBar(); };
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
  me: (st) => st.me,
  /* A newer game from another phone. Whatever this phone is in the middle
     of carries over: the points tapped so far, and an open bubble, which
     stays open and points at its cell wherever it now is. Only when that
     very score has come in from elsewhere does the bubble close, saying so. */
  apply: (st) => {
    liveRun = null;   // the log may have been put in a new order
    const mid = { pend: S.pend, parts: S.parts, sign: S.sign, cur: S.cur };
    const busy = !!entry || S.pend !== 0 || !!(S.parts && S.parts.length);
    const editing = entry && entry.i != null ? { p: entry.p, r: entry.r } : null;
    S = st;
    if (busy) Object.assign(S, mid);
    settleEnd();
    if (editing) {
      // the score being changed, wherever the log now has it
      const rounds = roundsOfLog();
      const i = S.log.findIndex((e, k) => e.p === editing.p && rounds[k] === editing.r);
      if (i < 0) { closeEntry(); flash('That score was taken back on another phone'); }
      else {
        entry.i = i;
        if (entry.sel && entry.sel.startsWith('#history')) entry.sel = `#history [data-i="${i}"]`;
      }
    } else if (entry && turnsBySide()[entry.p].length >= entry.r) {
      closeEntry();
      flash(`${S.cfg.names[entry.p]}'s round ${entry.r} just came in from another phone`);
    }
    save();
    if (entry) { render(); placeEntry(); } else if (busy) render(); else showGame();
    // the score that came in decided the game
    const r = result();
    if (r && !S.endedAt) decide(r);
  },
  // Shared by seat: a cell a score, '<player>:<round>', and a cell a
  // counter, '<player>:c_<id>', holding its value as it stands. Every
  // counter has its cell from the start, so a counter put back where it
  // began still says so.
  cells: {
    names: (st) => st.cfg.names,
    of: (st) => {
      const out = {}, seen = [];
      for (const e of st.log) {
        const r = (seen[e.p] = (seen[e.p] || 0) + 1);
        out[`${e.p}:${r}`] = { d: e.d, parts: e.parts || [], ...(e.in ? { in: e.in } : {}), ...(e.ts ? { ts: e.ts } : {}) };
      }
      st.cfg.names.forEach((_, p) => {
        for (const k of countersOf(st)) out[`${p}:c_${k.id}`] = { v: counterOf(st, p, k) };
      });
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

  // the counters start where they start; a cell says where one is now
  const ks = countersOf(base);
  const counts = c.names.map(() => Object.fromEntries(ks.map((k) => [k.id, k.start])));

  const log = [];
  list.forEach(({ key, value }, k) => {
    const [ps, rs] = key.split(':'), p = Number(ps);
    if (!(p >= 0 && p < n) || !value) return;
    if (rs.startsWith('c_')) {
      const id = rs.slice(2);
      if (ks.some((x) => x.id === id) && Number.isInteger(value.v)) counts[p][id] = value.v;
      return;
    }
    const r = Number(rs);
    if (r >= 1) log.push({ p, r, k, d: Number(value.d) || 0, parts: value.parts || [], ts: Number(value.ts) || 0,
      ...(value.in && typeof value.in === 'object' ? { in: value.in } : {}) });
  });
  log.sort((a, b) => a.r - b.r || a.k - b.k);
  // A rule's scores come from what happened, worked out here as on every
  // phone: a cell's own score may be from before the rest of its round.
  if (ruleOf(c)) ruleScores(c, log, n).forEach((x, i) => { log[i].d = x.d; log[i].parts = x.parts; });

  const scores = c.names.map(() => c.start);
  for (const e of log) scores[e.p] += e.d;
  const at = (p, r) => log.findIndex((e) => e.p === p && e.r === r);

  // changes already known here keep their place; new ones from elsewhere join them
  const edits = (base.edits || []).map((x) => ({ ...x, i: at(x.p, x.r) })).filter((x) => x.i >= 0);
  log.forEach((e, i) => {
    const was = before[`${e.p}:${e.r}`];
    // with a rule, a change is to what happened: a score moved by the rest
    // of its round coming in is no change to it
    const moved = ruleOf(c) ? was && !sameRule(was.in || null, e.in || null) : was && was.d !== e.d;
    if (moved) edits.push({ i, p: e.p, r: e.r, from: was.d, to: e.d, fromParts: was.parts || [], ...(was.in ? { fromIn: was.in } : {}), after: log.length, ts: Date.now() });
  });

  // A counter that moved elsewhere goes in the history as a change, as one
  // made here would. Ones made here are already in it, and already in the
  // cells, so they don't come back as new.
  const clog = (base.clog || []).map((y) => ({ ...y, after: Math.min(y.after, log.length) }));
  c.names.forEach((_, p) => {
    for (const k of ks) {
      const was = counterOf(base, p, k), is = counts[p][k.id];
      if (was !== is) clog.push({ p, id: k.id, from: was, to: is, after: log.length, ts: Date.now(), remote: true });
    }
  });

  const st = {
    ...base,
    log: log.map(({ p, d, parts, ts, in: inp }) => ({ p, d, parts, cur: p, ...(inp ? { in: inp } : {}), ...(ts ? { ts } : {}) })),
    scores, counts, clog, edits, pend: 0, parts: [],
  };

  // whose turn: the first still in the game without a score this round
  if (c.turns) {
    const turns = c.names.map((_, p) => log.filter((e) => e.p === p).length);
    const live = turns.map((_, p) => p).filter((p) => !outOf(st, p));
    const round = live.length ? Math.min(...live.map((p) => turns[p])) : 0;
    const next = live.find((p) => turns[p] === round);
    if (next !== undefined) st.cur = next;
  }
  return st;
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
