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
    // How a hand is scored: '' for points entered as they are, or one of
    // ROUND_RULES, a game's own scoring: what happened is entered and the
    // rule scores it. Only the games made for one have one (Spades, Skyjo…).
    rule: '',
  };
}

/* ---------------- round rules ----------------

   Some games aren't scored by adding up points but by what happened in the
   hand: a bid made or missed, who went out. With a rule, each side's turn
   enters that (its `in`), and the rule works out the score. Scores are
   worked out again from every round's `in` whenever anything changes — an
   entry, a change to one, an undo, a score from another phone — because a
   rule can look across a round (who went out collects the others' racks)
   or back over the game (Spades' bags). Everything else in the game (the
   sheet, sharing, undo, the profile) sees only the scores, as for any game.

   A rule needs turns and counts up. Teams play as one side, so a team's bid
   is the partners' together. */
const ROUND_RULES = [
  { id: 'spades', label: 'Bids and tricks: Spades', short: 'scored by bids and tricks, with bags',
    hint: 'Enter the bid and the tricks taken. Made: 10 a trick bid, and 1 for each extra (a bag); every 10 bags cost 100. Short: lose 10 a trick bid. A nil is 100 made, or 100 lost.' },
  { id: 'ohhell', label: 'Bids and tricks: Oh Hell', short: 'only an exact bid scores',
    hint: 'Enter the bid and the tricks taken. Exactly the bid scores 10 and 1 a trick; anything else scores nothing.' },
  { id: 'skyjo', label: 'Cards left, ender doubled: Skyjo', short: 'cards left, the ender doubled unless lowest',
    hint: 'Enter what the cards left add up to, and who turned over their last card. If that player doesn\'t have the lowest, their round is doubled.' },
  { id: 'rummikub', label: 'Winner takes the racks: Rummikub', short: 'the one who goes out takes the racks',
    hint: 'Enter what each rack has left (a joker is 30) and who went out. Each player loses their rack, and the one who went out wins them all.' },
];

const ruleOf = (c) => ROUND_RULES.find((r) => r.id && r.id === (c && c.rule)) || null;

// what a turn's entry starts at, before anything is changed
function ruleBlank(rule) {
  if (rule === 'spades') return { bid: 0, took: 0, nil: '' };
  if (rule === 'ohhell') return { bid: 0, took: 0 };
  if (rule === 'skyjo') return { cards: 0, ended: false };
  if (rule === 'rummikub') return { rack: 0, out: false };
  return {};
}

/* Every entry's score and its breakdown, from the entries' `in`. log is the
   game's entries in order, each { p, in }; an entry's round is how many its
   side has had, it included, as on the sheet. A round is complete once
   every side has had it (sides is how many there are). Returns [{ d, parts }]. */
function ruleScores(c, log, sides) {
  const rule = c.rule, seen = [];
  const round = log.map((e) => (seen[e.p] = (seen[e.p] || 0) + 1));
  const out = log.map((e) => ({ d: e.d || 0, parts: e.parts || [] }));
  const inOf = (e) => ({ ...ruleBlank(rule), ...(e.in || {}) });

  if (rule === 'spades' || rule === 'ohhell') {
    const bags = {};
    log.forEach((e, i) => {
      if (!e.in) return;
      const { bid, took, nil } = inOf(e);
      const parts = [];
      if (rule === 'ohhell') {
        const d = took === bid ? 10 + bid : 0;
        parts.push({ said: true, label: took === bid ? `Bid ${bid}, made it` : `Bid ${bid}, took ${took}`, d });
        out[i] = { d, parts };
        return;
      }
      let d;
      if (took >= bid) {
        const was = bags[e.p] || 0, now = was + (took - bid);
        bags[e.p] = now;
        d = 10 * bid + (took - bid);
        parts.push({ said: true, label: took > bid ? `Bid ${bid}, took ${took} (bags ${now})` : `Bid ${bid}, made it`, d });
        const lost = Math.floor(now / 10) - Math.floor(was / 10);
        if (lost > 0) { parts.push({ said: true, label: '10 bags', d: -100 * lost }); d -= 100 * lost; }
      } else {
        d = -10 * bid;
        parts.push({ said: true, label: `Bid ${bid}, took ${took}: set`, d });
      }
      if (nil === 'made') { parts.push({ said: true, label: 'Nil made', d: 100 }); d += 100; }
      if (nil === 'missed') { parts.push({ said: true, label: 'Nil missed', d: -100 }); d -= 100; }
      out[i] = { d, parts };
    });
    return out;
  }

  if (rule === 'skyjo' || rule === 'rummikub') {
    const byRound = {};
    log.forEach((e, i) => { if (e.in) (byRound[round[i]] = byRound[round[i]] || []).push(i); });
    for (const ids of Object.values(byRound)) {
      const done = ids.length >= sides;
      for (const i of ids) {
        const me = inOf(log[i]);
        if (rule === 'skyjo') {
          const raw = me.cards;
          // doubled only when it would cost them: a round at 0 or below stays
          const beaten = ids.some((j) => j !== i && inOf(log[j]).cards <= raw);
          if (me.ended && done && raw > 0 && beaten) out[i] = { d: raw * 2, parts: [{ said: true, label: 'Ended the round, not lowest: doubled', d: raw * 2 }] };
          else out[i] = { d: raw, parts: me.ended ? [{ label: 'Ended the round', d: raw }] : [] };
        } else if (me.out) {
          const won = ids.filter((j) => j !== i && !inOf(log[j]).out).reduce((s, j) => s + inOf(log[j]).rack, 0);
          out[i] = { d: won, parts: [{ said: true, label: done ? 'Went out, takes the racks' : 'Went out (racks still coming)', d: won }] };
        } else {
          out[i] = { d: -me.rack, parts: [] };
        }
      }
    }
    return out;
  }
  return out;
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
  // winner, then their cards — Action card (Draw Two, Reverse, Skip) and Wild
  // (either kind) buttons, and number
  // cards typed at face value.
  { id: 'uno', label: 'UNO',
    rules: {
      ...defaultRules(), name: 'UNO', win: 'target', target: 500,
      quick: 'Action card 20, Wild 50',
      typed: true, signs: false, turns: false, pad: true, players: 4,
      theme: 'parlor',
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
  // Hearts: points are bad. After each hand everyone takes 1 a heart and 13
  // for the Queen of spades; a player who takes them all shoots the moon and
  // everyone else takes 26. When anyone reaches 100, the lowest score wins.
  { id: 'hearts', label: 'Hearts',
    rules: {
      ...defaultRules(), name: 'Hearts', win: 'low', target: 100,
      quick: 'Queen of spades 13, Shot the moon 26',
      typed: true, signs: false, turns: true, players: 4,
      theme: 'parlor',
    } },
  // Rummy 500: each hand, melds count for you and cards left in hand
  // against, so a hand's score can go below nothing. First to 500.
  { id: 'rummy-500', label: 'Rummy 500',
    rules: {
      ...defaultRules(), name: 'Rummy 500', win: 'target', target: 500,
      quick: 'Ace 15, Ten or face card 10',
      typed: true, signs: true, turns: true, players: 3,
      theme: 'parlor',
    } },
  // Five Crowns: eleven rounds, threes to kings, and each round the cards
  // left in hand count against you, wild cards 20 and Jokers 50. After the
  // eleventh, the lowest total wins.
  { id: 'five-crowns', label: 'Five Crowns',
    rules: {
      ...defaultRules(), name: 'Five Crowns', win: 'low', useRounds: true, rounds: 11,
      quick: 'Wild card 20, Joker 50',
      typed: true, signs: false, turns: true, players: 4,
      theme: 'living',
    } },
  // Phase 10: the cards left in hand count against you, and a counter keeps
  // each player's phase. The first to complete all ten wins.
  { id: 'phase-10', label: 'Phase 10',
    rules: {
      ...defaultRules(), name: 'Phase 10', win: 'none',
      quick: 'Card 1–9 5, Card 10–12 10, Skip 15, Wild 25',
      typed: true, signs: false, turns: true, players: 4,
      counters: [{ id: 'phase', name: 'Phases done', start: 0, end: 'win', at: 10 }],
      theme: 'living',
    } },
  // Spades: two partnerships, each hand scored from the side's bid and the
  // tricks it took (see ROUND_RULES), first to 500.
  { id: 'spades', label: 'Spades',
    rules: {
      ...defaultRules(), name: 'Spades', win: 'target', target: 500, rule: 'spades',
      typed: false, signs: false, turns: true, teams: true, teamCount: 2, players: 4,
      theme: 'parlor',
    } },
  // Oh Hell: everyone bids each hand, and only an exact bid scores. Played
  // up and down the river, one card to seven and back: thirteen hands.
  { id: 'oh-hell', label: 'Oh Hell',
    rules: {
      ...defaultRules(), name: 'Oh Hell', win: 'none', useRounds: true, rounds: 13, rule: 'ohhell',
      typed: false, signs: false, turns: true, players: 4,
      theme: 'parlor',
    } },
  // Skyjo: the cards left count against you, the player who ended the round
  // is doubled unless lowest, and when anyone reaches 100 the lowest wins.
  { id: 'skyjo', label: 'Skyjo',
    rules: {
      ...defaultRules(), name: 'Skyjo', win: 'low', target: 100, rule: 'skyjo',
      typed: false, signs: false, turns: true, players: 4,
      theme: 'living',
    } },
  // Rummikub: the player who goes out takes everyone's rack, and the others
  // lose theirs. Played for as many rounds as the table likes, then Finish.
  { id: 'rummikub', label: 'Rummikub',
    rules: {
      ...defaultRules(), name: 'Rummikub', win: 'none', rule: 'rummikub',
      typed: false, signs: false, turns: true, players: 4,
      theme: 'living',
    } },
  // Qwirkle: a point for every tile in each line a turn makes or adds to,
  // counted on 1, 5 and 10, or typed for a big turn. A Qwirkle (a line of
  // all six) is 12 with its bonus, and the player who ends the game by
  // going out takes 6; both are named, so the sheet says what happened. No
  // target: the bag runs out, someone goes out, and Finish shows the final
  // scores, highest first. Points only go up, so no minus.
  { id: 'qwirkle', label: 'Qwirkle',
    rules: {
      ...defaultRules(), name: 'Qwirkle', win: 'none',
      quick: '1, 5, 10, Qwirkle 12, Went out 6', typed: true, signs: false, turns: true,
      theme: 'living',
    } },
];

/* Each game's scoring guide, which links back to it: a template's own, and
   the page for any game otherwise (Custom, My games). Linked from the setup
   and from the game itself. */
const GUIDES = {
  farkle: '/farkle-score-sheet/', canasta: '/canasta-score-keeper/', uno: '/uno-score-keeper/',
  euchre: '/euchre-score-keeper/', hearts: '/hearts-score-keeper/', 'rummy-500': '/rummy-500-score-keeper/',
  'five-crowns': '/five-crowns-score-keeper/', 'phase-10': '/phase-10-score-keeper/',
  spades: '/spades-score-keeper/', 'oh-hell': '/oh-hell-score-keeper/', skyjo: '/skyjo-score-keeper/',
  rummikub: '/rummikub-score-sheet/', qwirkle: '/qwirkle-score-sheet/',
};
function guideOf(src) {
  const t = TEMPLATES.find((x) => x.id === src);
  return t && GUIDES[t.id] ? { href: GUIDES[t.id], text: `How ${t.label} scoring works` }
    : { href: '/score-keeper/', text: 'How to keep score for any game' };
}

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
  // a counter that wins the game is the finish line: it's said with the counters
  const counterWins = (c.counters || []).some((k) => k.end === 'win');
  if (c.win === 'none' && (r || !counterWins)) parts.push(r ? `${c.rounds} rounds, highest wins` : 'Just keep score');
  if (c.win === 'target') parts.push(`First to ${num(c.target)}`);
  if (c.win === 'low') parts.push(r ? `${c.rounds} rounds, lowest wins` : `Ends at ${num(c.target)}, lowest wins`);
  if (c.win === 'zero') parts.push(`Start at ${num(c.start)}, out at 0`);
  else if (c.start !== 0) parts.push(`${c.mode === 'down' ? 'counts down from' : 'starts at'} ${num(c.start)}`);
  if (c.teams) parts.push(`${c.teamCount || 2} teams`);
  const rule = ruleOf(c);
  if (rule) parts.push(rule.short);
  const live = isLive(c), pad = !rule && (!live || padOn(c));
  const keys = pad ? parseQuick(c.quick).keys : [];
  if (keys.length) parts.push(`keys ${keys.map(keyText).join(', ')}`);
  const counters = c.counters || [];
  if (counters.length) parts.push(`counting ${counters.map(counterText).join(', ')}`);
  if (pad && c.typed) parts.push('any score typed');
  if (pad && c.signs) parts.push('can subtract');
  parts.push(live ? 'live, − and + on each player' : 'takes turns');
  return parts.join(' · ');
}
