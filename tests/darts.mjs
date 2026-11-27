/* Darts shared by seat: a seated phone waits for its own turn, keeps darts
   entered mid-turn when another turn comes in, and is offered the checkout
   made on another phone, as that phone is. */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { phone, open, startGame, share, join, settle, wait, editPress } from './helpers.mjs';

const look = (pg) => pg.evaluate(() => ({
  up: S.names[S.cur],
  waiting: document.getElementById('game').classList.contains('waiting'),
  scores: play().players.map((p) => p.score).join('/'),
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

    // Player 1 checks out on the other phone, 38 then 20 then out: the
    // checkout is offered here too (each phone works the scores out from
    // the turns), and End game shows who won
    await a.evaluate(() => { S.cur = 0; S.doubleOut = false; });
    await turn(a, 18, 0, 0);
    await a.evaluate(() => { S.cur = 0; });
    await turn(a, 20);
    await settle();
    assert.deepEqual(await b.evaluate(() => [play().winner, S.over, !winBar.classList.contains('hidden')]), [0, false, true]);
    await b.click('#winBarBtn'); await wait(300);
    assert.equal(await b.evaluate(() => S.over), true);
    assert.equal(await b.evaluate(() => !document.getElementById('winOverlay').classList.contains('hidden')), true);
    for (const pg of [a, b]) { assert.deepEqual(pg.errors, []); await pg.close(); }
  });
});

/* Darts as the other games keep a game: the turns as thrown, and everything
   else worked out from them (play()). So a game kept in darts' first shape
   opens as it was, a turn can be changed from History and the rest of the
   game follows, and a checkout is offered, not declared. */
describe('Darts, worked out from its turns', () => {
  // Darts as a person taps them: the multiplier, then the number.
  async function tap(pg, darts) {
    for (const d of darts) {
      const [m, n] = d === 'bull' ? [1, 'Bull 25'] : [{ S: 1, D: 2, T: 3 }[d[0]], d.slice(1)];
      if (m > 1) await pg.click(`.mult[data-m="${m}"]`);
      await pg.evaluate((n) => [...document.querySelectorAll('#numgrid .key, .special-row .key')].find((b) => b.textContent === n).click(), String(n));
    }
  }
  const scores = (pg) => pg.evaluate(() => play().players.map((p) => p.score));
  async function changeTurn(pg, rowText, darts) {
    await pg.click('#editBtn'); await wait(300);
    await editPress(pg, 'History');
    await pg.evaluate((t) => [...document.querySelectorAll('.edit-history li.fix')].find((li) => li.textContent.includes(t)).click(), rowText);
    await wait(300);
    while (await pg.evaluate(() => S.darts.length)) { await pg.click('#undoDart'); }
    await tap(pg, darts);
    await pg.click('#submitBtn'); await wait(300);
  }

  test('a game kept in the first shape opens as it was', async () => {
    const pg = await phone();
    await open(pg, '/darts/');
    const id = await pg.evaluate(() => {
      const d = (label, val, dbl = false) => ({ label, val, dbl });
      const old = {
        id: crypto.randomUUID(), startedAt: Date.now(), meIdx: 1, start: 101, doubleIn: false, doubleOut: false,
        players: [{ name: 'Ann', score: 41, points: 60, turns: 2, opened: true }, { name: 'Bob', score: 101, points: 0, turns: 1, opened: true }],
        cur: 1, darts: [], mult: 1, over: false,
        log: [
          { player: 0, before: 101, wasOpen: true, pts: 60, bust: false, darts: [d('T20', 60)] },
          { player: 1, before: 101, wasOpen: true, pts: 0, bust: true, darts: [d('T20', 60), d('T20', 60)] },   // over: the rules' bust
          { player: 0, before: 41, wasOpen: true, pts: 0, bust: true, darts: [d('5', 5)] },                    // marked bust by hand
        ],
      };
      SCStore.put('darts', old, false);
      return old.id;
    });
    await open(pg, `/darts/?g=${id}`);
    assert.deepEqual(await pg.evaluate(() => [S.names, S.me, S.log.map((e) => !!e.bust)]), [['Ann', 'Bob'], 1, [false, false, true]]);
    assert.deepEqual(await scores(pg), [41, 101]);
    assert.equal(await pg.evaluate(() => S.names[S.cur]), 'Bob');
    assert.deepEqual(pg.errors, []);
    await pg.close();
  });

  test('a turn changed from History: a later turn busts, or the change checks out; Undo takes it back', async () => {
    const pg = await phone();
    await open(pg, '/darts/');
    await pg.evaluate(() => openGame(newGame(['Ann', 'Bob'], 101, {})));
    await wait(300);
    const turn = async (darts) => { await tap(pg, darts); await pg.click('#submitBtn'); await wait(200); };
    await turn(['T20']);      // Ann 41
    await turn(['S1']);       // Bob 100
    await turn(['S20']);      // Ann 21
    await turn(['S1']);       // Bob 99
    assert.deepEqual(await scores(pg), [21, 99]);

    // Ann's first was T20 25: 16 left, so her 20 after it is over, a bust
    await changeTurn(pg, 'T20', ['T20', 'bull']);
    assert.deepEqual(await scores(pg), [16, 99]);
    assert.equal(await pg.evaluate(() => play().turns[2].bust), true);
    assert.equal(await pg.evaluate(() => S.names[S.cur]), 'Ann', 'still her turn: a change is no turn');
    // the history keeps the change
    await pg.click('#editBtn'); await wait(300);
    await editPress(pg, 'History');
    assert.match(await pg.evaluate(() => document.querySelector('.edit-history li').textContent), /turn 1 changed.*T20 → T20 25/);
    await editPress(pg, 'Back'); await editPress(pg, 'Cancel');

    // Undo takes the change back
    await pg.click('#undoTurn'); await wait(300); await pg.click('#confirmYes'); await wait(300);
    assert.deepEqual(await scores(pg), [21, 99]);

    // and a change that makes a later turn the checkout: offered, then ended
    await changeTurn(pg, 'T20', ['T20', 'S20', 'S1']);       // 81: 20 left, and her 20 after it is out
    assert.deepEqual(await scores(pg), [0, 99]);
    assert.deepEqual(await pg.evaluate(() => [play().winner, S.over, !winBar.classList.contains('hidden')]), [0, false, true]);
    await pg.click('#winBarBtn'); await wait(300);
    assert.deepEqual(await pg.evaluate(() => [S.over, S.winner, toPayload().winner_idx, !winOverlay.classList.contains('hidden')]), [true, 0, 0, true]);
    assert.deepEqual(pg.errors, []);
    await pg.close();
  });

  test('a checkout is offered: Undo takes it back, End game ends it', async () => {
    const pg = await phone();
    await open(pg, '/darts/');
    await pg.evaluate(() => openGame(newGame(['Ann', 'Bob'], 40, { doubleOut: true })));
    await wait(300);
    await tap(pg, ['D20']);
    await pg.click('#submitBtn'); await wait(300);
    assert.deepEqual(await pg.evaluate(() => [winBar.classList.contains('hidden'), winBarText.textContent, game.classList.contains('closed')]),
      [false, 'Ann checked out!Undo if that wasn’t the finish.', true]);
    await pg.click('#undoTurn'); await wait(300); await pg.click('#confirmYes'); await wait(300);
    assert.deepEqual(await pg.evaluate(() => [winBar.classList.contains('hidden'), S.names[S.cur], play().players[0].score]), [true, 'Ann', 40]);
    await tap(pg, ['D20']);
    await pg.click('#submitBtn'); await wait(300);
    await pg.click('#winBarBtn'); await wait(300);
    assert.equal(await pg.$eval('#winName', (h) => h.textContent), 'Ann wins!');
    assert.deepEqual(pg.errors, []);
    await pg.close();
  });
});
