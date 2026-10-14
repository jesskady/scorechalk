/* Score Chalk — tournaments: a round robin, run from one phone.

   A tournament is a list of players and the matches between them, each
   match an ordinary game of its own. Playing a match opens that game's page
   with the players and the tournament's rules filled in, and an id chosen
   here; the game is kept in the store under that id like any other. Results
   are read back from the store — the game page never writes to the
   tournament — so a match undone on its own page is undone here too.

   A result read is also copied onto the match (winner, and the figures the
   tiebreak needs), as a finished game is let go from the store after a few
   days and a tournament can run longer than that. While its game is still
   in the store, the game is what counts.

   State, kept with SCStore.put('tournament', T):
     { id, name, game, opts, players: [names],
       matches: [{ round, a, b, game, winner, stats }],   a, b, winner: player indexes
       createdAt, over }
   Standings are never stored: they are worked out from the matches. */

const TYPE = 'tournament';
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uuid = () => (crypto.randomUUID ? crypto.randomUUID()
  : 't' + Date.now().toString(36) + Math.random().toString(36).slice(2));

const MIN_PLAYERS = 3;
const MAX_PLAYERS = 10;

/* ---------------- the games a tournament can be of ----------------

   Each says how to start a match, and how to read one:
     room            the room the tournament is played in
     opts()          its options, from the setup screen
     summary(opts)   the options in a few words
     url(T, m, id)   the page that starts the match as game `id`
     result(state)   { winner: 0 | 1, stats } once over, else null; 0 is the
                     match's first player (a), 1 its second (b)
     tiebreak        { label, of(stats for one player, across matches) }
   Adding a game is an entry here, and the game page taking its match from
   the address as darts does (see fromTourney in /darts/app.js). */

const GAMES = {
  darts: {
    name: 'Darts',
    room: 'parlor',
    opts: () => ({
      start: parseInt(document.querySelector('#presets .is-on').dataset.score, 10),
      doubleIn: $('doubleIn').classList.contains('is-on'),
      doubleOut: $('doubleOut').classList.contains('is-on'),
    }),
    summary: (o) => [o.start, o.doubleIn && 'double in', o.doubleOut && 'double out'].filter(Boolean).join(' · '),
    url: (T, m, id) => '/darts/?' + new URLSearchParams({
      new: id, t: T.id, tn: T.name, a: T.players[m.a], b: T.players[m.b],
      start: T.opts.start, din: T.opts.doubleIn ? 1 : 0, dout: T.opts.doubleOut ? 1 : 0,
    }),
    result: (st) => (st.over && st.winner != null
      ? { winner: st.winner, stats: st.players.map((p) => ({ points: p.points, turns: p.turns })) }
      : null),
    // three-dart average over every match played
    tiebreak: {
      label: 'Avg',
      of: (list) => {
        const pts = list.reduce((s, x) => s + x.points, 0);
        const turns = list.reduce((s, x) => s + x.turns, 0);
        return turns ? pts / turns : 0;
      },
      show: (v) => v.toFixed(1),
    },
  },
};

/* ---------------- the draw ----------------

   The circle method: one player stays put and the rest turn round them, so
   every pair meets exactly once in n - 1 rounds. With an odd number a
   stand-in makes it even, and whoever draws the stand-in sits that round
   out. Who is player one alternates, so nobody throws first every time.

   The format then shapes it:
     meet    1 everyone once, 2 everyone twice — the second time round with
             the other player first
     short   play only the first so many of those rounds; everyone meets
             that many others (one fewer, for whoever sat a round out)
     boards  how many matches can be played at once. Fewer boards than a
             full round needs: the matches are dealt, in order, into rounds
             of that many, taking next whichever match has nobody already
             playing in that round. */

const maxBoards = (n) => Math.floor(n / 2);
const fullRounds = (n) => (n % 2 ? n : n - 1);

function draw(n, format = {}) {
  const { meet = 1, short = null } = format;
  const boards = Math.min(format.boards || maxBoards(n), maxBoards(n));
  const ids = [...Array(n).keys()];
  if (n % 2) ids.push(null);
  const m = ids.length;
  let rounds = [];
  for (let r = 0; r < m - 1; r++) {
    const pairs = [];
    for (let i = 0; i < m / 2; i++) {
      let a = ids[i], b = ids[m - 1 - i];
      if (a === null || b === null) continue;
      if ((r + i) % 2) [a, b] = [b, a];
      pairs.push([a, b]);
    }
    rounds.push(pairs);
    ids.splice(1, 0, ids.pop());    // turn everyone but the first round one place
  }
  if (meet === 1 && short) rounds = rounds.slice(0, short);
  if (meet === 2) rounds = rounds.concat(rounds.map((ps) => ps.map(([a, b]) => [b, a])));

  if (boards < maxBoards(n)) {
    const queue = rounds.flat();
    rounds = [];
    while (queue.length) {
      const round = [], busy = new Set();
      for (let k = 0; k < queue.length && round.length < boards;) {
        const [a, b] = queue[k];
        if (busy.has(a) || busy.has(b)) { k++; continue; }
        round.push(queue.splice(k, 1)[0]);
        busy.add(a); busy.add(b);
      }
      rounds.push(round);
    }
  }
  return rounds.flatMap((ps, r) => ps.map(([a, b]) => ({ round: r + 1, a, b, game: null, winner: null, stats: null })));
}

// The format in a few words, for the setup and the tournament's own line.
function describe(n, format) {
  const ms = draw(n, format);
  const rounds = new Set(ms.map((m) => m.round)).size;
  const each = [...Array(n).keys()].map((i) => ms.filter((m) => m.a === i || m.b === i).length);
  const lo = Math.min(...each), hi = Math.max(...each);
  const perRound = Math.max(...[...Array(rounds).keys()].map((r) => ms.filter((m) => m.round === r + 1).length));
  return {
    matches: ms.length, rounds, perRound, lo, hi,
    each: lo === hi ? `${lo} each` : `${lo}–${hi} each`,
  };
}

/* ---------------- state ---------------- */

let T = null;

function save() {
  if (T) SCStore.put(TYPE, T, !!T.over);
}

/* Each match as it stands: its game read from the store, when it's there.
   A result is copied onto the match; a game reopened by an undo clears the
   copy, as the game is what counts. */
function refresh() {
  if (!T) return;
  const G = GAMES[T.game];
  let changed = false;
  for (const m of T.matches) {
    m.live = false;
    if (!m.game) continue;
    const g = SCStore.get(m.game);
    if (!g) continue;                    // not started yet, given up, or long finished
    const r = G.result(g.state);
    if (r) {
      const winner = r.winner === 0 ? m.a : m.b;
      if (m.winner !== winner) { m.winner = winner; changed = true; }
      m.stats = r.stats;
    } else {
      m.live = true;
      if (m.winner != null) { m.winner = null; m.stats = null; changed = true; }
    }
  }
  const over = T.matches.every((m) => m.winner != null);
  if (over !== !!T.over) { T.over = over; changed = true; }
  // a match's stats change while it is played; a save keeps the copy current
  save();
  return changed;
}

/* The table: won, then between two level on wins the one who won more of
   their meetings, then the game's own tiebreak. (Three or more level on
   wins have no head to head to settle it, and go by the tiebreak.)

   A short format with an odd number of players gives some one match more
   than others; there, "won" is the share of their own matches won, so an
   extra match is no head start. Everyone with the same number of matches,
   it orders exactly as the count of wins. */
function standings() {
  const G = GAMES[T.game];
  const rows = T.players.map((name, i) => ({ i, name, p: 0, w: 0, l: 0, stats: [],
    of: T.matches.filter((m) => m.a === i || m.b === i).length }));
  for (const m of T.matches) {
    if (m.winner == null) continue;
    const [A, B] = [rows[m.a], rows[m.b]];
    A.p++; B.p++;
    (m.winner === m.a ? A : B).w++;
    (m.winner === m.a ? B : A).l++;
    if (m.stats) { A.stats.push(m.stats[0]); B.stats.push(m.stats[1]); }
  }
  rows.forEach((r) => { r.tb = G.tiebreak.of(r.stats); r.share = r.of ? r.w / r.of : 0; });
  const level = (x) => rows.filter((r) => r.share === x.share).length;
  const beat = (x, y) => T.matches.filter((m) => m.winner === x.i && (m.a === y.i || m.b === y.i)).length;
  rows.sort((x, y) => (y.share - x.share)
    || (level(x) === 2 ? beat(y, x) - beat(x, y) : 0)
    || (y.tb - x.tb));
  return rows;
}

/* ---------------- setup ---------------- */

let names = [];

function buildSetup() {
  $('tGame').innerHTML = Object.entries(GAMES)
    .map(([k, g]) => `<option value="${k}">${esc(g.name)}</option>`).join('');

  const presets = document.querySelectorAll('#presets .preset');
  presets.forEach((btn) => btn.addEventListener('click', () => {
    presets.forEach((b) => b.classList.toggle('is-on', b === btn));
  }));
  ['doubleIn', 'doubleOut'].forEach((id) => $(id).addEventListener('click', () => {
    const on = !$(id).classList.contains('is-on');
    $(id).classList.toggle('is-on', on);
    $(id).setAttribute('aria-checked', String(on));
  }));

  $('addForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const n = $('addName').value.trim();
    if (!n) return;
    if (names.length >= MAX_PLAYERS) { $('playersNote').textContent = `Up to ${MAX_PLAYERS} players`; return; }
    if (names.some((x) => x.toLowerCase() === n.toLowerCase())) { $('playersNote').textContent = `${n} is in already`; return; }
    names.push(n);
    $('addName').value = '';
    $('addName').focus();
    renderNames();
  });

  document.querySelectorAll('#stages .stage').forEach((b) => b.addEventListener('click', () => showStep(b.dataset.step)));
  $('nextBtn').addEventListener('click', () => showStep(STEPS[STEPS.indexOf(step) + 1]));

  document.querySelectorAll('#meetRow .seg').forEach((btn) => btn.addEventListener('click', () => {
    kind = btn.dataset.f;
    renderNames();
  }));
  $('shortLess').addEventListener('click', () => { short--; shortSet = true; renderNames(); });
  $('shortMore').addEventListener('click', () => { short++; shortSet = true; renderNames(); });

  $('startBtn').addEventListener('click', () => {
    if (names.length < MIN_PLAYERS) return;
    const game = $('tGame').value;
    start({
      name: $('tName').value.trim() || `${GAMES[game].name} tournament`,
      game, opts: GAMES[game].opts(), players: names.slice(), format: format(),
    });
  });

  // tournaments still going, newest first
  for (const g of SCStore.list(TYPE).filter((g) => !g.done)) {
    const btn = document.createElement('button');
    btn.className = 'ghost';
    btn.textContent = `Resume: ${g.state.name}`;
    btn.addEventListener('click', () => open(g.state));
    $('resumeList').appendChild(btn);
  }

  renderNames();
  showStep('game');
}

/* The setup's three steps. Each is a screen of its own; the tabs reach any
   of them, and the button at the foot is Next until the last, which starts. */
const STEPS = ['game', 'players', 'format'];
const STEP_NAMES = { game: 'Game', players: 'Players', format: 'Format' };
let step = 'game';

function showStep(s) {
  step = s;
  document.querySelectorAll('#stages .stage').forEach((b) => b.classList.toggle('is-on', b.dataset.step === s));
  document.querySelectorAll('#setup .step').forEach((el) => el.classList.toggle('hidden', el.dataset.step !== s));
  const last = s === STEPS[STEPS.length - 1];
  $('nextBtn').classList.toggle('hidden', last);
  $('startBtn').classList.toggle('hidden', !last);
  if (!last) $('nextBtn').textContent = `Next: ${STEP_NAMES[STEPS[STEPS.indexOf(s) + 1]]}`;
  // the resumes belong to the first screen, where a setup begins
  $('resumeList').classList.toggle('hidden', s !== 'game');
  if (s === 'players') $('addName').focus();
  window.scrollTo(0, 0);
}

// The players, numbered as they will be listed, the next number waiting.
function renderNames() {
  $('players').innerHTML = names.map((n, i) =>
    `<li><i>${i + 1}.</i><span>${esc(n)}</span><button type="button" data-i="${i}" aria-label="Remove ${esc(n)}">×</button></li>`).join('');
  $('players').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
    names.splice(+b.dataset.i, 1);
    renderNames();
  }));
  const n = names.length;
  $('addNum').textContent = `${n + 1}.`;
  $('addForm').classList.toggle('hidden', n >= MAX_PLAYERS);
  $('playersTab').textContent = n ? String(n) : '';
  $('playersNote').textContent = n >= MAX_PLAYERS ? `${MAX_PLAYERS} players, the most a tournament takes`
    : n < MIN_PLAYERS ? `At least ${MIN_PLAYERS} players` : '';
  renderFormat();
}

/* The format, as chosen. Short counts rounds of the full draw, each a
   match for everyone (or a round sat out), so it reads as matches each.
   Boards default to as many as a round can use; fewer than that, the
   choice is kept as the players change, until it is more than they need. */
let kind = 'once', short = null, shortSet = false, boards = null;

const format = () => ({
  meet: kind === 'twice' ? 2 : 1,
  short: kind === 'short' ? short : null,
  boards: boards && boards < maxBoards(names.length) ? boards : null,
});

function renderFormat() {
  const n = names.length;
  const full = fullRounds(Math.max(n, MIN_PLAYERS));
  // half the full draw, until stepped; then as stepped, within what fits
  short = Math.max(1, Math.min(shortSet ? short : Math.ceil(full / 2), full - 1));

  document.querySelectorAll('#meetRow .seg').forEach((b) => b.classList.toggle('is-on', b.dataset.f === kind));
  $('shortRow').classList.toggle('hidden', kind !== 'short');
  $('shortN').textContent = short;
  $('shortLess').disabled = short <= 1;
  $('shortMore').disabled = short >= full - 1;

  const most = Math.max(1, maxBoards(n));
  const on = boards && boards < most ? boards : most;
  $('boardRow').innerHTML = [...Array(most).keys()].map((k) =>
    `<button class="seg ${k + 1 === on ? 'is-on' : ''}" type="button" data-b="${k + 1}">${k + 1}</button>`).join('');
  $('boardRow').querySelectorAll('.seg').forEach((b) => b.addEventListener('click', () => {
    boards = +b.dataset.b;
    renderFormat();
  }));

  if (n < MIN_PLAYERS) {
    $('count').textContent = `At least ${MIN_PLAYERS} players`;
    $('startBtn').disabled = true;
    return;
  }
  const d = describe(n, format());
  $('count').textContent = `${d.matches} matches · ${d.each} · `
    + (d.perRound === 1 ? `one at a time` : `${d.rounds} rounds of ${d.perRound}`);
  $('startBtn').disabled = false;
}

// The format in words, for under the tournament's name.
function formatLine(f = {}) {
  if (f.meet === 2) return 'everyone twice';
  if (f.short) return `short, ${f.short} each`;
  return 'everyone once';
}

/* A new tournament. The players are shuffled, so the draw — who meets whom
   when — isn't just the order they were typed in. */
function start({ name, game, opts, players, format = {} }) {
  const p = players.slice();
  for (let i = p.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [p[i], p[j]] = [p[j], p[i]];
  }
  open({ id: uuid(), name, game, opts, format, players: p, matches: draw(p.length, format), createdAt: Date.now(), over: false });
}

function open(state) {
  T = state;
  refresh();
  SCStore.show(T.id);
  document.body.dataset.room = GAMES[T.game].room;
  $('setup').classList.add('hidden');
  $('main').classList.remove('hidden');
  render();
}

/* ---------------- the tournament ---------------- */

function render() {
  const G = GAMES[T.game];
  const done = T.matches.filter((m) => m.winner != null).length;
  $('tTitle').textContent = T.name;
  $('tSub').textContent = `${G.name} · ${G.summary(T.opts)} · ${formatLine(T.format)} · ${done} of ${T.matches.length} played`;

  const rows = standings();
  $('tbHead').textContent = G.tiebreak.label;
  $('standings').innerHTML = rows.map((r, k) => `<tr class="${T.over && k === 0 ? 'lead' : ''}">
      <td class="pos">${k + 1}</td><td class="pl">${esc(r.name)}</td>
      <td>${r.p}</td><td><b>${r.w}</b></td><td>${r.l}</td>
      <td class="tb">${r.stats.length ? G.tiebreak.show(r.tb) : '–'}</td></tr>`).join('');

  // the champion: whoever tops the table, or all level at the top
  $('champ').classList.toggle('hidden', !T.over);
  $('rematchBtn').classList.toggle('hidden', !T.over);
  if (T.over) {
    const top = rows.filter((r) => r.share === rows[0].share && r.tb === rows[0].tb);
    $('champName').textContent = top.length > 1
      ? `${top.map((r) => r.name).join(' & ')} share it`
      : `${rows[0].name} wins!`;
    $('champLine').textContent = `${rows[0].w} of ${rows[0].p} matches won`;
  }

  // rounds in order; the first with a match to play is the one on now
  const rounds = [...new Set(T.matches.map((m) => m.round))];
  const now = rounds.find((r) => T.matches.some((m) => m.round === r && m.winner == null));
  $('rounds').innerHTML = rounds.map((r) => {
    const ms = T.matches.map((m, i) => ({ m, i })).filter(({ m }) => m.round === r);
    const playing = new Set(ms.flatMap(({ m }) => [m.a, m.b]));
    // who sits out, when it's one; with fewer boards than players, most wait
    const out = T.players.map((_, i) => i).filter((i) => !playing.has(i));
    return `<div class="round ${r === now ? 'now' : ''} ${ms.every(({ m }) => m.winner != null) ? 'done' : ''}">
      <h3>Round ${r}${out.length === 1 ? `<small>${esc(T.players[out[0]])} sits out</small>` : ''}</h3>
      ${ms.map(({ m, i }) => matchRow(m, i)).join('')}
    </div>`;
  }).join('');
  $('rounds').querySelectorAll('.match').forEach((el) =>
    el.addEventListener('click', () => openMatch(+el.dataset.i)));
}

function matchRow(m, i) {
  const name = (p) => `<span class="${m.winner === p ? 'won' : m.winner != null ? 'lost' : ''}">${esc(T.players[p])}</span>`;
  const state = m.winner != null ? `<em class="st done">✓ ${esc(T.players[m.winner])}</em>`
    : m.live ? '<em class="st live">in progress</em>'
    : '<em class="st play">Play ›</em>';
  return `<button class="match" data-i="${i}">${name(m.a)}<i>v</i>${name(m.b)}${state}</button>`;
}

/* ---------------- a match ---------------- */

let matchAt = null;

function openMatch(i) {
  const m = T.matches[i];
  matchAt = i;
  const [A, B] = [T.players[m.a], T.players[m.b]];
  $('mTitle').textContent = `${A} v ${B}`;
  $('mText').textContent = m.winner != null ? `${T.players[m.winner]} won.`
    : m.live ? 'Being played.' : `Round ${m.round}. ${A} goes first.`;
  $('mPlay').textContent = m.winner != null ? (m.game && SCStore.get(m.game) ? 'Open the game' : 'Play it again')
    : m.live ? 'Carry on' : 'Play';
  $('mWinA').textContent = A;
  $('mWinB').textContent = B;
  $('mWinA').classList.toggle('is-on', m.winner === m.a);
  $('mWinB').classList.toggle('is-on', m.winner === m.b);
  $('mClear').classList.toggle('hidden', m.winner == null);
  $('matchOverlay').classList.remove('hidden');
}

const closeMatch = () => { $('matchOverlay').classList.add('hidden'); matchAt = null; };

// Its game, kept by the id this match gave it; or a new one under a new id.
function play() {
  const m = T.matches[matchAt];
  const g = m.game && SCStore.get(m.game);
  if (g && (m.winner == null || GAMES[T.game].result(g.state))) {
    location.href = `/${g.type}/?g=${encodeURIComponent(m.game)}`;
    return;
  }
  m.game = uuid();
  m.winner = null; m.stats = null;
  save();
  location.href = GAMES[T.game].url(T, m, m.game);
}

/* A result set by hand lets go of the match's game, if it had one — the
   game stays on the device as an ordinary game, but no longer decides the
   match. */
function setWinner(p) {
  const m = T.matches[matchAt];
  m.game = null;
  m.stats = null;
  m.winner = p;
  closeMatch();
  refresh();
  render();
}

/* ---------------- confirmation ---------------- */

let confirmResolve = null;
function askConfirm(text, yes) {
  $('confirmText').textContent = text;
  $('confirmYes').textContent = yes;
  $('confirmOverlay').classList.remove('hidden');
  return new Promise((r) => { confirmResolve = r; });
}
function closeConfirm(answer) {
  $('confirmOverlay').classList.add('hidden');
  const r = confirmResolve; confirmResolve = null;
  if (r) r(answer);
}

/* ---------------- boot ---------------- */

function wire() {
  $('mPlay').addEventListener('click', play);
  $('mWinA').addEventListener('click', () => setWinner(T.matches[matchAt].a));
  $('mWinB').addEventListener('click', () => setWinner(T.matches[matchAt].b));
  $('mClear').addEventListener('click', () => setWinner(null));
  $('mCancel').addEventListener('click', closeMatch);
  $('matchOverlay').addEventListener('click', (e) => { if (e.target === $('matchOverlay')) closeMatch(); });

  $('confirmYes').addEventListener('click', () => closeConfirm(true));
  $('confirmNo').addEventListener('click', () => closeConfirm(false));

  $('newBtn').addEventListener('click', () => { location.href = location.pathname; });
  $('rematchBtn').addEventListener('click', () => start({ ...T, name: T.name }));
  $('deleteBtn').addEventListener('click', async () => {
    const ok = await askConfirm(`This deletes ${T.name} and its results. The matches' games stay on this device as ordinary games.`, 'Delete');
    if (!ok) return;
    SCStore.remove(T.id);
    location.replace(location.pathname);
  });

  // back from a match — by the back button, which may restore this page
  // as it was, or by switching tabs — reads the results again
  const again = () => { if (T && !document.hidden) { refresh(); render(); } };
  window.addEventListener('pageshow', again);
  document.addEventListener('visibilitychange', again);
  window.addEventListener('storage', again);
}

wire();
const at = SCStore.urlId();
const found = at && SCStore.get(at.id);
if (found && found.type === TYPE) {
  open(found.state);
} else {
  if (at) { SCStore.leave(); SCStore.notice("That tournament isn't on this device."); }
  buildSetup();
  $('setup').classList.remove('hidden');
}
