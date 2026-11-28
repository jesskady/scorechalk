/* The Builder: the scoresheet, scoring in its bubble, changing a score
   already entered, the sheet on its side, and the board's rows. */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { phone, open, startGame, wait } from './helpers.mjs';

async function custom(pg, settings) {
  await open(pg, '/builder/');
  await pg.evaluate((s) => { Object.assign(cfg, { mode: 'up', start: 0, win: 'none', turns: true, useRounds: false, ...s }); cfg.players = s.names.length; saveCfg(); renderSetup(); }, settings);
  await startGame(pg);
}
const openCells = (pg) => pg.evaluate(() => [...document.querySelectorAll('#sheet .cell.open')].map((c) => S.cfg.names[c.dataset.p]));
// a live game at its end offers the win: the bar says who, End game shows it
const barText = (pg) => pg.evaluate(() => (winBar.classList.contains('hidden') ? '' : winBarText.firstChild.textContent));
const endGame = async (pg) => { await pg.click('#winBarBtn'); await wait(300); };
const tapKey = (pg, t) => pg.evaluate((t) => [...document.querySelectorAll('#quickpad .key')].find((k) => k.textContent === t).click(), t);

describe('the Builder', () => {
  test('a game taken in turns opens in the sheet, and scores in a bubble', async () => {
    const pg = await phone();
    await custom(pg, { names: ['Jess', 'Alex', 'Sam'] });
    assert.equal(await pg.evaluate(() => S.view), 'sheet');
    assert.deepEqual(await openCells(pg), ['Jess', 'Alex', 'Sam']);

    await pg.click('#sheet button.cell.open[data-p="0"]'); await wait(300);
    assert.equal(await pg.evaluate(() => entryTitle.textContent), 'Round 1');
    await tapKey(pg, '+5'); await tapKey(pg, '+10');
    await pg.click('#commitBtn'); await wait(500);
    assert.equal(await pg.evaluate(() => S.scores[0]), 15);
    assert.deepEqual(await openCells(pg), ['Alex', 'Sam'], 'the rest of the round is still to score');

    for (const p of [1, 2]) { await pg.click(`#sheet button.cell.open[data-p="${p}"]`); await wait(250); await pg.click('#commitBtn'); await wait(500); }
    assert.equal(await pg.evaluate(() => sheetRound(turnsBySide())), 2, 'the next round opens');
    assert.deepEqual(pg.errors, []);
    await pg.close();
  });

  test('a score already entered can be changed, and the change undone', async () => {
    const pg = await phone();
    await custom(pg, { names: ['Ann', 'Bob'] });
    await pg.evaluate(() => { for (const v of [5, 10]) { S.pend = v; S.parts = [{ label: '', d: v }]; commit(v); } });
    await wait(300);
    await pg.click('#sheet button.cell[data-p="1"][data-r="1"]'); await wait(300);
    assert.match(await pg.evaluate(() => entryWho.textContent), /was 10/);
    await tapKey(pg, '+5');
    assert.equal(await pg.evaluate(() => commitBtn.textContent), 'Change 10 → 15');
    await pg.click('#commitBtn'); await wait(300);
    await pg.click('#confirmYes'); await wait(500);
    assert.equal(await pg.evaluate(() => S.scores[1]), 15);
    assert.ok(await pg.$eval('#sheet button.cell[data-p="1"][data-r="1"]', (e) => e.classList.contains('edited')));

    await pg.click('#undoBtn'); await wait(300);
    assert.equal(await pg.evaluate(() => S.scores[1]), 10, 'Undo takes back the change, not a turn');
    assert.equal(await pg.evaluate(() => S.log.length), 2);
    assert.deepEqual(pg.errors, []);
    await pg.close();
  });

  test('on a phone, five players turn the sheet on its side; Flip turns it back', async () => {
    const pg = await phone();
    await custom(pg, { names: ['A', 'B', 'C', 'D', 'E'] });
    assert.equal(await pg.evaluate(() => sheetFlipped()), true);
    assert.equal(await pg.evaluate(() => sheetWrap.scrollWidth > sheetWrap.clientWidth), false, 'nothing scrolls sideways');
    await pg.click('.flipbtn'); await wait(300);
    assert.equal(await pg.evaluate(() => sheetFlipped()), false);
    await pg.close();
  });

  test('the board wraps players into even rows', async () => {
    const pg = await phone();
    await custom(pg, { names: ['A', 'B', 'C', 'D', 'E', 'F', 'G'] });
    await pg.evaluate(() => document.querySelector('#viewRow [data-view="board"]').click()); await wait(300);
    const rows = await pg.evaluate(() => {
      const ys = new Map();
      for (const el of scoreboard.children) { const y = Math.round(el.getBoundingClientRect().top); ys.set(y, (ys.get(y) || 0) + 1); }
      return [...ys.values()];
    });
    assert.deepEqual(rows, [4, 3]);
    await pg.close();
  });
});

const GEAR = { id: 'gear', name: 'Gear', start: 0, end: 'none', at: 10 };
const POISON = { id: 'pois', name: 'Poison', start: 0, end: 'out', at: 3 };
const LEVEL = { id: 'lvl', name: 'Level', start: 1, end: 'win', at: 3 };
// a counter where it is shown: on the tiles, or in the table under the sheet
const counterAt = (p, id) => (document.querySelector('#tiles').classList.contains('hidden')
  ? document.querySelector(`#ctable .cval[data-p="${p}"][data-id="${id}"]`)
  : document.querySelector(`#tiles .tile[data-p="${p}"] .trow[data-id="${id}"]`));
const tapCounter = (pg, p, id, d) => pg.evaluate(`(${counterAt})(${p}, '${id}').querySelector('.cstep[data-d="${d}"]').click()`);
const counter = (pg, p, id) => pg.evaluate(`(${counterAt})(${p}, '${id}').querySelector('b').textContent`);

describe('Builder counters', () => {
  test('a counter changes at any time, without taking the turn, and Undo takes back a run of taps', async () => {
    const pg = await phone();
    await custom(pg, { names: ['Ann', 'Bob'], counters: [GEAR] });
    assert.equal(await pg.evaluate(() => counters.classList.contains('hidden')), false, 'shown in the sheet view too');
    await tapCounter(pg, 1, 'gear', 1); await tapCounter(pg, 1, 'gear', 1); await wait(200);
    assert.equal(await counter(pg, 1, 'gear'), '2');
    assert.equal(await pg.evaluate(() => S.cur), 0, 'still Ann\'s turn');
    assert.equal(await pg.evaluate(() => S.clog.length), 1, 'two quick taps are one change');
    assert.match(await pg.$eval('#history .hcount', (e) => e.textContent), /Bob.*Gear.*0 → 2.*\+2/);

    // a score after it, then Undo: the score goes first, then the counter
    await pg.evaluate(() => { S.pend = 5; commit(5); }); await wait(200);
    await pg.click('#undoBtn'); await wait(200);
    assert.equal(await pg.evaluate(() => S.log.length), 0);
    assert.equal(await counter(pg, 1, 'gear'), '2');
    await pg.click('#undoBtn'); await wait(200);
    assert.equal(await counter(pg, 1, 'gear'), '0');

    // it is kept with the game: a reload picks it up as it was
    await tapCounter(pg, 0, 'gear', -1); await wait(300);
    await pg.reload({ waitUntil: 'domcontentloaded' }); await wait(900);
    assert.equal(await counter(pg, 0, 'gear'), '-1');
    assert.deepEqual(pg.errors, []);
    await pg.close();
  });

  test('Out at puts a player out, and the last one left wins', async () => {
    const pg = await phone();
    await custom(pg, { names: ['Ann', 'Bob', 'Cy'], counters: [POISON] });
    for (let k = 0; k < 3; k++) await tapCounter(pg, 1, 'pois', 1);
    await wait(200);
    assert.equal(await pg.evaluate(() => isOut(1)), true);
    // Bob is passed over: Ann scores, and it is Cy's turn
    await pg.evaluate(() => { S.pend = 1; commit(1); }); await wait(200);
    assert.equal(await pg.evaluate(() => S.cur), 2);
    for (let k = 0; k < 3; k++) await tapCounter(pg, 2, 'pois', 1);
    await wait(400);
    assert.equal(await pg.evaluate(() => winName.textContent), 'Ann wins!');
    // taken back, the game is open again
    await pg.click('#keepBtn'); await pg.click('#undoBtn'); await wait(200);
    assert.equal(await pg.evaluate(() => !!S.endedAt), false);
    assert.deepEqual(pg.errors, []);
    await pg.close();
  });

  test('Wins at decides the game, ahead of a higher score', async () => {
    const pg = await phone();
    await custom(pg, { names: ['Ann', 'Bob'], turns: false, counters: [LEVEL] });
    await pg.evaluate(() => liveAdd(0, 50));
    await tapCounter(pg, 1, 'lvl', 1); await tapCounter(pg, 1, 'lvl', 1); await wait(400);
    assert.equal(await barText(pg), 'Bob wins!', 'offered, not declared');
    await endGame(pg);
    assert.equal(await pg.evaluate(() => winName.textContent), 'Bob wins!');
    assert.equal(await pg.evaluate(() => winBy.textContent), 'Level reached 3');
    assert.equal(await pg.evaluate(() => winTable.querySelector('li span').textContent), 'Bob', 'the winner heads the standings');
    await pg.close();
  });

  test('counters are set up on the setup screen, and kept with Custom', async () => {
    const pg = await phone();
    await open(pg, '/builder/');
    await pg.evaluate(() => { cfg.counters = []; saveCfg(); renderSetup(); });
    await pg.click('.stage[data-step="scoring"]'); await wait(100);
    await pg.click('#addCounter'); await wait(100);
    await pg.keyboard.type('Poison');
    await pg.select('#counterList .c-end', 'out');
    await pg.$eval('#counterList .c-at', (e) => { e.value = '10'; e.dispatchEvent(new Event('input')); });
    assert.match(await pg.evaluate(() => describeRules(cfg)), /counting Poison \(out at 10\)/);
    await pg.reload({ waitUntil: 'domcontentloaded' }); await wait(900);
    assert.deepEqual(await pg.evaluate(() => cfg.counters.map(({ name, end, at }) => [name, end, at])), [['Poison', 'out', 10]]);
    await pg.evaluate(() => { cfg.counters = []; saveCfg(); });
    await pg.close();
  });
});

const tapScore = (pg, p, d) => pg.click(`#tiles .tile[data-p="${p}"] .tstep[data-d="${d}"]`);
const tileScore = (pg, p) => pg.$eval(`#tiles .tile[data-p="${p}"] .pnum`, (b) => b.textContent);

describe('Builder, live', () => {
  test('without turns a tap changes the score at once, and a run of taps is one entry', async () => {
    const pg = await phone();
    await custom(pg, { names: ['Ann', 'Bob'], turns: false, start: 1, counters: [GEAR] });
    assert.equal(await pg.evaluate(() => tiles.classList.contains('hidden')), false, 'a tile a player');
    assert.equal(await pg.evaluate(() => document.getElementById('entry').classList.contains('hidden')), true, 'no pad unless asked for');
    assert.equal(await pg.evaluate(() => counters.classList.contains('hidden')), true, 'the counters are in the tiles');

    await tapScore(pg, 1, 1); await tapScore(pg, 1, 1); await tapScore(pg, 1, 1);
    await tapScore(pg, 0, -1);
    await wait(200);
    assert.equal(await tileScore(pg, 1), '4');
    assert.equal(await tileScore(pg, 0), '0');
    assert.deepEqual(await pg.evaluate(() => S.log.map((e) => [e.p, e.d])), [[1, 3], [0, -1]]);

    // the counter in the same tile, and Undo back through both
    await tapCounter(pg, 0, 'gear', 1); await wait(100);
    await pg.click('#undoBtn'); await wait(100);
    assert.equal(await counter(pg, 0, 'gear'), '0');
    await pg.click('#undoBtn'); await wait(100);
    assert.equal(await tileScore(pg, 0), '1');
    // after an Undo, the next tap is a new entry, not added to the last
    await tapScore(pg, 1, 1); await wait(100);
    assert.deepEqual(await pg.evaluate(() => S.log.map((e) => [e.p, e.d])), [[1, 3], [1, 1]]);
    assert.deepEqual(pg.errors, []);
    await pg.close();
  });

  test('with quick-score buttons, a tap goes straight to whoever is picked', async () => {
    const pg = await phone();
    await custom(pg, { names: ['Ann', 'Bob'], turns: false, pad: true, quick: '5, 10', win: 'target', target: 20 });
    assert.equal(await pg.evaluate(() => getComputedStyle(commitBtn).display), 'none', 'nothing to enter');
    await pg.click('#tiles .tile[data-p="1"] .tname'); await wait(100);
    await tapKey(pg, '+10'); await tapKey(pg, '+5');
    await wait(200);
    assert.equal(await tileScore(pg, 1), '15');
    assert.equal(await pg.evaluate(() => S.log.length), 1);
    await pg.type('#typedIn', '5'); await pg.click('#typedAdd'); await wait(400);
    assert.equal(await barText(pg), 'Bob wins!', 'reaching the target offers the win');
    assert.equal(await pg.evaluate(() => winOverlay.classList.contains('hidden')), true, 'nothing covers the game');
    // scoring goes on under the bar, and Undo back below the line takes it away
    await pg.type('#typedIn', '4'); await pg.click('#typedAdd'); await wait(300);
    assert.equal(await tileScore(pg, 1), '24');
    // (quick taps on one player run together into one entry, so one Undo may
    // take back more than the last tap: whatever it leaves is under 20)
    await pg.click('#undoBtn'); await wait(300);
    assert.ok(Number(await tileScore(pg, 1)) < 20);
    assert.equal(await barText(pg), '', 'under the line again: no bar');
    await pg.evaluate(() => liveAdd(1, 20 - S.scores[1])); await wait(300);
    assert.equal(await barText(pg), 'Bob wins!');
    await endGame(pg);
    assert.equal(await pg.evaluate(() => winName.textContent), 'Bob wins!');
    // back to the scores, the bar stays, and opens the result again
    await pg.click('#keepBtn'); await wait(200);
    assert.equal(await barText(pg), 'Bob wins!');
    assert.equal(await pg.evaluate(() => winBarBtn.textContent), 'See results');
    await endGame(pg);
    assert.equal(await pg.evaluate(() => winOverlay.classList.contains('hidden')), false, 'the result again');
    assert.deepEqual(pg.errors, []);
    await pg.close();
  });

  test('Qwirkle: tiles on 1, 5 and 10, a Qwirkle, the end bonus, and Finish naming the winner', async () => {
    const pg = await phone();
    await open(pg, '/builder/#qwirkle');
    assert.match(await pg.evaluate(() => rulesText.textContent), /Highest wins at Finish · keys 1, 5, 10, Qwirkle 12, Went out 6/);
    await pg.evaluate(() => { cfg.names = ['Ann', 'Bob']; saveCfg(); renderSetup(); });
    await startGame(pg);
    await pg.click('#viewRow [data-view="sheet"]'); await wait(300);    // on the sheet, whichever was picked
    // a key as it reads: +1, +5, +10, or a named one by its name
    const turn = async (p, keys) => {
      await pg.click(`#sheet button.cell.open[data-p="${p}"]`); await wait(250);
      for (const k of keys) {
        await pg.evaluate((k) => [...document.querySelectorAll('#quickpad .key')]
          .find((x) => (x.querySelector('b') ? x.querySelector('b').textContent : x.textContent.trim()) === k).click(), k);
      }
      // a moment between turns, as at a table: a second Enter within 0.7s is
      // taken for a double tap and ignored (see commitBtn in the Builder)
      await pg.click('#commitBtn'); await wait(800);
    };
    assert.equal(await pg.evaluate(() => signRow.classList.contains('hidden')), true, 'scores only go up: no minus');
    await turn(0, ['+10', '+1', '+1', '+1']);            // Ann: 13 tiles' worth
    await turn(1, ['Qwirkle', '+1', '+1', '+1']);         // Bob: a Qwirkle, and a line of three
    await turn(0, ['Went out']);                          // Ann ends the game
    assert.deepEqual(await pg.evaluate(() => S.scores), [19, 15]);
    assert.match(await pg.evaluate(() => S.log[1].parts.map((x) => x.label).join(' ')), /Qwirkle/, 'the sheet says it was a Qwirkle');
    // no target: Finish ends it, and the highest wins, named
    await pg.click('#finishBtn'); await wait(300);
    assert.equal(await pg.$eval('#confirmText', (p) => p.textContent), 'End the game here? The highest score wins.');
    await pg.click('#confirmYes'); await wait(300);
    assert.equal(await pg.$eval('#winName', (h) => h.textContent), 'Ann wins!');
    assert.deepEqual(await pg.$$eval('#winTable li', (ls) => ls.map((l) => l.textContent)), ['Ann19', 'Bob15']);
    assert.equal(await pg.evaluate(() => S.winnerIdx), 0);
    assert.equal(await pg.$eval('#gameGuide', (a) => a.getAttribute('href')), '/qwirkle-score-sheet/');
    assert.deepEqual(pg.errors, []);
    await pg.close();
  });

  test('UNO and Euchre: tap who scored, then what they made', async () => {
    const tapNamed = (pg, label) => pg.evaluate((l) => [...document.querySelectorAll('#quickpad .key b')]
      .find((b) => b.textContent === l).closest('.key').click(), label);

    // UNO: the player who went out collects everyone else's cards, to 500
    const uno = await phone();
    await open(uno, '/builder/#uno');
    assert.match(await uno.evaluate(() => rulesText.textContent), /4 players · First to 500/);
    await startGame(uno);
    assert.equal(await uno.evaluate(() => S.cfg.live), true);
    await uno.click('#tiles .tile[data-p="2"] .tname'); await wait(100);
    await tapNamed(uno, 'Wild'); await tapNamed(uno, 'Action card');
    await uno.type('#typedIn', '7'); await uno.click('#typedAdd'); await wait(300);
    assert.equal(await tileScore(uno, 2), '77', 'a Wild, a Skip and a 7');
    assert.equal(await tileScore(uno, 0), '0', 'nobody else scores');
    assert.deepEqual(uno.errors, []);
    await uno.close();

    // Euchre: two sides to 10; a loner march is 4
    const eu = await phone();
    await open(eu, '/builder/#euchre');
    assert.match(await eu.evaluate(() => rulesText.textContent), /First to 10 · 2 teams/);
    await startGame(eu);
    assert.equal(await eu.evaluate(() => S.cfg.names.length), 2, 'scored as two sides');
    await eu.click('#tiles .tile[data-p="1"] .tname'); await wait(100);
    for (const k of ['Loner march', 'Loner march', 'March']) { await tapNamed(eu, k); await wait(150); }
    await wait(300);
    assert.match(await barText(eu), /wins!/, 'a side at 10 is offered the win');
    await endGame(eu);
    assert.match(await eu.evaluate(() => winName.textContent), /wins!/);
    assert.deepEqual(eu.errors, []);
    await eu.close();
  });

  test('Hearts, Rummy 500, Five Crowns and Phase 10: each template plays to its own end', async () => {
    // a whole round at once: one score for each player, in turn
    const round = (pg, ...vs) => pg.evaluate((vs) => { for (const v of vs) { S.pend = v; S.parts = [{ label: '', d: v }]; commit(v); } }, vs);
    const start = async (id, rules) => {
      const pg = await phone();
      await open(pg, `/builder/#${id}`);
      assert.match(await pg.evaluate(() => rulesText.textContent), rules, id);
      await startGame(pg);
      await wait(300);
      return pg;
    };
    const winner = (pg) => pg.evaluate(() => (winOverlay.classList.contains('hidden') ? '' : winName.textContent));

    // Hearts: once anyone reaches 100, the round is played out and the lowest wins
    const he = await start('hearts', /4 players · Ends at 100, lowest wins · keys Queen of spades 13, Shot the moon 26/);
    await he.click('#sheet button.cell.open[data-p="0"]'); await wait(300);
    await he.evaluate(() => [...document.querySelectorAll('#quickpad .key b')].find((b) => b.textContent === 'Queen of spades').closest('.key').click());
    assert.equal(await he.evaluate(() => S.pend), 13, 'the Queen is a key');
    await he.click('#commitBtn'); await wait(400);
    await round(he, 5, 8, 0);
    await round(he, 90, 0, 2, 24);
    assert.equal(await winner(he), 'Player 2 wins!', 'Player 1 passed 100 (103, 5, 10, 24): the fewest wins');
    assert.deepEqual(he.errors, []);
    await he.close();

    // Rummy 500: a hand can go below nothing; first to 500
    const ru = await start('rummy-500', /3 players · First to 500 · keys Ace 15, Ten or face card 10 · any score typed · can subtract/);
    await round(ru, 120, -35, 60);
    await round(ru, 390, 10, 15);
    assert.equal(await ru.evaluate(() => S.scores.join(' ')), '510 -25 75');
    assert.equal(await winner(ru), 'Player 1 wins!');
    await ru.close();

    // Five Crowns: eleven rounds, then the lowest total wins
    const fc = await start('five-crowns', /4 players · 11 rounds, lowest wins · keys Wild card 20, Joker 50/);
    for (let r = 1; r <= 10; r++) await round(fc, 10, 5, 20, 0);
    assert.equal(await winner(fc), '', 'not over after ten');
    await round(fc, 10, 5, 20, 60);
    assert.equal(await winner(fc), 'Player 2 wins!', '55 beats 60');
    assert.deepEqual(fc.errors, []);
    await fc.close();

    // Phase 10: the first to finish the tenth phase wins, whatever the score
    const ph = await start('phase-10', /4 players · keys Card 1–9 5, Card 10–12 10, Skip 15, Wild 25 · counting Phases done \(wins at 10\)/);
    await round(ph, 0, 25, 40, 5);
    for (let k = 0; k < 10; k++) await tapCounter(ph, 2, 'phase', 1);
    await wait(400);
    await ph.evaluate(() => { if (!winOverlay.classList.contains('hidden')) return; const b = document.getElementById('winBarBtn'); if (b && !winBar.classList.contains('hidden')) b.click(); });
    await wait(300);
    assert.equal(await winner(ph), 'Player 3 wins!');
    assert.equal(await ph.evaluate(() => winBy.textContent), 'Phases done reached 10');
    assert.deepEqual(ph.errors, []);
    await ph.close();
  });

  /* Games scored by a rule: what happened in the hand goes in, and the rule
     scores it. A person taps steppers and switches, and types a number. */
  const ruleCell = async (pg, p, r) => { await pg.click(`#sheet button.cell[data-p="${p}"][data-r="${r}"]`); await wait(300); };
  const step = (pg, k, n) => pg.evaluate((k, n) => { for (let i = 0; i < Math.abs(n); i++) document.querySelector(`#rulePad .stepper[data-k="${k}"] [data-d="${Math.sign(n)}"]`).click(); }, k, n);
  const seg = (pg, k, v) => pg.click(`#rulePad .rp-segs[data-k="${k}"] [data-v="${v}"]`);
  const typeIn = async (pg, k, v) => { await pg.click(`#rulePad input[data-k="${k}"]`, { clickCount: 3 }); await pg.type(`#rulePad input[data-k="${k}"]`, String(v)); };
  const enter = async (pg) => { await pg.click('#commitBtn'); await wait(800); };
  const ruleGame = async (pg, id, names) => {
    await open(pg, `/builder/#${id}`);
    await pg.evaluate((n) => { cfg.names = n; cfg.players = n.length; saveCfg(); renderSetup(); }, names);
    await startGame(pg);
  };

  test('Spades: bids and tricks scored, bags cost 100 at ten, and a nil', async () => {
    const pg = await phone();
    await ruleGame(pg, 'spades', ['Ann', 'Bob', 'Cy', 'Di']);
    assert.deepEqual(await pg.evaluate(() => S.cfg.names), ['Ann & Cy', 'Bob & Di']);
    for (let r = 1; r <= 5; r++) {
      await ruleCell(pg, 0, r); await step(pg, 'bid', 4); await step(pg, 'took', 6);
      if (r === 1) assert.equal(await pg.evaluate(() => pendAmt.textContent), '+42', 'the hand shows its score before it goes in');
      await enter(pg);
      await ruleCell(pg, 1, r); await step(pg, 'bid', 5); await step(pg, 'took', 3);
      if (r === 1) await seg(pg, 'nil', 'made');
      await enter(pg);
    }
    // four hands of 42, then the fifth's two bags make ten: 42 − 100
    assert.deepEqual(await pg.evaluate(() => S.scores), [4 * 42 - 58, 50 - 4 * 50]);
    assert.match(await pg.evaluate(() => partsText(S.log[8].parts)), /10 bags/);
    assert.deepEqual(pg.errors, []);
    await pg.close();
  });

  test('Skyjo: whoever ends the round is doubled unless lowest, and a change scores the round again', async () => {
    const pg = await phone();
    await ruleGame(pg, 'skyjo', ['Ann', 'Bob', 'Cy']);
    await ruleCell(pg, 0, 1); await typeIn(pg, 'cards', 10); await seg(pg, 'ended', '1'); await enter(pg);
    await ruleCell(pg, 1, 1);
    assert.equal(await pg.$eval('#rulePad .rp-segs[data-k="ended"] [data-v="1"]', (b) => b.disabled), true, 'one player ends a round');
    await typeIn(pg, 'cards', 8); await enter(pg);
    await ruleCell(pg, 2, 1); await pg.click('#rulePad [data-neg]'); await typeIn(pg, 'cards', 3); await enter(pg);
    assert.deepEqual(await pg.evaluate(() => S.scores), [20, 8, -3], 'Ann ended on 10, not lowest: 20');

    // Bob's 8 was really 11, and Cy's −3 was 15: now Ann was lowest
    await ruleCell(pg, 1, 1); await typeIn(pg, 'cards', 11); await enter(pg); await pg.click('#confirmYes'); await wait(500);
    await ruleCell(pg, 2, 1); await pg.click('#rulePad [data-neg]'); await typeIn(pg, 'cards', 15); await enter(pg); await pg.click('#confirmYes'); await wait(500);
    assert.deepEqual(await pg.evaluate(() => S.scores), [10, 11, 15]);
    await pg.click('#undoBtn'); await wait(300);
    assert.deepEqual(await pg.evaluate(() => S.scores), [20, 11, -3], 'Undo puts Cy back, and Ann is doubled again');
    assert.deepEqual(pg.errors, []);
    await pg.close();
  });

  test('Rummikub: the one who went out takes the racks; Oh Hell: only an exact bid scores', async () => {
    const pg = await phone();
    await ruleGame(pg, 'rummikub', ['Ann', 'Bob', 'Cy']);
    await ruleCell(pg, 0, 1); await typeIn(pg, 'rack', 12); await enter(pg);
    await ruleCell(pg, 1, 1); await seg(pg, 'out', '1'); await enter(pg);
    await ruleCell(pg, 2, 1);
    assert.match(await pg.evaluate(() => rpNote.textContent), /Bob went out/);
    await typeIn(pg, 'rack', 30); await enter(pg);
    assert.deepEqual(await pg.evaluate(() => S.scores), [-12, 42, -30]);
    await pg.close();

    const oh = await phone();
    await ruleGame(oh, 'oh-hell', ['Ann', 'Bob']);
    assert.match(await oh.evaluate(() => roundBadge.textContent), /of 13/);
    await ruleCell(oh, 0, 1); await step(oh, 'bid', 2); await step(oh, 'took', 2); await enter(oh);
    await ruleCell(oh, 1, 1); await step(oh, 'bid', 1); await enter(oh);
    assert.deepEqual(await oh.evaluate(() => S.scores), [12, 0]);
    assert.deepEqual(oh.errors, []);
    await oh.close();
  });

  test('a game with scoring of its own says so in place of the buttons, and keeps to turns', async () => {
    const pg = await phone();
    await open(pg, '/builder/#spades');
    await pg.click('#editRules'); await wait(100);
    await pg.evaluate(() => showStep('scoring'));
    assert.equal(await pg.$eval('#keysCard', (e) => e.classList.contains('hidden')), true, 'no quick-score buttons to set');
    assert.match(await pg.evaluate(() => ruleHint.textContent), /bag/);
    await pg.evaluate(() => showStep('game'));
    assert.equal(await pg.$eval('#turnsRow .way[data-turns="0"]', (b) => b.disabled), true);
    // and Custom has no such scoring to choose
    await open(pg, '/builder/');
    assert.equal(await pg.$('#ruleRow'), null);
    await pg.close();
  });

  test('the setup offers the buttons only for a live game', async () => {
    const pg = await phone();
    await open(pg, '/builder/');
    await pg.evaluate(() => { Object.assign(cfg, { turns: true, useRounds: false }); saveCfg(); renderSetup(); });
    assert.equal(await pg.evaluate(() => pad.classList.contains('hidden')), true);
    assert.equal(await pg.evaluate(() => padRules.classList.contains('hidden')), false);
    await pg.click('#turnsRow .way[data-turns="0"]'); await wait(100);
    assert.equal(await pg.evaluate(() => pad.classList.contains('hidden')), false);
    assert.equal(await pg.evaluate(() => padRules.classList.contains('hidden')), true, 'off by default');
    await pg.click('.stage[data-step="scoring"]'); await wait(100);
    await pg.click('#pad'); await wait(100);
    assert.equal(await pg.evaluate(() => padRules.classList.contains('hidden')), false);
    await pg.close();
  });
});

describe('the Builder setup, in steps', () => {
  const shown = (pg) => pg.evaluate(() => ({
    pane: document.querySelector('#setup .pane:not(.hidden)').dataset.step,
    next: nextBtn.classList.contains('hidden') ? null : nextBtn.textContent,
    start: !startBtn.classList.contains('hidden'),
  }));

  test('Custom walks Game, Players, Scoring; a template opens on its players, with a way to its rules', async () => {
    const pg = await phone();
    await open(pg, '/builder/');
    assert.deepEqual(await shown(pg), { pane: 'game', next: 'Next: Players', start: false });
    await pg.click('#nextBtn'); await wait(100);
    assert.deepEqual(await shown(pg), { pane: 'players', next: 'Next: Scoring', start: false });
    await pg.click('#nextBtn'); await wait(100);
    assert.deepEqual(await shown(pg), { pane: 'scoring', next: null, start: true });

    // a template opens on its players, its rules in a line, ready to start
    await open(pg, '/builder/#farkle');
    assert.deepEqual(await shown(pg), { pane: 'players', next: null, start: true });
    assert.equal(await pg.$eval('#stages', (e) => e.classList.contains('hidden')), true, 'no steps to walk');
    assert.match(await pg.evaluate(() => quickText.textContent), /First to 10,000/);
    assert.equal(await pg.evaluate(() => setupGuide.getAttribute('href')), '/farkle-score-sheet/', 'its own scoring guide');
    // and its rules can still be changed: the link opens the steps
    await pg.click('#editRules'); await wait(100);
    assert.deepEqual(await shown(pg), { pane: 'game', next: 'Next: Players', start: false });
    assert.equal(await pg.$eval('#quickRules', (e) => e.classList.contains('hidden')), true);
    await pg.click('#nextBtn'); await wait(100);
    assert.deepEqual(await shown(pg), { pane: 'players', next: null, start: true });
    assert.deepEqual(pg.errors, []);
    await pg.close();
  });

  test('rounds live under Take turns, and keep to the endings that can end on them', async () => {
    const pg = await phone();
    await open(pg, '/builder/');
    await pg.evaluate(() => { Object.assign(cfg, { turns: true, useRounds: false, win: 'target' }); saveCfg(); renderSetup(); });
    assert.equal(await pg.evaluate(() => roundsBox.classList.contains('hidden')), false);
    await pg.click('#useRounds'); await wait(100);
    assert.equal(await pg.evaluate(() => cfg.win), 'none', 'First to target gives way');
    const endings = await pg.evaluate(() => [...winRow.children].map((b) => b.textContent + (b.disabled ? ' (off)' : '')));
    assert.deepEqual(endings, ['Highest wins', 'First to target (off)', 'Lowest wins', 'Out at zero (off)']);
    await pg.click('#turnsRow .way[data-turns="0"]'); await wait(100);
    assert.equal(await pg.evaluate(() => roundsBox.classList.contains('hidden')), true);
    assert.equal(await pg.evaluate(() => cfg.useRounds), false, 'no rounds without turns');
    await pg.close();
  });

  test('a problem found at Start opens the step it belongs to', async () => {
    const pg = await phone();
    // Farkle starts from the players; its buttons, emptied, are on Scoring
    await open(pg, '/builder/#farkle');
    await pg.evaluate(() => { Object.assign(cfg, { quick: '', typed: false }); saveCfg(); renderSetup(); showStep('players'); });
    await pg.click('#startBtn'); await wait(200);
    assert.equal(await pg.evaluate(() => step), 'scoring');
    assert.match(await pg.evaluate(() => startBtn.textContent), /quick-score button/);
    await pg.close();
  });
});

describe('the Builder, board or sheet', () => {
  test('a game taken in turns asks board or sheet first, and remembers it; a live game does not ask', async () => {
    const pg = await phone();
    await open(pg, '/builder/');
    await pg.evaluate(() => { Object.assign(cfg, { turns: true, useRounds: false, names: ['Ann', 'Bob'], players: 2 }); saveCfg(); renderSetup(); showStep(STEPS[STEPS.length - 1]); });
    await pg.click('#startBtn'); await wait(400);
    const opts = () => pg.evaluate(() => [...document.querySelectorAll('.pick-opt')].map((b) => b.dataset.mode + (b.classList.contains('is-current') ? '*' : '')));
    assert.equal(await pg.evaluate(() => pick.classList.contains('hidden')), false);
    assert.deepEqual(await opts(), ['sheet', 'board'], 'nothing marked: never chosen');
    assert.match(await pg.evaluate(() => pickNote.textContent), /switch any time/);
    await pg.click('#pickBack'); await wait(200);
    assert.equal(await pg.evaluate(() => setup.classList.contains('hidden')), false, 'Back is the setup');

    await pg.click('#startBtn'); await wait(300);
    await pg.click('.pick-opt[data-mode="board"]'); await wait(500);
    assert.deepEqual(await pg.evaluate(() => [S.view, sheetOn(), game.classList.contains('hidden')]), ['board', false, false]);

    // the next game remembers, and says so
    await pg.click('#quitBtn'); await wait(300);
    const yes = await pg.$('#confirmYes'); if (yes && await yes.isVisible()) { await yes.click(); await wait(400); }
    await open(pg, '/builder/');
    await pg.evaluate(() => showStep(STEPS[STEPS.length - 1]));
    await pg.click('#startBtn'); await wait(400);
    const again = await pg.$('#confirmYes'); if (again && await again.isVisible()) { await again.click(); await wait(400); }
    assert.deepEqual(await opts(), ['sheet', 'board*']);
    await pg.click('.pick-opt[data-mode="sheet"]'); await wait(500);
    assert.equal(await pg.evaluate(() => S.view), 'sheet');

    // a live game has no sheet, so nothing to ask
    await open(pg, '/builder/');
    await pg.evaluate(() => { Object.assign(cfg, { turns: false, useRounds: false }); saveCfg(); renderSetup(); showStep(STEPS[STEPS.length - 1]); });
    await pg.click('#startBtn'); await wait(400);
    const third = await pg.$('#confirmYes'); if (third && await third.isVisible()) { await third.click(); await wait(400); }
    assert.equal(await pg.evaluate(() => pick.classList.contains('hidden')), true);
    assert.equal(await pg.evaluate(() => game.classList.contains('hidden')), false);
    assert.deepEqual(pg.errors, []);
    await pg.close();
  });
});
