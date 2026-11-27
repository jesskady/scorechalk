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
    await pg.evaluate(() => { score(0, 6, 'play', 'x'); save(); });
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

  test('every game is on the all-games page, and the search narrows it', async () => {
    const pg = await phone();
    await open(pg, '/');
    await pg.click('.parlor .see-all');
    await pg.waitForSelector('#q');
    assert.equal(new URL(pg.url()).pathname, '/games/');
    const shown = () => pg.$$eval('#list li:not([hidden]) b', (bs) => bs.map((b) => b.textContent));
    const all = await shown();
    assert.ok(all.length >= 13, 'every game, and the Builder');
    // each card on the home page has its row here
    await open(pg, '/');
    const home = await pg.$$eval('.shelf a', (as) => as.map((a) => a.getAttribute('href')));
    await open(pg, '/games/');
    const rows = await pg.$$eval('#list a', (as) => as.map((a) => a.getAttribute('href')));
    for (const h of home) assert.ok(rows.includes(h), `${h} is on /games/`);
    // a phone's width, with no sideways scroll
    assert.ok(await pg.evaluate(() => document.documentElement.scrollWidth <= innerWidth));

    await pg.type('#q', 'dice');
    assert.deepEqual(await shown(), ['Farkle', 'Yahtzee', 'Any other game']);
    assert.match(await pg.$eval('#count', (e) => e.textContent), /2 of \d+ games/);
    await pg.click('#q', { clickCount: 3 }); await pg.type('#q', 'nothing like it');
    assert.deepEqual(await shown(), ['Any other game'], 'the Builder is always offered');
    assert.equal(await pg.$eval('#none', (e) => e.hidden), false);
    // the search is kept in the address, and Enter opens a single match
    await open(pg, '/games/?q=moon');
    assert.deepEqual(await shown(), ['Hearts', 'Any other game']);
    await Promise.all([pg.waitForNavigation(), pg.focus('#q').then(() => pg.keyboard.press('Enter'))]);
    assert.ok(pg.url().endsWith('/builder/#hearts'));
    // and the game leads back to the list, under the badge that goes home
    await pg.waitForSelector('#setup .crumb', { visible: true });
    await Promise.all([pg.waitForNavigation(), pg.click('#setup .crumb')]);
    assert.equal(new URL(pg.url()).pathname, '/games/');
    // but only for whoever came from the list: not straight in, nor from home
    await open(pg, '/darts/');
    assert.equal(await pg.$eval('#setup .crumb', (a) => a.hidden), true);
    await open(pg, '/');
    await Promise.all([pg.waitForNavigation(), pg.click('.shelf a[href="/yahtzee/"]')]);
    assert.equal(await pg.$eval('#setup .crumb', (a) => a.hidden), true);
    assert.deepEqual(pg.errors, []);
    await pg.close();
  });
});
