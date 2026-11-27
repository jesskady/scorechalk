/* Score Chalk — Bridge: the rubber bridge score pad.

   Two partnerships, We (North & South) and They (East & West), scored as on
   paper: the contract's own tricks below the line, where 100 makes a game,
   and everything else above it: overtricks, the bonus for making a doubled
   contract, slams, honors, undertricks to the defenders, and the rubber.
   The first side to two games wins the rubber.

   A hand is entered as it was played: who declared, the contract, whether
   it was doubled, and the tricks taken. The pad is worked out again from
   every hand whenever anything changes (see score()), so Undo is taking a
   hand away, and vulnerability, games and the rubber follow by themselves. */

const TYPE = 'bridge';
const NAMES_KEY = 'bridge-names-v1';
const SEATS = ['North', 'East', 'South', 'West'];
const STRAINS = [
  { id: 'C', sym: '♣', name: 'clubs', red: false },
  { id: 'D', sym: '♦', name: 'diamonds', red: true },
  { id: 'H', sym: '♥', name: 'hearts', red: true },
  { id: 'S', sym: '♠', name: 'spades', red: false },
  { id: 'N', sym: 'NT', name: 'no trump', red: false },
];
const strain = (id) => STRAINS.find((s) => s.id === id);

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const fmt = (n) => n.toLocaleString();

let S = null;          // the rubber; null on the setup screen
let msgTimer = null;

/* ---------------- scoring ----------------

   Rubber bridge, as the laws have it. A side is vulnerable once it has won
   a game. Below the line, each trick bid and made: 20 in a minor, 30 in a
   major, 40 for the first in no trump and 30 after; doubled ×2, redoubled
   ×4. Above the line: overtricks at trick value, or 100 each doubled (200
   vulnerable) and twice that redoubled; 50 for making a doubled contract,
   100 redoubled; 500 / 750 for a small slam and 1000 / 1500 for a grand.
   Down: 50 a trick (100 vulnerable) undoubled; doubled 100, 200, 200, then
   300 each (vulnerable 200, then 300 each); redoubled twice that. */

const trickValue = (s, n) => (s === 'C' || s === 'D' ? 20 * n : s === 'N' ? 40 + 30 * (n - 1) : 30 * n);

function downPoints(u, vul, dbl) {
  if (!dbl) return u * (vul ? 100 : 50);
  const doubled = vul ? 200 + 300 * (u - 1) : 100 + 200 * Math.min(u - 1, 2) + 300 * Math.max(u - 3, 0);
  return dbl === 2 ? doubled * 2 : doubled;
}

// One hand: what goes below the line for the declarers, and what goes above
// it for each side. h is { decl, level, strain, dbl, tricks, honors, honorsSide }.
function handScore(h, vul) {
  const side = h.decl % 2;
  const out = { below: 0, above: [[], []] };
  const diff = h.tricks - (6 + h.level);
  if (diff >= 0) {
    out.below = trickValue(h.strain, h.level) * [1, 2, 4][h.dbl];
    if (diff > 0) {
      const each = h.dbl === 0 ? (h.strain === 'C' || h.strain === 'D' ? 20 : 30) : (vul ? 200 : 100) * h.dbl;
      out.above[side].push({ pts: diff * each, label: `${diff} over` });
    }
    if (h.dbl) out.above[side].push({ pts: 50 * h.dbl, label: h.dbl === 2 ? 'redoubled, made' : 'doubled, made' });
    if (h.level === 6) out.above[side].push({ pts: vul ? 750 : 500, label: 'small slam' });
    if (h.level === 7) out.above[side].push({ pts: vul ? 1500 : 1000, label: 'grand slam' });
  } else {
    out.above[1 - side].push({ pts: downPoints(-diff, vul, h.dbl), label: `set ${-diff}` });
  }
  if (h.honors) out.above[h.honorsSide].push({ pts: h.honors, label: 'honors' });
  return out;
}

/* The whole pad from the hands: each side's entries above the line, the
   games below it, who has won games, and the rubber. ended is a rubber
   stopped before anyone won two games: then a side with a game scores 300,
   and a side with a part score in the unfinished game 100. */
function score(hands, ended) {
  const above = [[], []];
  const games = [{ below: [[], []], winner: null }];
  const won = [0, 0];
  let over = false;
  hands.forEach((h, i) => {
    if (over) return;
    const side = h.decl % 2;
    const g = games[games.length - 1];
    const r = handScore(h, won[side] > 0);
    if (r.below) g.below[side].push({ pts: r.below, label: contractText(h), h: i });
    [0, 1].forEach((s) => r.above[s].forEach((e) => above[s].push({ ...e, h: i })));
    const sum = g.below[side].reduce((t, e) => t + e.pts, 0);
    if (r.below && sum >= 100) {
      g.winner = side;
      won[side]++;
      if (won[side] === 2) {
        over = true;
        above[side].push({ pts: won[1 - side] ? 500 : 700, label: 'rubber', h: i });
      } else games.push({ below: [[], []], winner: null });
    }
  });
  if (ended && !over) {
    const g = games[games.length - 1];
    [0, 1].forEach((s) => {
      if (won[s]) above[s].push({ pts: 300, label: 'game, unfinished rubber', h: hands.length });
      if (g.below[s].length) above[s].push({ pts: 100, label: 'part score, unfinished', h: hands.length });
    });
  }
  const sum = (list) => list.reduce((t, e) => t + e.pts, 0);
  const totals = [0, 1].map((s) => sum(above[s]) + games.reduce((t, g) => t + sum(g.below[s]), 0));
  return { above, games, won, over, totals, vul: [won[0] > 0, won[1] > 0] };
}

// "4♠" or "3NT", with X or XX for a double or redouble
const contractText = (h) => `${h.level}${(strain(h.strain) || { sym: '' }).sym}${['', ' X', ' XX'][h.dbl]}`;
const contractHtml = (h) => {
  // a bid half made (a level, no suit yet) shows what there is
  const st = strain(h.strain) || { sym: '', red: false };
  return `${h.level}<span class="${st.red ? 'red' : ''}">${st.sym}</span>${['', ' X', ' XX'][h.dbl]}`;
};
// how a hand went: "made", "made, 1 over", "down 2"
function resultText(h) {
  const d = h.tricks - (6 + h.level);
  return d < 0 ? `down ${-d}` : d === 0 ? 'made' : `made, ${d} over`;
}

/* ---------------- state ---------------- */

const sideName = (names, s) => `${names[s]} & ${names[s + 2]}`;

function newGame(names) {
  // bid: the contract being played, from the bid until its tricks go in
  return { id: crypto.randomUUID(), startedAt: Date.now(), names, hands: [], bid: null, ended: false, over: false };
}

function save() {
  if (!S) return;
  const r = score(S.hands, S.ended);
  S.over = r.over || S.ended;
  // what the home page's "pick up where you left off" says: see /home.js
  S.sum = r.totals;
  SCStore.put(TYPE, S, S.over);
}

function openGame(state) {
  S = state;
  SCStore.show(S.id);
  showGame();
}
function leaveGame() { location.replace(location.pathname); }

/* ---------------- setup ---------------- */

function savedNames() {
  try { const n = JSON.parse(localStorage.getItem(NAMES_KEY)); return Array.isArray(n) ? n : []; } catch (e) { return []; }
}
function renderSetup() {
  const n = savedNames();
  for (let i = 0; i < 4; i++) $('n' + i).value = n[i] || '';
  const g = SCStore.latest(TYPE);
  $('resumeBtn').classList.toggle('hidden', !g);
}
$('startBtn').onclick = () => {
  const names = [0, 1, 2, 3].map((i) => $('n' + i).value.trim());
  try { localStorage.setItem(NAMES_KEY, JSON.stringify(names)); } catch (e) { /* private mode */ }
  openGame(newGame(names.map((n, i) => n || SEATS[i])));
  save();
};
$('resumeBtn').onclick = () => { const g = SCStore.latest(TYPE); if (g) openGame(g.state); };

/* ---------------- the pad ---------------- */

function showGame() {
  for (const s of ['setup', 'game']) $(s).classList.toggle('hidden', s !== 'game');
  document.body.classList.add('playing');
  render();
}

function render() {
  const r = score(S.hands, S.ended);
  renderPad(r);
  renderHands(r);
  $('handBtn').disabled = r.over || S.ended;
  $('handBtn').textContent = S.bid ? 'Score the hand' : 'Bid a hand';
  $('endBtn').disabled = r.over || S.ended || !S.hands.length;
}

/* The pad as on paper: a column for each side, their names at the top with
   how many games they have and whether they are vulnerable; the bonuses
   above the line, newest highest, as they are written; then each game's
   contracts below it, a rule under each game won, and the totals. */
function renderPad(r) {
  const head = [0, 1].map((s) => `
    <div class="side-head">
      <span class="we">${s ? 'They' : 'We'}</span>
      <b class="hand">${esc(sideName(S.names, s))}</b>
      <small>${r.won[s] ? `${r.won[s]} game${r.won[s] > 1 ? 's' : ''}` : 'no games'}</small>
      <span class="vul ${r.vul[s] ? 'on' : ''}">${r.vul[s] ? 'Vulnerable' : 'Not vulnerable'}</span>
    </div>`).join('');
  const entry = (e) => `<div class="e"><b class="hand">${fmt(e.pts)}</b><small>${esc(e.label)}</small></div>`;
  // below the line, the contract that made it, as large as it was bid
  const contract = (e) => `<div class="e c"><b class="hand">${fmt(e.pts)}</b><span class="bid">${contractHtml(S.hands[e.h])}</span></div>`;
  const above = [0, 1].map((s) => `<div class="col above-col">${[...r.above[s]].reverse().map(entry).join('')}</div>`).join('');
  const games = r.games.map((g, k) => {
    // an empty game still to be played: nothing to draw yet
    if (!g.below[0].length && !g.below[1].length && g.winner === null) return '';
    const cols = [0, 1].map((s) => `<div class="col">${g.below[s].map(contract).join('')}</div>`).join('');
    const rule = g.winner !== null ? `<div class="game-rule"><span>Game ${k + 1}: ${g.winner ? 'They' : 'We'}</span></div>` : '';
    return `<div class="game">${cols}</div>${rule}`;
  }).join('');
  $('pad').innerHTML = `
    <div class="pad-head">${head}</div>
    <div class="above">${above}</div>
    <div class="line" aria-hidden="true"></div>
    <div class="below">${games || '<p class="empty">Contracts made go below the line. 100 makes a game.</p>'}</div>
    <div class="pad-total">${[0, 1].map((s) => `<div><small>Total</small><b class="hand">${fmt(r.totals[s])}</b></div>`).join('')}</div>`;
  $('title').textContent = r.over || S.ended ? 'Bridge · rubber over' : `Bridge · hand ${S.hands.length + 1}`;
  // the bid being played, on show until its tricks go in
  const b = S.bid;
  $('nowBox').classList.toggle('hidden', !b);
  if (b) {
    const side = b.decl % 2;
    $('nowContract').innerHTML = contractHtml(b);
    $('nowWho').innerHTML = `by ${esc(S.names[b.decl])} (${side ? 'They' : 'We'})${r.vul[side] ? ' · <em>vulnerable</em>' : ''}`;
  }
}

// Every hand, newest first: the contract, by whom, how it went, and what it scored.
// What hand i scored for each side, below the line and above it.
function handPoints(r, i) {
  return [0, 1].map((s) => ({
    below: r.games.reduce((t, g) => t + g.below[s].filter((e) => e.h === i).reduce((u, e) => u + e.pts, 0), 0),
    above: r.above[s].filter((e) => e.h === i).reduce((u, e) => u + e.pts, 0),
  }));
}

function renderHands(r) {
  $('hands').innerHTML = S.hands.map((h, i) => {
    const side = h.decl % 2;
    const pts = handPoints(r, i).map(({ below, above }, s) => {
      const bits = [below && `${fmt(below)} below`, above && `${fmt(above)} above`].filter(Boolean);
      return bits.length ? `${s ? 'They' : 'We'} ${bits.join(', ')}` : '';
    }).filter(Boolean).join(' · ');
    return `<li><span class="hn">${i + 1}</span><span class="hc">${contractHtml(h)}</span>
      <span class="hw">${esc(S.names[h.decl])} (${side ? 'They' : 'We'}), ${resultText(h)}<small>${pts}</small></span></li>`;
  }).reverse().join('');
}

function flash(text) {
  $('msg').textContent = text;
  clearTimeout(msgTimer);
  msgTimer = setTimeout(() => { $('msg').textContent = ''; }, 2600);
}

/* ---------------- entering a hand ---------------- */

let H = null;   // the hand being entered

function opt(label, on, onTap, cls = '') {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'opt' + (on ? ' on' : '') + (cls ? ' ' + cls : '');
  b.innerHTML = label;
  b.onclick = () => { onTap(); renderHand(); };
  return b;
}
function fill(row, items) { const el = $(row); el.innerHTML = ''; items.forEach((b) => el.appendChild(b)); }

// which half of the card is showing: 'bid' or 'score', or 'fix' for both,
// changing a hand already entered (see fixHand)
let step = 'bid';

function openHand(which) {
  const b = S.bid;
  H = b ? { ...b, tricks: 6 + b.level, honors: 0, honorsSide: 0 }
    : { decl: null, level: null, strain: null, dbl: 0, tricks: null, honors: 0, honorsSide: 0 };
  step = which;
  $('honorsBox').open = false;
  $('handTitle').textContent = which === 'bid' ? `Hand ${S.hands.length + 1}: the bid` : `Hand ${S.hands.length + 1}: the tricks`;
  $('handOverlay').classList.remove('hidden');
  renderHand();
}
$('handBtn').onclick = () => openHand(S.bid ? 'score' : 'bid');

/* Changing a hand already entered, from Edit's History: the card with all
   of it at once, the bid and the tricks, as it was entered. Saved, the
   hand is replaced where it was, and the pad, vulnerability and games
   follow, as they are worked out again from every hand. The change is
   kept (S.changes) for the history to show and Undo to take back. */
function fixHand(i) {
  H = { ...S.hands[i], fix: i };
  step = 'fix';
  $('honorsBox').open = !!H.honors;
  $('handTitle').textContent = `Changing hand ${i + 1}`;
  $('handOverlay').classList.remove('hidden');
  renderHand();
}
const sameHand = (a, b) => ['decl', 'level', 'strain', 'dbl', 'tricks', 'honors', 'honorsSide'].every((k) => a[k] === b[k]);
$('nowEdit').onclick = () => openHand('bid');

// The bid is made: it goes on show over the pad while the hand is played.
$('playBtn').onclick = () => {
  const { decl, level, strain: st, dbl } = H;
  S.bid = { decl, level, strain: st, dbl };
  closeHand();
  save(); render();
};
const closeHand = () => { $('handOverlay').classList.add('hidden'); H = null; };
$('handClose').onclick = closeHand;
$('handOverlay').addEventListener('click', (e) => { if (e.target === $('handOverlay')) closeHand(); });

function renderHand() {
  const fixing = step === 'fix';
  // who is vulnerable for this hand: now, or, changing one, as it was then
  const r = fixing ? score(S.hands.slice(0, H.fix), false) : score(S.hands, S.ended);
  $('bidPart').classList.toggle('hidden', step !== 'bid' && !fixing);
  $('scorePart').classList.toggle('hidden', step !== 'score' && !fixing);
  $('playBtn').classList.toggle('hidden', fixing);
  $('cardContract').classList.toggle('hidden', fixing);
  $('enterBtn').textContent = fixing ? 'Save the change' : 'Enter the hand';
  $('playBtn').disabled = H.decl === null || !H.level || !H.strain;
  if (H.level && H.strain) $('cardContract').innerHTML = `${contractHtml(H)} <small>by ${esc(S.names[H.decl] || '')}</small>`;
  fill('declRow', [0, 2, 1, 3].map((p) => opt(
    `${esc(S.names[p])}<small>${p % 2 ? 'They' : 'We'}${r.vul[p % 2] ? ' · vul' : ''}</small>`,
    H.decl === p, () => { H.decl = p; })));
  fill('levelRow', [1, 2, 3, 4, 5, 6, 7].map((n) => opt(String(n), H.level === n, () => {
    H.level = n;
  })));
  fill('strainRow', STRAINS.map((st) => opt(st.sym, H.strain === st.id, () => { H.strain = st.id; }, st.red ? 'red' : '')));
  fill('dblRow', ['Not doubled', 'Doubled', 'Redoubled'].map((t, k) => opt(t, H.dbl === k, () => { H.dbl = k; })));
  fill('honorsRow', [[0, 'None'], [100, '100'], [150, '150']].map(([v, t]) => opt(t, H.honors === v, () => { H.honors = v; })));
  fill('honorsSideRow', [0, 1].map((s) => opt(`to ${s ? 'They' : 'We'}`, H.honorsSide === s, () => { H.honorsSide = s; })));
  $('honorsSideRow').classList.toggle('hidden', !H.honors);

  $('tCount').textContent = H.tricks === null ? '–' : H.tricks;
  $('tSays').textContent = H.tricks === null || !H.level ? 'pick the contract first' : resultText(H);
  $('tSays').classList.toggle('down', H.tricks !== null && H.level && H.tricks < 6 + H.level);
  $('tMinus').disabled = H.tricks === null || H.tricks <= 0;
  $('tPlus').disabled = H.tricks === null || H.tricks >= 13;

  const ready = H.decl !== null && H.level && H.strain && H.tricks !== null;
  $('enterBtn').disabled = !ready || (fixing && sameHand(H, S.hands[H.fix]));
  if (!ready) { $('preview').textContent = 'Who declared, the contract, and the tricks taken.'; return; }
  if (fixing) {
    // what the change does to each side's total
    const hands = S.hands.slice();
    hands[H.fix] = H;
    const before = score(S.hands, S.ended), after = score(hands, S.ended);
    const diff = [0, 1].map((s) => after.totals[s] - before.totals[s]);
    $('preview').innerHTML = diff.some(Boolean)
      ? [0, 1].filter((s) => diff[s]).map((s) => `${s ? 'They' : 'We'} <b>${diff[s] > 0 ? '+' : '−'}${fmt(Math.abs(diff[s]))}</b>`).join(' · ')
      : 'No change to the totals yet.';
    return;
  }
  // what this hand would add to each side, as it would go on the pad
  const before = score(S.hands, false), after = score([...S.hands, H], false);
  const add = [0, 1].map((s) => after.totals[s] - before.totals[s]);
  const gameNow = after.won[H.decl % 2] > before.won[H.decl % 2];
  $('preview').innerHTML = [0, 1].filter((s) => add[s]).map((s) => `${s ? 'They' : 'We'} <b>+${fmt(add[s])}</b>`).join(' · ')
    + (gameNow ? ` · <em>game${after.over ? ' and rubber' : ''}</em>` : '');
}

$('tMinus').onclick = () => { if (H.tricks > 0) { H.tricks--; H.touched = true; renderHand(); } };
$('tPlus').onclick = () => { if (H.tricks < 13) { H.tricks++; H.touched = true; renderHand(); } };

$('enterBtn').onclick = () => {
  if (step === 'fix') { saveFix(); return; }
  const { touched, ...hand } = H;
  S.hands.push(hand);
  S.bid = null;
  closeHand();
  save(); render();
  const r = score(S.hands, false);
  flash(`${contractText(hand)} by ${S.names[hand.decl]}: ${resultText(hand)}`);
  if (r.over) showWin(r);
};

function saveFix() {
  const { touched, fix: i, ...hand } = H;
  const was = S.hands[i];
  if (sameHand(hand, was)) { closeHand(); return; }
  if (!S.changes) S.changes = [];
  S.changes.push({ i, was, to: hand, after: S.hands.length });
  S.hands[i] = hand;
  closeHand();
  save(); render();
  flash(`Hand ${i + 1} is now ${contractText(hand)} by ${S.names[hand.decl]}: ${resultText(hand)}`);
  const r = score(S.hands, S.ended);
  if (r.over) showWin(r); else $('winOverlay').classList.add('hidden');
}

/* ---------------- editing the rubber ----------------

   The players can be renamed once the rubber has started (see
   /editgame.js). Their seats stay put: North and South are one side and
   East and West the other, and every hand is scored for the side its
   declarer sat on, so moving a player would move their scores with them. */

/* The rubber's history for Edit's History (see /editgame.js): every hand,
   who declared it, how it went, and what it scored each side. */
function historyRows() {
  const r = score(S.hands, S.ended), rows = [];
  // a change made to a hand, in its place: after the hands there were then
  const changes = (n) => (S.changes || []).filter((c) => c.after === n).map((c) => ({
    who: `Hand ${c.i + 1} changed`,
    what: `was ${contractText(c.was)} by ${S.names[c.was.decl]}, ${resultText(c.was)}`,
  }));
  S.hands.forEach((h, i) => {
    const side = h.decl % 2;
    const pts = handPoints(r, i).map(({ below, above }, s) => (below + above ? `${s ? 'They' : 'We'} +${fmt(below + above)}` : ''))
      .filter(Boolean).join(' · ');
    rows.push({ who: `${contractText(h)} by ${S.names[h.decl]}`, what: side ? 'They' : 'We', when: `hand ${i + 1}, ${resultText(h)}`, pts, edit: () => fixHand(i) });
    rows.push(...changes(i + 1));
  });
  return rows;
}

$('editBtn').onclick = async () => {
  const got = await SCEditGame.open({
    history: historyRows,
    names: S.names,
    labels: SEATS.map((seat) => seat[0]),
    fixed: 'Everyone keeps their seat, as the seats make the sides.',
  });
  if (!got || got.names.every((n, i) => n === S.names[i])) return;
  S.names = got.names;
  save(); render();
  flash('Names changed');
};

/* ---------------- undo, the end of the rubber ---------------- */

$('undoBtn').onclick = () => {
  if (S.ended) { S.ended = false; save(); render(); flash('The rubber is open again'); return; }
  if (S.bid) { const b = S.bid; S.bid = null; save(); render(); flash(`Took back the bid of ${contractText(b)}`); return; }
  // a change made to a hand since the last hand went in comes off first
  const ch = S.changes && S.changes[S.changes.length - 1];
  if (ch && ch.after === S.hands.length) {
    S.changes.pop();
    S.hands[ch.i] = ch.was;
    $('winOverlay').classList.add('hidden');
    save(); render();
    flash(`Took back the change to hand ${ch.i + 1}`);
    const r = score(S.hands, S.ended);
    if (r.over) showWin(r);
    return;
  }
  const h = S.hands.pop();
  if (!h) { flash('Nothing to undo'); return; }
  // a change kept for a hand no longer there goes with it
  if (S.changes) S.changes = S.changes.filter((c) => c.i < S.hands.length && c.after <= S.hands.length);
  $('winOverlay').classList.add('hidden');
  save(); render();
  flash(`Took back ${contractText(h)} by ${S.names[h.decl]}`);
};

// Stopped before anyone has two games: the unfinished-rubber bonuses go on.
$('endBtn').onclick = async () => {
  if (!(await askConfirm('End the rubber here? A side with a game scores 300, and a part score in the game being played scores 100.', 'End rubber'))) return;
  S.ended = true;
  save(); render();
  showWin(score(S.hands, true));
};

function showWin(r) {
  const [a, b] = r.totals;
  const top = a === b ? null : a > b ? 0 : 1;
  $('winName').textContent = top === null ? 'All square' : `${top ? 'They' : 'We'} win by ${fmt(Math.abs(a - b))}`;
  const rubber = r.won.findIndex((w) => w === 2);
  $('winWhy').textContent = rubber >= 0
    ? `${rubber ? 'They' : 'We'} won the rubber, ${r.won[rubber]} games to ${r.won[1 - rubber]}.`
    : 'The rubber was ended before anyone won two games.';
  $('winTable').innerHTML = [0, 1].map((s) => `<li><span>${esc(sideName(S.names, s))}</span><b>${fmt(r.totals[s])}</b></li>`).join('');
  $('winOverlay').classList.remove('hidden');
}
$('keepBtn').onclick = () => $('winOverlay').classList.add('hidden');
$('againBtn').onclick = () => {
  const names = S.names;
  SCStore.remove(S.id);
  S = newGame(names);
  save();
  SCStore.show(S.id);
  $('winOverlay').classList.add('hidden');
  render();
};
$('quitBtn').onclick = async () => {
  if (S.hands.length && !S.over && !(await askConfirm('This ends the rubber in progress and its scores.', 'New rubber'))) return;
  SCStore.remove(S.id);
  leaveGame();
};

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

/* ---------------- boot ---------------- */

renderSetup();
// ?g=<id>: a rubber's own address, from a link or a reload
(async () => {
  const at = SCStore.urlId();
  if (!at) return;
  const st = await SCStore.open(TYPE, at.id, at.fresh);
  if (st) { openGame(st); return; }
  SCStore.leave();
  SCStore.notice("That rubber isn't on this device.");
})();
