/* Darts shared by seat: a seated phone waits for its own turn, keeps darts
   entered mid-turn when another turn comes in, and sees the game won. */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { phone, open, startGame, share, join, settle } from './helpers.mjs';

const look = (pg) => pg.evaluate(() => ({
  up: S.players[S.cur].name,
  waiting: document.getElementById('game').classList.contains('waiting'),
  scores: S.players.map((p) => p.score).join('/'),
}));
const turn = (pg, ...nums) => pg.evaluate((nums) => { for (const n of nums) addDart(n); submitTurn(); }, nums);

describe('Darts by seat', () => {
  test('turns go round the table, each phone waiting for its own', async () => {
    const a = await phone(), b = await phone();
    await open(a, '/darts/');
    await a.evaluate(() => { $('startScore').value = '101'; });
    await startGame(a);
    const sh = await share(a);
    await join(b, 'darts', sh.join, 'Player 2');

    assert.deepEqual(await look(b), { up: 'Player 1', waiting: true, scores: '101/101' });
    await b.evaluate(() => addDart(20));
    assert.equal(await b.evaluate(() => S.darts.length), 0, 'no darts while waiting');

    await turn(a, 20, 20, 20);
    await settle();
    assert.deepEqual(await look(b), { up: 'Player 2', waiting: false, scores: '41/101' });

    // mid-turn darts survive another turn arriving
    await b.evaluate(() => { addDart(5); addDart(5); });
    await a.evaluate(() => { S.cur = 0; });
    await turn(a, 1, 1, 1);
    await settle();
    assert.equal(await b.evaluate(() => S.darts.map((d) => d.label).join(' ')), '5 5');

    // Player 1 checks out on the other phone, 38 then 20 then out: the game
    // is over here too (each phone works the scores out from the turns)
    await a.evaluate(() => { S.cur = 0; S.doubleOut = false; });
    await turn(a, 18, 0, 0);
    await a.evaluate(() => { S.cur = 0; });
    await turn(a, 20);
    await settle();
    assert.equal(await b.evaluate(() => S.over), true);
    assert.equal(await b.evaluate(() => !document.getElementById('winOverlay').classList.contains('hidden')), true);
    for (const pg of [a, b]) { assert.deepEqual(pg.errors, []); await pg.close(); }
  });
});
