/* Every game has its own address, any number can be in progress, and the
   games kept the old way, one of a kind, move into the store by id. */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { phone, open, startGame, wait } from './helpers.mjs';

const cards = (pg) => pg.$$eval('#resumeRow .rc', (as) => as.map((a) => ({
  name: a.querySelector('b').textContent, href: a.getAttribute('href'),
})));

describe('game links', () => {
  test('the old one-a-kind games move in, keeping their ids', async () => {
    const pg = await phone();
    await open(pg, '/');
    await pg.evaluate(() => {
      localStorage.clear();
      localStorage.setItem('magic-v1', JSON.stringify({ format: 'commander', names: ['A', 'B'], life: [40, 31], poison: [0, 0], cmdr: [[0, 0], [0, 0]], log: [{}], won: false, start: 40 }));
      localStorage.setItem('builder-game-v1:canasta', JSON.stringify({ id: 'cccccccc-0000-0000-0000-000000000003', cfg: { name: 'Canasta', source: 'canasta', names: ['Team A', 'Team B'] }, scores: [500, 300], log: [{ p: 0, d: 500 }], startedAt: 3 }));
    });
    await open(pg, '/');
    const found = await cards(pg);
    assert.deepEqual(found.map((c) => c.name).sort(), ['Canasta', 'Magic']);
    assert.ok(found.find((c) => c.name === 'Canasta').href.includes('/builder/?g=cccccccc-0000-0000-0000-000000000003'));
    assert.deepEqual(await pg.evaluate(() => Object.keys(localStorage).filter((k) => k === 'magic-v1' || k.startsWith('builder-game-v1:'))), []);
    assert.deepEqual(pg.errors, []);
    await pg.close();
  });

  test('two Cribbage games at once, each by its own link', async () => {
    const pg = await phone();
    await open(pg, '/cribbage/');
    await startGame(pg);
    const first = await pg.evaluate(() => S.id);
    await pg.evaluate(() => { S.scores[0] = 6; S.log.push({ p: 0, kind: 'play', pts: 6, after: 6, hand: 1, label: 'x' }); save(); });
    assert.ok((await pg.evaluate(() => location.search)).includes(first), 'the address carries the game');

    await pg.reload({ waitUntil: 'domcontentloaded' }); await wait(900);
    assert.equal(await pg.evaluate(() => S && S.id), first, 'a reload stays in the game');

    await open(pg, '/cribbage/');
    await startGame(pg);
    const second = await pg.evaluate(() => S.id);
    assert.notEqual(second, first, 'starting another keeps the first');

    await open(pg, '/');
    const crib = (await cards(pg)).filter((c) => c.name === 'Cribbage');
    assert.equal(crib.length, 2);
    for (const c of crib) {
      await open(pg, c.href);
      const id = await pg.evaluate(() => S.id);
      assert.ok(c.href.includes(id), 'each card opens its own game');
    }
    assert.deepEqual(pg.errors, []);
    await pg.close();
  });

  test("a link to a game this phone doesn't have says so", async () => {
    const pg = await phone();
    await open(pg, '/yahtzee/?g=ffffffff-0000-0000-0000-00000000dead');
    // the note comes once the profile has been asked too, and passes after a few seconds
    await pg.waitForFunction(
      () => [...document.querySelectorAll('div[role=status]')].some((d) => /isn't on this device/.test(d.textContent)),
      { timeout: 20000 });
    assert.equal(await pg.evaluate(() => S), null);
    await pg.close();
  });
});
