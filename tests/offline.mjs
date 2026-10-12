/* Score Chalk as an app: the service worker keeps every game, so they open
   with no signal, a game in progress by its own link. */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { phone, open, startGame, wait, U } from './helpers.mjs';

describe('offline', () => {
  test('every game opens with no signal, and a game in progress by its link', async () => {
    const pg = await phone();
    await open(pg, '/');
    for (let k = 0; k < 30 && !(await pg.evaluate(() => !!navigator.serviceWorker.controller)); k++) {
      await wait(500);
      await pg.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
    }
    assert.equal(await pg.evaluate(() => !!navigator.serviceWorker.controller), true, 'the service worker takes over');
    await wait(3000);   // it fetches every page while installing

    await open(pg, '/yahtzee/');
    await startGame(pg);
    await pg.evaluate(() => { S.cells[0].sixes = 18; S.log.push({ p: 0, id: 'sixes', prev: null, v: 18, cur: 0, sel: 0 }); save(); });
    const link = await pg.evaluate(() => location.href);

    await pg.setOfflineMode(true);
    for (const path of ['/', '/darts/', '/cribbage/', '/magic/', '/builder/']) {
      await pg.goto(U + path, { waitUntil: 'load' });
      assert.match(await pg.evaluate(() => document.title), /Score Chalk/, path + ' opens offline');
    }
    await pg.goto(link, { waitUntil: 'load' }); await wait(1200);
    assert.equal(await pg.evaluate(() => S && S.cells[0].sixes), 18);
    await pg.setOfflineMode(false);
    await pg.close();
  });
});
