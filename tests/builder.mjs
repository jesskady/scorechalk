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
