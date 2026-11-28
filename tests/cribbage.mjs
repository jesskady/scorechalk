/* Cribbage by seat: a seated phone pegs its own player only, counts its own
   hand when it is up, and two phones pegging at once both land. */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { phone, open, startGame, share, join, settle, wait, U, editPress } from './helpers.mjs';

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
    assert.equal(await b.evaluate(() => play().scores[0]), 0, "pegging the other player is refused");

    for (let k = 0; k < 3; k++) { await Promise.all([peg(a, 0, 1), peg(b, 1, 2)]); await wait(150); }
    await settle();
    assert.equal(await a.evaluate(() => play().scores.join('/')), '3/6');
    assert.equal(await b.evaluate(() => play().scores.join('/')), '3/6');
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
    assert.equal(await a.evaluate(() => play().scores[1]), 8);
    await a.close(); await b.close();
  });
});

describe('Cribbage, as it leaves the phone', () => {
  test('a shared game is what was scored, all of it: no copies of the board for Undo', async () => {
    const a = await phone();
    await open(a, '/cribbage/');
    await startGame(a);
    await a.evaluate(() => { for (let k = 0; k < 60; k++) score(k % 2, 1, 'play', 'Go'); save(); });
    const sh = await share(a);
    const shared = await (await fetch(`${U}/api/share/${sh.view}`)).json();
    assert.equal(shared.state.log.length, 60, 'every score goes');
    assert.equal('undo' in shared.state, false, 'and nothing else to undo by: Undo takes the last score off');
    assert.deepEqual(shared.state.sum.scores, [30, 30]);
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

/* Cribbage as the other games keep a game: what was scored, in order, and
   everything else worked out from it (play()). So a game kept in the first
   shape opens as it was; a peg or a count is changed from History, the way
   it was scored, and the board follows; and 121 is offered, not declared. */
describe('Cribbage, worked out from what was scored', () => {
  const look = (pg) => pg.evaluate(() => { const g = play(); return { scores: g.scores, hand: g.hand, dealer: S.names[g.dealer], phase: g.phase, step: g.step }; });
  async function history(pg, text) {
    await pg.click('#editBtn'); await wait(300);
    await editPress(pg, 'History');
    await pg.evaluate((t) => [...document.querySelectorAll('.edit-history li.fix')].find((li) => li.textContent.includes(t)).click(), text);
    await wait(300);
  }
  // a key in a player's column, as a person taps it; '3' and '4' are both
  // under Of a kind and Run of, and `run` picks the run
  const key = (pg, p, text, run = false) => pg.evaluate((p, t, run) => {
    const ks = [...document.querySelectorAll('#players .pcol')[p].querySelectorAll('.pkey')].filter((k) => k.querySelector('b').textContent === t);
    (run ? ks[ks.length - 1] : ks[0]).click();
  }, p, text, run);
  async function newGame(pg) {
    await open(pg, '/cribbage/');
    await pg.evaluate(() => { setupNames = ['Ann', 'Bob', '']; setupN = 2; setupDealer = 0; playMode = 'detailed'; handMode = 'buttons'; beginGame(); });
    await wait(400);
  }
  const count = (pg, n) => pg.evaluate((n) => { S.pend.typed = n; render(); handSubmit.click(); }, n);

  test('a game kept in the first shape opens as it was', async () => {
    const pg = await phone();
    await open(pg, '/cribbage/');
    const id = await pg.evaluate(() => {
      const old = { id: crypto.randomUUID(), startedAt: Date.now(), names: ['Cy', 'Dee'], dealer: 1, firstDealer: 0, hand: 2, phase: 'count', step: 1,
        scores: [10, 14], prev: [2, 6], heels: false, pend: freshPend(), undo: ['{}'], over: false, winner: null, me: 0,
        log: [{ p: 1, pts: 2, kind: 'play', label: '15', hand: 1, after: 2 }, { p: 1, pts: 4, kind: 'hand', label: 'Hand', hand: 1, after: 6, typed: 4 },
          { p: 0, pts: 2, kind: 'hand', label: 'Hand', hand: 1, after: 2, typed: 2 }, { p: 0, pts: 0, kind: 'crib', label: 'Crib', hand: 1, after: 2, typed: 0 },
          { p: 0, pts: 8, kind: 'play', label: 'Pair', hand: 2, after: 10 }, { p: 1, pts: 8, kind: 'hand', label: 'Hand', hand: 2, after: 14, typed: 8 }] };
      SCStore.put('cribbage', old, false);
      return old.id;
    });
    await open(pg, `/cribbage/?g=${id}`);
    assert.deepEqual(await look(pg), { scores: [10, 14], hand: 2, dealer: 'Dee', phase: 'count', step: 1 });
    assert.equal(await pg.evaluate(() => 'undo' in S), false);
    assert.deepEqual(pg.errors, []);
    await pg.close();
  });

  test('a peg moved to whoever scored it, one removed, a hand counted again; Undo takes a change back', async () => {
    const pg = await phone();
    await newGame(pg);
    await key(pg, 1, '15');            // Bob 15: it was Ann's
    await key(pg, 0, 'Go');            // Ann go
    await history(pg, 'Bob');
    assert.match(await pg.$eval('#fixText', (x) => x.textContent), /Changing Bob's 15 · hand 1/);
    await key(pg, 0, '15');
    assert.deepEqual((await look(pg)).scores, [3, 0], 'the 15 is Ann’s');

    await history(pg, 'Go');
    await pg.click('#fixRemove'); await wait(200);
    assert.deepEqual((await look(pg)).scores, [2, 0], 'the go removed');

    // the count: Bob's hand was 10, not 8
    await pg.click('#mainBtn'); await wait(200);
    await count(pg, 8);
    await history(pg, 'hand');
    assert.match(await pg.$eval('#fixText', (x) => x.textContent), /Changing Bob's hand/);
    await count(pg, 10);
    assert.deepEqual(await look(pg), { scores: [2, 10], hand: 1, dealer: 'Ann', phase: 'count', step: 1 }, 'still Ann’s hand to count');

    await pg.click('#editBtn'); await wait(300);
    await editPress(pg, 'History');
    const lines = await pg.evaluate(() => [...document.querySelectorAll('.edit-history li')].slice(0, 3).map((li) => li.textContent));
    assert.match(lines[0], /hand changed.*\+8 → \+10/);
    await editPress(pg, 'Back'); await editPress(pg, 'Cancel');
    await pg.click('#undoBtn'); await wait(200);
    assert.deepEqual((await look(pg)).scores, [2, 8], 'Undo takes the change back');
    assert.deepEqual(pg.errors, []);
    await pg.close();
  });

  test('121 is offered: Undo takes it back, End game ends it, a change after opens it again', async () => {
    const pg = await phone();
    await newGame(pg);
    await pg.evaluate(() => { score(0, 115, 'play', 'Go'); save(); render(); });
    await key(pg, 0, '3', true);                        // a run of three: 118
    await key(pg, 0, '4', true);                        // and of four: 122
    const bar = () => pg.evaluate(() => [winBar.classList.contains('hidden'), winBarText.textContent, game.classList.contains('closed')]);
    assert.deepEqual(await bar(), [false, 'Ann reached 121!Undo if that wasn’t right.', true]);
    await key(pg, 1, 'Go');
    assert.deepEqual((await look(pg)).scores, [122, 0], 'the pegs wait');

    await pg.click('#undoBtn'); await wait(200);
    assert.deepEqual([(await look(pg)).scores, (await bar())[0]], [[118, 0], true]);
    await key(pg, 0, '4', true);
    await pg.click('#winBarBtn'); await wait(300);
    assert.deepEqual(await pg.evaluate(() => [S.over, S.winner, $('winName').textContent, !winOverlay.classList.contains('hidden')]), [true, 0, 'Ann wins!', true]);

    // in post: the run of four was a run of three, so 121 isn't reached
    await pg.click('#keepBtn'); await wait(200);
    await history(pg, 'Run of 4');
    await key(pg, 0, '3', true);
    assert.deepEqual(await pg.evaluate(() => [play().scores[0], S.over, S.winner, winOverlay.classList.contains('hidden')]), [121, true, 0, false],
      '115 + 3 + 3 is still 121: still over, the result shown again');
    await pg.click('#keepBtn'); await wait(200);
    await history(pg, 'Run of 3');
    await pg.click('#fixRemove'); await wait(200);
    assert.deepEqual(await pg.evaluate(() => [play().scores[0], S.over, play().winner]), [118, false, null], 'open again');
    assert.deepEqual(pg.errors, []);
    await pg.close();
  });
});
