/* Cribbage by seat: a seated phone pegs its own player only, counts its own
   hand when it is up, and two phones pegging at once both land. */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { phone, open, startGame, share, join, settle, wait } from './helpers.mjs';

const peg = (pg, p, pts) => pg.evaluate((p, pts) => { score(p, pts, 'play', 'test'); save(); render(); }, p, pts);

describe('Cribbage by seat', () => {
  test('the play: own pegging only, and pegging at once never clashes', async () => {
    const a = await phone(), b = await phone();
    await open(a, '/cribbage/');
    await startGame(a);
    const sh = await share(a);
    await join(b, 'cribbage', sh.join, 'Player 2');

    const locked = await b.evaluate(() => [...document.querySelectorAll('#players .pcol')].map((c) => c.classList.contains('locked')));
    assert.deepEqual(locked, [true, false], "the other player's pegging is greyed");
    await b.evaluate(() => peg(0, 'go', 'Go', 1));
    assert.equal(await b.evaluate(() => S.scores[0]), 0, "pegging the other player is refused");

    for (let k = 0; k < 3; k++) { await Promise.all([peg(a, 0, 1), peg(b, 1, 2)]); await wait(150); }
    await settle();
    assert.equal(await a.evaluate(() => S.scores.join('/')), '3/6');
    assert.equal(await b.evaluate(() => S.scores.join('/')), '3/6');
    for (const pg of [a, b]) { assert.deepEqual(pg.errors, []); await pg.close(); }
  });

  test('the count: a seated phone counts its own hand, and waits for the rest', async () => {
    const a = await phone(), b = await phone();
    await open(a, '/cribbage/');
    await startGame(a);
    const sh = await share(a);
    await join(b, 'cribbage', sh.join, 'Player 2');
    await a.click('#mainBtn');          // into the count
    await settle();
    assert.equal(await b.evaluate(() => document.getElementById('game').classList.contains('waiting')), false, "Player 2's hand is up first");
    await b.evaluate(() => { handMode = 'buttons'; S.pend.typed = 8; save(); render(); document.querySelector('.hand-submit').click(); });
    await settle();
    assert.equal(await b.evaluate(() => document.getElementById('game').classList.contains('waiting')), true);
    assert.match(await b.evaluate(() => document.querySelector('.hand-submit').textContent), /Waiting for Player 1's hand/);
    assert.equal(await a.evaluate(() => S.scores[1]), 8);
    await a.close(); await b.close();
  });
});
