/* Score Chalk — cribbage: scoring a hand from its cards.

   Scores a hand from its ranks alone. Suits only matter for a flush and for
   knobs, so instead of asking for every card's suit the counter asks at most
   a couple of yes/no questions, and only those the ranks leave open: a hand
   with a pair in it cannot be a flush, a Jack cannot share a suit with a
   Jack starter, and a flush already says whether the Jack matches.

   scoreHand() and settle() are pure — ranks and answers in, itemised score
   out — and the card entry at the bottom is the only part that touches the
   page. It is the hand card's Cards mode; Buttons mode is app.js's pad. */

window.CribCounter = (function () {
  const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  const JACK = 11;
  const value = (r) => Math.min(r, 10);   // A is 1, court cards are 10

  /* ---------------- which questions the ranks leave open ----------------

     ranks: five ranks 1..13, the last of them the starter.
     answers: { flush, starter, knobs }, each true, false or undefined.
     Returns the next question to ask, or null when nothing more is needed,
     along with every answer settled so far — asked or deduced. */
  function settle(ranks, crib, answers) {
    const hand = ranks.slice(0, 4), starter = ranks[4];
    const distinct = (xs) => new Set(xs).size === xs.length;
    const a = { ...answers };
    const jacks = hand.filter((r) => r === JACK).length;

    // A crib flush needs all five; a hand flush needs its four, and the
    // starter may or may not join it.
    if (crib) {
      if (!distinct(ranks)) a.flush = false;
      else if (a.flush === undefined) return { ask: 'flush', a };
      a.starter = a.flush;
    } else {
      if (!distinct(hand)) a.flush = false;
      else if (a.flush === undefined) return { ask: 'flush', a };
      if (!a.flush || hand.includes(starter)) a.starter = false;
      else if (a.starter === undefined) return { ask: 'starter', a };
    }

    // Knobs: a Jack in the hand (or crib) of the starter's suit.
    if (!jacks || starter === JACK) a.knobs = false;
    else if (a.flush) a.knobs = !!a.starter;   // the Jack is the flush suit
    else if (a.knobs === undefined) return { ask: 'knobs', a, jacks };
    return { ask: null, a };
  }

  /* ---------------- the score ----------------

     Items are [what, points, keys, cards]: keys are the count pad's tap ids
     that make up the same points, so switching to Buttons shows chips that
     match what the counter said; cards names the cards that score it, so
     the count can be checked against the hand at a glance. A run with pairs
     in it comes out as the combination players call it — a double run, not
     two runs and a pair. */
  function scoreHand(ranks, crib, a) {
    const items = [];

    // Fifteens: every combination of the five that adds to 15. Each is
    // written high card first, and combinations made of the same ranks —
    // 6+5+4 with either of two 6s — are listed once with how many there are.
    let fifteens = 0;
    const combos = new Map();
    for (let m = 1; m < 32; m++) {
      let t = 0;
      const used = [];
      for (let i = 0; i < 5; i++) if (m & (1 << i)) { t += value(ranks[i]); used.push(ranks[i]); }
      if (t !== 15) continue;
      fifteens++;
      const key = used.sort((x, y) => y - x).map((r) => RANKS[r - 1]).join('+');
      combos.set(key, (combos.get(key) || 0) + 1);
    }
    if (fifteens) {
      items.push([fifteens === 1 ? 'Fifteen' : `${fifteens} fifteens`, 2 * fifteens, Array(fifteens).fill('15'),
        [...combos].map(([k, n]) => (n > 1 ? `${k} ×${n}` : k)).join(' · ')]);
    }

    const count = {};
    for (const r of ranks) count[r] = (count[r] || 0) + 1;

    // runs: five cards hold at most one run of three or more
    let run = null;
    for (let len = 5; len >= 3 && !run; len--) {
      for (let lo = 1; lo + len - 1 <= 13 && !run; lo++) {
        const span = Array.from({ length: len }, (_, k) => lo + k);
        if (span.every((r) => count[r])) run = { len, span, ways: span.reduce((m, r) => m * count[r], 1) };
      }
    }

    const inRun = new Set(run ? run.span : []);
    if (run) {
      const { len, ways, span } = run;
      // low to high, and how many times over: 4 5 6 ×2
      const cards = span.map((r) => RANKS[r - 1]).join(' ') + (ways > 1 ? ` ×${ways}` : '');
      const named = {
        '3x2': ['Double run', 8, ['dblrun']],
        '3x3': ['Triple run', 15, ['triplerun']],
        '3x4': ['Double double run', 16, ['dbldbl']],
        '4x2': ['Double run of 4', 10, ['dblrun4']],
      }[`${len}x${ways}`];
      if (named) items.push([...named, cards]);
      else { items.push([`Run of ${len}`, len, [`run${len}`], cards]); inRun.clear(); }
    }

    // pairs, except those a named run has already counted
    for (const [r, c] of Object.entries(count)) {
      if (c < 2 || inRun.has(Number(r))) continue;
      const name = RANKS[r - 1];
      const cards = Array(c).fill(name).join(' ');
      if (c === 2) items.push(['Pair', 2, ['pair'], cards]);
      if (c === 3) items.push(['Three of a kind', 6, ['three'], cards]);
      if (c === 4) items.push(['Four of a kind', 12, ['four'], cards]);
    }

    if (a.flush) {
      const five = crib || a.starter;
      items.push([five ? 'Five-card flush' : 'Flush', five ? 5 : 4, [five ? 'flush5' : 'flush4'],
        five ? 'all five' : 'four in hand']);
    }
    if (a.knobs) items.push(['Knobs', 1, ['knobs'], 'J, starter\'s suit']);

    return { items, total: items.reduce((t, i) => t + i[1], 0) };
  }

  /* ---------------- entering the cards ----------------

     Lives inside the hand card. Its state belongs to the game (S.pend.cards
     in app.js), so cards survive a reload and Undo, and is passed in on
     every draw: { slots: five ranks or null, at: the slot being filled,
     order: slots in the order they were filled, answers }. Every change
     calls onChange, and the game re-renders and calls draw() again. */

  const fresh = () => ({ slots: [null, null, null, null, null], at: 0, order: [], answers: {} });

  let root = null, st = null, onChange = null;
  const q = (sel) => root.querySelector(sel);

  let onClear = null;

  // changed: after any card or answer. cleared: the Clear button; the game
  // decides what clearing keeps (a starter carried from an earlier hand).
  function build(el, changed, cleared) {
    root = el;
    onChange = changed;
    onClear = cleared;
    root.innerHTML = `
      <div class="ct-slots"></div>
      <div class="ct-labels"><span>Hand</span><span>Starter</span></div>
      <p class="ct-hint"></p>
      <div class="ct-ranks">${RANKS.map((n, k) => `<button class="ct-rank" data-r="${k + 1}">${n}</button>`).join('')}</div>
      <!-- Straight under the ranks, and always the same place: a suit
           question while one is open, otherwise the game's submit button
           (put in .ct-main by app.js). Clear beside it. The breakdown goes
           below, so it grows downward and never moves the button. -->
      <div class="ct-action">
        <div class="ct-main">
          <div class="ct-q hidden">
            <p class="ct-qtext"></p>
            <div class="ct-yn"><button class="seg" data-yes="1">Yes</button><button class="seg" data-yes="0">No</button></div>
          </div>
        </div>
        <button class="ct-clear hidden" type="button">Clear</button>
      </div>
      <ol class="ct-items hidden"></ol>`;

    root.addEventListener('click', (e) => {
      const slot = e.target.closest('[data-i]');
      const rank = e.target.closest('[data-r]');
      const yes = e.target.closest('[data-yes]');
      const clear = e.target.closest('.ct-clear');
      if (clear) { onClear(); return; }
      if (slot) st.at = Number(slot.dataset.i);
      else if (rank && !rank.disabled) {
        const i = st.at;
        st.slots[i] = Number(rank.dataset.r);
        st.order = st.order.filter((x) => x !== i).concat(i);
        st.answers = {};                   // new cards, new questions
        const next = st.slots.findIndex((s) => s == null);
        if (next >= 0) st.at = next;
      } else if (yes) st.answers[q('.ct-q').dataset.ask] = yes.dataset.yes === '1';
      else return;
      onChange();
    });
  }

  // Undo for the cards: takes back the card entered last. A carried
  // starter was never entered here, so it is not in `order` and stays.
  function undo(s) {
    const i = s.order.pop();
    if (i == null) return false;
    s.slots[i] = null;
    s.at = i;
    s.answers = {};
    return true;
  }

  /* Draws the cards, and says how far the hand has got: still being
     entered, waiting on a question, or scored. */
  function draw(state, crib) {
    st = state;
    const { slots, at } = st;

    q('.ct-slots').innerHTML = slots.map((r, i) =>
      `${i === 4 ? '<span class="ct-gap"></span>' : ''}<button class="ct-card${i === at ? ' is-at' : ''}${r ? '' : ' empty'}" data-i="${i}"><b>${r ? RANKS[r - 1] : ''}</b></button>`).join('');
    q('.ct-labels span').textContent = crib ? 'Crib' : 'Hand';

    // only four of any rank in a deck
    root.querySelectorAll('.ct-rank').forEach((b) => {
      const r = Number(b.dataset.r);
      b.disabled = slots.filter((s, i) => s === r && i !== at).length >= 4;
    });

    const full = slots.every((s) => s != null);
    // a starter carried from an earlier hand is not something to clear
    const entered = slots.some((s, i) => s != null && !(i === 4 && st.carried));
    q('.ct-clear').classList.toggle('hidden', !entered);
    const qBox = q('.ct-q'), list = q('.ct-items');
    qBox.classList.add('hidden');
    list.classList.add('hidden');
    if (!full) {
      q('.ct-hint').textContent = at === 4 ? 'Now the starter — the card cut from the deck' : 'Tap the ranks, in any order';
      return { state: 'entering' };
    }
    q('.ct-hint').textContent = 'Tap a card to change it';

    const s = settle(slots, crib, st.answers);
    if (s.ask) {
      q('.ct-qtext').textContent = {
        flush: crib ? 'Are all five cards the same suit?' : 'Are your four hand cards all one suit?',
        starter: 'Is the starter that suit too?',
        knobs: s.jacks > 1 ? 'Is one of the Jacks the same suit as the starter?' : 'Is the Jack the same suit as the starter?',
      }[s.ask];
      qBox.dataset.ask = s.ask;
      qBox.classList.remove('hidden');

      // Light up the cards the question is about, and dim the rest, until
      // it is answered. Gold, to match the question's own border.
      const about = {
        flush: (i) => crib || i < 4,
        starter: (i) => i === 4,
        knobs: (i) => i === 4 || slots[i] === JACK,
      }[s.ask];
      root.querySelectorAll('.ct-card').forEach((c, i) => {
        c.classList.remove('is-at');           // no slot is being filled now
        c.classList.toggle('asked', about(i));
        c.classList.toggle('muted', !about(i));
      });
      return { state: 'asking' };
    }

    const { items, total } = scoreHand(slots, crib, s.a);
    // counted aloud, the way it's said at the table: a running total
    let run = 0;
    list.innerHTML = items.length
      ? items.map(([what, pts, , cards]) => {
          run += pts;
          return `<li><span>${what}${cards ? `<small>${cards}</small>` : ''}</span><i>+${pts}</i><b>${run}</b></li>`;
        }).join('')
      : '<li class="ct-none"><span>Nothing — a nineteen</span><i></i><b>0</b></li>';
    list.classList.remove('hidden');
    return { state: 'scored', total, keys: items.flatMap((i) => i[2]) };
  }

  // where the game puts its submit button, under the ranks
  const mainSlot = () => q('.ct-main');

  return { build, draw, fresh, undo, mainSlot, scoreHand, settle, RANKS };
})();
