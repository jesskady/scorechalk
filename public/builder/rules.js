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

// Quick-score text → the numbers it names, plus whatever could not be read.
// Whole numbers only: a game saved to the profile stores its scores as
// integers, so 2.5 is shown as unreadable rather than quietly rounded.
function parseQuick(text) {
  const vals = [], bad = [];
  for (const tok of String(text).split(/[\s,]+/).filter(Boolean)) {
    const n = Number(tok);
    if (Number.isInteger(n) && n > 0) { if (!vals.includes(n)) vals.push(n); }
    else bad.push(tok);
  }
  return { vals: vals.slice(0, 12), bad };
}

/* A template's rules fold away into one line, since most of the time you only
   want to say who is playing. Custom always shows them: they are the point. */
function describeRules(c) {
  const parts = [];
  const r = roundsOn(c);
  if (c.win === 'none') parts.push(r ? `${c.rounds} rounds, highest wins` : 'Just keep score');
  if (c.win === 'target') parts.push(`First to ${num(c.target)}`);
  if (c.win === 'low') parts.push(r ? `${c.rounds} rounds, lowest wins` : `Ends at ${num(c.target)}, lowest wins`);
  if (c.win === 'zero') parts.push(`Start at ${num(c.start)}, out at 0`);
  else if (c.start !== 0) parts.push(`${c.mode === 'down' ? 'counts down from' : 'starts at'} ${num(c.start)}`);
  const vals = parseQuick(c.quick).vals;
  if (vals.length) parts.push(`keys ${vals.map(num).join(', ')}`);
  if (c.typed) parts.push('any score typed');
  if (c.signs) parts.push('can subtract');
  parts.push(c.turns || r ? 'takes turns' : 'score anyone any time');
  return parts.join(' · ');
}
