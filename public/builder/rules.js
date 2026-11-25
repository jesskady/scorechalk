/* Score Chalk — Builder rules: what a builder game's rules can be, and how
   to say them in one line. Shared by the builder, the home page and the
   profile, which all list games by their rules. Plain globals, no build step:
   load this before any script that uses it. */

const num = (n) => Number(n).toLocaleString();

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
    // how many players a game opens with; the setup screen can change it
    // for tonight without changing the game
    players: 2,
    useRounds: false, rounds: 9,
    quick: '1, 5, 10', typed: true, signs: true, turns: true,
    // A game without turns is live: each tap changes the score at once,
    // with − and + on each player. pad adds the quick-score buttons there.
    pad: false,
    // Played in teams: the players are split into teamCount sides, and each
    // side is scored as one. Which player is on which side is part of who is
    // playing, not of the rules, so it lives with the names (see app.js).
    teams: false, teamCount: 2,
    // the room the game is played in: see /themes.css
    theme: 'workshop',
    // Counters kept beside the score and changed at any time with − and +,
    // not on a turn: a gear bonus, poison. See below.
    counters: [],
  };
}

/* ---------------- counters ----------------

   A counter is { id, name, start, end, at }. id is short and fixed for the
   counter's life, since a shared game keys its cells by it. end says what
   reaching `at` does: nothing, win the game, or put the player out. Which
   way `at` is reached follows from where it sits: above the start it is
   reached going up, below it going down — out at 10 poison, out at 0 life. */
const MAX_COUNTERS = 6;
const COUNTER_ENDS = [
  { id: 'none', label: 'Just count' },
  { id: 'win',  label: 'Wins at' },
  { id: 'out',  label: 'Out at' },
];

const counterId = () => Math.random().toString(36).slice(2, 8);
const newCounter = (n) => ({ id: counterId(), name: `Counter ${n}`, start: 0, end: 'none', at: 10 });

// whether a counter's value has reached its line; a line on the start
// itself is no line, or every player would be on it from the first
const counterReached = (k, v) => k.end !== 'none' && (k.at > k.start ? v >= k.at : k.at < k.start && v <= k.at);

// a counter as it is listed: "Gear", "Poison (out at 10)"
function counterText(k) {
  const name = k.name || 'Counter';
  if (k.end === 'win') return `${name} (wins at ${num(k.at)})`;
  if (k.end === 'out') return `${name} (out at ${num(k.at)})`;
  return name;
}

// The rooms a builder game can be played in, as the setup screen offers them.
const THEMES = [
  { id: 'parlor', label: 'Parlor', hint: 'Chalk and felt' },
  { id: 'living', label: 'Living Room', hint: 'Cream, sage and a legal pad' },
  { id: 'workshop', label: 'Workshop', hint: 'Graph paper' },
];

/* A game's room. A game started before rooms existed has no theme: its
   template says, and anything else is the workshop's. */
function themeOf(c) {
  if (c && THEMES.some((t) => t.id === c.theme)) return c.theme;
  return ({ farkle: 'living', canasta: 'parlor' })[c && c.source] || 'workshop';
}

// Live: no turns, so nothing to enter. Rounds are counted in turns, so a
// game with them is never live.
const isLive = (c) => !c.turns && !roundsOn(c);
// The quick-score buttons in a live game. Rules saved before there was a
// choice had them, and keep them.
const padOn = (c) => c.pad !== false;

// Teams need at least two players a side, so 4 players make 2 teams at most,
// 6 make 3, 8 make 4.
const maxTeams = (players) => Math.min(4, Math.floor(players / 2));
const teamsOn = (c, players) => !!c.teams && maxTeams(players) >= 2;

// Ready-made games, offered under Start from and linked from the home page.
// Opening one fills in the setup form and nothing is locked. `id` is also
// its address: /builder/#farkle.
const TEMPLATES = [
  { id: 'farkle', label: 'Farkle',
    rules: {
      ...defaultRules(), name: 'Farkle', win: 'target', target: 10000,
      quick: '50, 100, 500, 1000', typed: false, signs: false, turns: true,
      theme: 'living',
    } },
  // Partnership canasta: four players in two teams of two, first to 5,000.
  // The named keys are the hand's bonuses; card points are typed, and cards
  // left in hand are taken off with the minus switch.
  { id: 'canasta', label: 'Canasta',
    rules: {
      ...defaultRules(), name: 'Canasta', win: 'target', target: 5000,
      quick: 'Natural canasta 500, Mixed canasta 300, Red three 100, All 4 red threes 800, Going out 100, Out concealed 200',
      typed: true, signs: true, turns: true, teams: true, teamCount: 2, players: 4,
      theme: 'parlor',
    } },
  // UNO: only the player who goes out scores, collecting what is left in
  // everyone else's hands, and the first to 500 wins. So it's live — tap the
  // winner, then their cards — with a button per action card and number
  // cards typed at face value.
  { id: 'uno', label: 'UNO',
    rules: {
      ...defaultRules(), name: 'UNO', win: 'target', target: 500,
      quick: 'Draw Two 20, Reverse 20, Skip 20, Wild 50, Wild Draw Four 50',
      typed: true, signs: false, turns: false, pad: true, players: 4,
      theme: 'living',
    } },
  // Euchre: two partnerships to 10. Either side can score on any hand, so
  // it's live too: tap the side, then what it made.
  { id: 'euchre', label: 'Euchre',
    rules: {
      ...defaultRules(), name: 'Euchre', win: 'target', target: 10,
      quick: 'Made it 1, March 2, Loner march 4, Euchred them 2',
      typed: false, signs: false, turns: false, pad: true, teams: true, teamCount: 2, players: 4,
      theme: 'parlor',
    } },
];

/* Quick-score text → the keys it describes, plus whatever could not be read.

   Keys are separated by commas, and a key may have a name before its
   number: "Natural canasta 500, Red three 100". The name is everything
   before the last number, so "All 4 red threes 800" works. A part with no
   letters in it is plain numbers, as before — "50 100" is two keys.

   Whole numbers only: a game saved to the profile stores its scores as
   integers, so 2.5 is shown as unreadable rather than quietly rounded.
   Plain numbers are listed once each; named keys may share a value. */
function parseQuick(text) {
  const keys = [], bad = [];
  const ok = (n) => Number.isInteger(n) && n > 0;
  for (const part of String(text).split(',').map((p) => p.trim()).filter(Boolean)) {
    if (!/[a-z]/i.test(part)) {
      for (const tok of part.split(/\s+/)) {
        const n = Number(tok);
        if (!ok(n)) bad.push(tok);
        else if (!keys.some((k) => !k.label && k.v === n)) keys.push({ label: '', v: n });
      }
      continue;
    }
    const m = part.match(/^(.*?)\s*(\S+)$/);
    const n = m ? Number(m[2]) : NaN;
    if (m && m[1] && ok(n)) keys.push({ label: m[1].slice(0, 24), v: n });
    else bad.push(part);
  }
  return { keys: keys.slice(0, 12), vals: keys.slice(0, 12).map((k) => k.v), bad };
}

// a key as it is listed: "Red three 100", or just "100"
const keyText = (k) => (k.label ? `${k.label} ${num(k.v)}` : num(k.v));

/* A template's rules fold away into one line, since most of the time you only
   want to say who is playing. Custom always shows them: they are the point. */
function describeRules(c) {
  const parts = [`${c.players || 2} player${(c.players || 2) === 1 ? '' : 's'}`];
  const r = roundsOn(c);
  if (c.win === 'none') parts.push(r ? `${c.rounds} rounds, highest wins` : 'Just keep score');
  if (c.win === 'target') parts.push(`First to ${num(c.target)}`);
  if (c.win === 'low') parts.push(r ? `${c.rounds} rounds, lowest wins` : `Ends at ${num(c.target)}, lowest wins`);
  if (c.win === 'zero') parts.push(`Start at ${num(c.start)}, out at 0`);
  else if (c.start !== 0) parts.push(`${c.mode === 'down' ? 'counts down from' : 'starts at'} ${num(c.start)}`);
  if (c.teams) parts.push(`${c.teamCount || 2} teams`);
  const live = isLive(c), pad = !live || padOn(c);
  const keys = pad ? parseQuick(c.quick).keys : [];
  if (keys.length) parts.push(`keys ${keys.map(keyText).join(', ')}`);
  const counters = c.counters || [];
  if (counters.length) parts.push(`counting ${counters.map(counterText).join(', ')}`);
  if (pad && c.typed) parts.push('any score typed');
  if (pad && c.signs) parts.push('can subtract');
  parts.push(live ? 'live, − and + on each player' : 'takes turns');
  return parts.join(' · ');
}
