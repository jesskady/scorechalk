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

  test('Wins at ends the game at once, ahead of a higher score', async () => {
    const pg = await phone();
    await custom(pg, { names: ['Ann', 'Bob'], turns: false, counters: [LEVEL] });
    await pg.evaluate(() => liveAdd(0, 50));
    await tapCounter(pg, 1, 'lvl', 1); await tapCounter(pg, 1, 'lvl', 1); await wait(400);
    assert.equal(await pg.evaluate(() => winName.textContent), 'Bob wins!');
    assert.equal(await pg.evaluate(() => winBy.textContent), 'Level reached 3');
    assert.equal(await pg.evaluate(() => winTable.querySelector('li span').textContent), 'Bob', 'the winner heads the standings');
    await pg.close();
  });

  test('counters are set up on the setup screen, and kept with Custom', async () => {
    const pg = await phone();
    await open(pg, '/builder/');
    await pg.evaluate(() => { cfg.counters = []; saveCfg(); renderSetup(); });
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
    assert.equal(await pg.evaluate(() => winName.textContent), 'Bob wins!', 'reaching the target ends a live game at once');
    assert.deepEqual(pg.errors, []);
    await pg.close();
  });

  test('the setup offers the buttons only for a live game', async () => {
    const pg = await phone();
    await open(pg, '/builder/');
    await pg.evaluate(() => { Object.assign(cfg, { turns: true, useRounds: false }); saveCfg(); renderSetup(); });
    assert.equal(await pg.evaluate(() => pad.classList.contains('hidden')), true);
    assert.equal(await pg.evaluate(() => padRules.classList.contains('hidden')), false);
    await pg.click('#turns'); await wait(100);
    assert.equal(await pg.evaluate(() => pad.classList.contains('hidden')), false);
    assert.equal(await pg.evaluate(() => padRules.classList.contains('hidden')), true, 'off by default');
    await pg.click('#pad'); await wait(100);
    assert.equal(await pg.evaluate(() => padRules.classList.contains('hidden')), false);
    await pg.close();
  });
});
