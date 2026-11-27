/* Yahtzee: putting the players in order, at the setup and once the game
   has started (Edit, in the sheet's corner), and what follows them when
   they move: their boxes, the turn, Undo, and who You are. */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { phone, open, startGame, share, wait, drag, editNames, editRename, editPress } from './helpers.mjs';

const setupNames = (pg) => pg.evaluate(() => [...document.querySelectorAll('#names input')].map((i) => i.value));
const youAre = (pg) => pg.evaluate(() => document.querySelector('#youRow .is-on').textContent);
const pressIn = (pg, sel, text) => pg.evaluate((sel, t) => [...document.querySelectorAll(`${sel} button`)].find((b) => b.textContent === t).click(), sel, text);
async function fill(pg, p, id, pick) {
  await pg.click(`#sheet button.cell[data-p="${p}"][data-id="${id}"]`); await wait(250);
  await pressIn(pg, '#entryBody', pick); await wait(300);
}
const whoseTurn = (pg) => pg.evaluate(() => S.names[S.cur]);

describe('Yahtzee', () => {
  test('the players are put in order at the setup, You going with your name', async () => {
    const pg = await phone();
    await open(pg, '/yahtzee/');
    await pg.click('#pPlus'); await wait(200);
    for (const [i, name] of ['Jess', 'Alex', 'Sam'].entries()) await pg.type(`#names li:nth-child(${i + 1}) input`, name);
    await pressIn(pg, '#youRow', 'Sam'); await wait(200);

    await drag(pg, '#names', 2, 0);
    assert.deepEqual(await setupNames(pg), ['Sam', 'Jess', 'Alex']);
    assert.equal(await youAre(pg), 'Sam', 'You are stays with Sam');

    await startGame(pg);
    assert.deepEqual(await pg.evaluate(() => S.names), ['Sam', 'Jess', 'Alex']);
    assert.equal(await whoseTurn(pg), 'Sam', 'the first in the list starts');
    assert.equal(await pg.evaluate(() => toPayload().me_idx), 0, 'the profile knows which one is you');
    assert.deepEqual(pg.errors, []);
    await pg.close();
  });

  test('Edit moves and renames players mid-game, their scores, the turn and Undo with them', async () => {
    const pg = await phone();
    await open(pg, '/yahtzee/');
    await pg.click('#pPlus'); await wait(200);
    for (const [i, name] of ['Jess', 'Alex', 'Sam'].entries()) await pg.type(`#names li:nth-child(${i + 1}) input`, name);
    await pressIn(pg, '#youRow', 'Sam'); await wait(200);
    await startGame(pg);

    await fill(pg, 0, 'threes', '9');                 // Jess plays: Alex is up
    assert.equal(await whoseTurn(pg), 'Alex');

    // Jess to the end of the list, and Alex by his whole name
    await pg.click('#editBtn'); await wait(300);
    assert.deepEqual(await editNames(pg), ['Jess', 'Alex', 'Sam']);
    await drag(pg, '.edit-game .roster', 0, 2);
    assert.deepEqual(await editNames(pg), ['Alex', 'Sam', 'Jess']);
    await editRename(pg, 0, 'Alexander');
    await editPress(pg, 'Save');
    assert.equal(await pg.$('.edit-game'), null, 'the sheet closes');

    const heads = await pg.evaluate(() => [...document.querySelectorAll('.ptile .pname')].map((t) => t.textContent));
    assert.deepEqual(heads, ['Alexander', 'Sam', 'Jess']);
    assert.equal(await pg.evaluate(() => document.querySelector('.cell[data-p="2"][data-id="threes"]').textContent), '9', "Jess's score went with her");
    assert.equal(await whoseTurn(pg), 'Alexander', 'the turn stays with whoever had it');

    await fill(pg, 0, 'fours', '12');                // Alexander plays: Sam is next in the new order
    assert.equal(await whoseTurn(pg), 'Sam');

    // Undo takes back each score from its own player's column
    await pg.click('#undoBtn'); await wait(300);
    assert.equal(await whoseTurn(pg), 'Alexander');
    assert.equal(await pg.evaluate(() => S.cells[0].fours), undefined);
    await pg.click('#undoBtn'); await wait(300);
    assert.equal(await pg.evaluate(() => S.cells[2].threes), undefined, "Jess's score, undone from Jess's column");
    assert.equal(await whoseTurn(pg), 'Jess');

    // You (Sam) moved from third to second, and the profile knows
    assert.equal(await pg.evaluate(() => toPayload().me_idx), 1);
    // and all of it is kept: a reload shows the same game
    await pg.reload({ waitUntil: 'domcontentloaded' }); await wait(900);
    assert.deepEqual(await pg.evaluate(() => S.names), ['Alexander', 'Sam', 'Jess']);
    assert.deepEqual(pg.errors, []);
    await pg.close();
  });

  test('Cancel leaves the game as it was', async () => {
    const pg = await phone();
    await open(pg, '/yahtzee/');
    await startGame(pg);
    const before = await pg.evaluate(() => JSON.stringify(S));
    await pg.click('#editBtn'); await wait(300);
    await drag(pg, '.edit-game .roster', 0, 1);
    await editPress(pg, 'Cancel');
    assert.equal(await pg.evaluate(() => JSON.stringify(S)), before);
    await pg.close();
  });

  test('a shared game keeps its players where they are', async () => {
    const pg = await phone();
    await open(pg, '/yahtzee/');
    await startGame(pg);
    await share(pg);
    await pg.click('#editBtn'); await wait(300);
    assert.match(await pg.evaluate(() => document.querySelector('.edit-game p').textContent), /shared/);
    assert.equal(await pg.$('.edit-game .roster'), null, 'no list to drag');
    await editPress(pg, 'OK');
    assert.equal(await pg.$('.edit-game'), null);
    await pg.close();
  });
});
