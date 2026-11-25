/* Cribbage by seat: a seated phone pegs its own player only, counts its own
   hand when it is up, and two phones pegging at once both land. */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { phone, open, startGame, share, join, settle, wait, U } from './helpers.mjs';

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

describe('Cribbage, as it leaves the phone', () => {
  test('a shared game carries the last 20 Undo steps; the phone keeps them all', async () => {
    const a = await phone();
    await open(a, '/cribbage/');
    await startGame(a);
    await a.evaluate(() => { for (let k = 0; k < 60; k++) score(k % 2, 1, 'play', 'Go'); save(); });
    const sh = await share(a);
    const shared = await (await fetch(`${U}/api/share/${sh.view}`)).json();
    assert.equal(shared.state.undo.length, 20);
    assert.equal(shared.state.log.length, 60, 'every score still goes');
    assert.equal(await a.evaluate(() => S.undo.length), 60, 'the phone keeps its whole Undo');
    await a.close();
  });
});

describe('Cribbage, choosing how to score', () => {
  test('Start Game asks how to score the play, then how to count, each saying it can be switched', async () => {
    const pg = await phone();
    await open(pg, '/cribbage/');
    await pg.click('#startBtn'); await wait(400);
    const screen = () => pg.evaluate(() => ({
      step: pickStep.textContent,
      opts: [...document.querySelectorAll('.pick-opt')].map((b) => b.dataset.mode + (b.classList.contains('is-current') ? '*' : '')),
      pictures: [...document.querySelectorAll('.pick-opt img')].every((i) => i.getAttribute('src').startsWith('previews/')),
      note: pickNote.textContent,
    }));
    let s = await screen();
    assert.deepEqual(s.opts, ['simple', 'detailed'], 'nothing marked: this phone has never chosen');
    assert.equal(s.step, '1 of 2');
    assert.ok(s.pictures);
    assert.match(s.note, /switch any time/);

    // Back goes back a step, and from the first to the setup
    await pg.click('.pick-opt[data-mode="simple"]'); await wait(300);
    s = await screen();
    assert.deepEqual([s.step, ...s.opts], ['2 of 2', 'cards', 'buttons']);
    await pg.click('#pickBack'); await wait(200);
    assert.equal((await screen()).step, '1 of 2');
    await pg.click('#pickBack'); await wait(200);
    assert.equal(await pg.evaluate(() => setup.classList.contains('hidden')), false);

    await pg.click('#startBtn'); await wait(300);
    assert.deepEqual((await screen()).opts, ['simple*', 'detailed'], 'last time marked');
    await pg.click('.pick-opt[data-mode="detailed"]'); await wait(300);
    await pg.click('.pick-opt[data-mode="buttons"]'); await wait(500);
    assert.deepEqual(await pg.evaluate(() => [playMode, handMode, game.classList.contains('hidden')]), ['detailed', 'buttons', false]);
    // and the game's own switches show the same
    assert.equal(await pg.evaluate(() => document.querySelector('#playModeRow .is-on').dataset.mode), 'detailed');
    assert.deepEqual(pg.errors, []);
    await pg.close();
  });
});
