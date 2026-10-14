/* Tournaments: a round robin of darts, each match a game of its own, and the
   standings read back from those games. */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { phone, open, wait } from './helpers.mjs';

// The players step, each name typed and entered.
async function addPlayers(pg, names) {
  for (const n of names) { await pg.type('#addName', n); await pg.keyboard.press('Enter'); }
}

// Set up a tournament of these players, 301 double out, walking the steps
// by Next as a person would.
async function setUp(pg, names) {
  await open(pg, '/tournament/');
  await pg.type('#tName', 'Friday darts');
  await pg.click('#presets [data-score="301"]');
  await pg.click('#doubleOut');
  await pg.click('#nextBtn');
  await addPlayers(pg, names);
  await pg.click('#nextBtn');
  await pg.click('#startBtn');
  await wait(400);
}

const matches = (pg) => pg.$$eval('.match', (ms) => ms.map((m) => m.textContent));
const table = (pg) => pg.$$eval('#standings tr', (rs) => rs.map((r) => [...r.cells].map((c) => c.textContent)));

// Win the darts game on screen for player `p` (0 or 1): leave them on 40,
// then D20 and submit, as a person would throw it.
async function win(pg, p) {
  await pg.evaluate((p) => { S.cur = p; S.players[p].score = 40; S.players[p].points = 301 - 40; S.players[p].turns = 5; save(); render(); }, p);
  await pg.click('.mult[data-m="2"]');
  await pg.evaluate(() => [...document.querySelectorAll('#numgrid .key')].find((b) => b.textContent === '20').click());
  await pg.click('#submitBtn');
  await wait(400);
}

describe('tournaments', () => {
  test('a round robin is drawn: every pair once, one sitting out a round when odd', async () => {
    const pg = await phone();
    await setUp(pg, ['Alice', 'Bob', 'Cal', 'Dee', 'Eve']);
    const T = await pg.evaluate(() => T);
    assert.equal(T.matches.length, 10);
    assert.equal(new Set(T.matches.map((m) => m.round)).size, 5);
    const pairs = new Set(T.matches.map((m) => [m.a, m.b].sort().join('-')));
    assert.equal(pairs.size, 10, 'no pair meets twice');
    for (let r = 1; r <= 5; r++) {
      const ps = T.matches.filter((m) => m.round === r).flatMap((m) => [m.a, m.b]);
      assert.equal(new Set(ps).size, 4, `round ${r}: four play, one sits out`);
    }
    assert.equal((await pg.$$('.round h3 small')).length, 5);
    assert.deepEqual(pg.errors, []);
    await pg.close();
  });

  test('formats: everyone twice, short, and fewer boards', async () => {
    const pg = await phone();
    await open(pg, '/tournament/');
    const shape = (n, f) => pg.evaluate((n, f) => {
      const ms = draw(n, f);
      const rounds = [...new Set(ms.map((m) => m.round))].map((r) => ms.filter((m) => m.round === r));
      const pairs = {};
      ms.forEach((m) => { const k = [m.a, m.b].sort().join('-'); (pairs[k] = pairs[k] || []).push([m.a, m.b]); });
      const each = [...Array(n).keys()].map((i) => ms.filter((m) => m.a === i || m.b === i).length);
      return {
        matches: ms.length, rounds: rounds.length,
        biggest: Math.max(...rounds.map((r) => r.length)),
        clash: rounds.some((r) => new Set(r.flatMap((m) => [m.a, m.b])).size < r.length * 2),
        meetings: [...new Set(Object.values(pairs).map((p) => p.length))],
        swapped: Object.values(pairs).every((p) => p.length < 2 || (p[0][0] === p[1][1] && p[0][1] === p[1][0])),
        lo: Math.min(...each), hi: Math.max(...each),
      };
    }, n, f);

    const once = await shape(7, {});
    assert.deepEqual([once.matches, once.rounds, once.biggest, once.clash], [21, 7, 3, false]);

    const twice = await shape(4, { meet: 2 });
    assert.deepEqual([twice.matches, twice.rounds, twice.meetings, twice.swapped], [12, 6, [2], true]);

    const shortEven = await shape(6, { short: 3 });
    assert.deepEqual([shortEven.matches, shortEven.lo, shortEven.hi, shortEven.meetings], [9, 3, 3, [1]]);
    const shortOdd = await shape(7, { short: 3 });
    assert.deepEqual([shortOdd.matches, shortOdd.lo, shortOdd.hi], [9, 2, 3]);

    const oneBoard = await shape(7, { boards: 1 });
    assert.deepEqual([oneBoard.matches, oneBoard.rounds, oneBoard.biggest, oneBoard.meetings], [21, 21, 1, [1]]);
    const twoBoards = await shape(7, { boards: 2 });
    assert.deepEqual([twoBoards.matches, twoBoards.biggest, twoBoards.clash, twoBoards.meetings], [21, 2, false, [1]]);
    assert.ok(twoBoards.rounds >= 11 && twoBoards.rounds <= 12, `${twoBoards.rounds} rounds of two`);

    // chosen on the setup screen, and played to
    // the steps: one on screen at a time, the tabs going to any
    const shown = () => pg.$$eval('#setup .step', (ss) => ss.filter((s) => !s.classList.contains('hidden')).map((s) => s.dataset.step));
    assert.deepEqual(await shown(), ['game']);
    assert.equal(await pg.$eval('#nextBtn', (b) => b.textContent), 'Next: Players');
    await pg.click('#stages [data-step="players"]');
    assert.deepEqual(await shown(), ['players']);
    await addPlayers(pg, ['Alice', 'Bob', 'Cal', 'Dee', 'Eve', 'Fay', 'Gus']);
    // numbered as they go in, the next number waiting
    assert.deepEqual(await pg.$$eval('#players li', (ls) => ls.map((l) => l.querySelector('i').textContent + l.querySelector('span').textContent)),
      ['1.Alice', '2.Bob', '3.Cal', '4.Dee', '5.Eve', '6.Fay', '7.Gus']);
    assert.equal(await pg.$eval('#addNum', (i) => i.textContent), '8.');
    assert.equal(await pg.$eval('#playersTab', (b) => b.textContent), '7');
    await pg.click('#nextBtn');
    assert.deepEqual(await shown(), ['format']);
    assert.equal(await pg.$eval('#nextBtn', (b) => b.classList.contains('hidden')), true);
    assert.equal(await pg.$eval('#count', (p) => p.textContent), '21 matches · 6 each · 7 rounds of 3');
    await pg.click('#meetRow [data-f="twice"]');
    assert.equal(await pg.$eval('#count', (p) => p.textContent), '42 matches · 12 each · 14 rounds of 3');
    await pg.click('#meetRow [data-f="short"]');
    await pg.click('#shortLess');
    assert.equal(await pg.$eval('#shortN', (b) => b.textContent), '3');
    await pg.click('#boardRow [data-b="1"]');
    assert.equal(await pg.$eval('#count', (p) => p.textContent), '9 matches · 2–3 each · one at a time');
    await pg.click('#startBtn'); await wait(400);
    assert.equal(await pg.evaluate(() => T.matches.length), 9);
    assert.match(await pg.$eval('#tSub', (p) => p.textContent), /short, 3 each/);
    assert.deepEqual(pg.errors, []);
    await pg.close();
  });

  test('a match is played in darts, and its result comes back to the table', async () => {
    const pg = await phone();
    await setUp(pg, ['Alice', 'Bob', 'Cal']);
    const tid = await pg.evaluate(() => T.id);
    const first = await pg.evaluate(() => T.matches[0]);
    const [A, B] = await pg.evaluate((m) => [T.players[m.a], T.players[m.b]], first);

    // Play: darts' setup, filled in from the tournament
    await pg.click('.match');
    await pg.click('#mPlay');
    await pg.waitForSelector('#startBtn', { visible: true }); await wait(700);
    assert.deepEqual(await pg.evaluate(() => [$('name1').value, $('name2').value, $('startScore').value,
      $('doubleOut').classList.contains('is-on'), $('doubleIn').classList.contains('is-on')]), [A, B, '301', true, false]);
    assert.equal(await pg.$eval('#setupBack', (a) => a.textContent.trim()), '‹ Tournament');
    assert.equal(await pg.$eval('#tourneyLink', (a) => a.classList.contains('hidden')), true, 'no tournament link inside a match');
    await pg.click('#startBtn'); await wait(500);
    assert.equal(await pg.evaluate(() => S.tid), tid);

    // left mid-match, it shows as in progress
    await pg.click('#gameBack'); await wait(900);
    assert.match((await matches(pg))[0], /in progress/);

    // back in, and the second player wins it
    await pg.click('.match'); await pg.click('#mPlay'); await wait(900);
    await win(pg, 1);
    assert.equal(await pg.$eval('#rematchBtn', (b) => b.textContent), 'Back to tournament');
    await pg.click('#rematchBtn'); await wait(900);

    assert.equal(await pg.evaluate(() => location.pathname + location.search), '/tournament/?g=' + tid);
    assert.match((await matches(pg))[0], new RegExp(`✓ ${B}`));
    const top = (await table(pg))[0];
    assert.equal(top[1], B);
    assert.deepEqual(top.slice(2, 5), ['1', '1', '0']);
    assert.equal(top[5], '50.2', 'three-dart average: 301 in six turns');
    assert.deepEqual(pg.errors, []);
    await pg.close();
  });

  test('an undo in the game undoes the result; a result set by hand; the champion', async () => {
    const pg = await phone();
    await setUp(pg, ['Alice', 'Bob', 'Cal']);
    const tid = await pg.evaluate(() => T.id);

    await pg.click('.match'); await pg.click('#mPlay'); await wait(900);
    await pg.click('#startBtn'); await wait(500);
    await win(pg, 0);
    await pg.evaluate(() => $('winOverlay').classList.add('hidden'));
    await pg.click('#undoTurn'); await wait(300); await pg.click('#confirmYes'); await wait(300);
    await pg.click('#gameBack'); await wait(900);
    assert.match((await matches(pg))[0], /in progress/, 'undone in darts, open again here');

    // the rest set by hand, each to the first player named
    for (let i = 0; i < 3; i++) {
      await pg.evaluate((i) => document.querySelectorAll('.match')[i].click(), i);
      await pg.click('#mWinA'); await wait(200);
    }
    assert.equal(await pg.evaluate(() => T.over), true);
    assert.equal(await pg.$eval('#champ', (c) => c.classList.contains('hidden')), false);
    // the champion is whoever tops the table, or all level at the top
    const rows = await table(pg);
    const top = rows.filter((r) => r[3] === rows[0][3] && r[5] === rows[0][5]);
    const champ = await pg.$eval('#champName', (h) => h.textContent);
    assert.equal(champ, top.length === 1 ? `${top[0][1]} wins!` : champ);
    if (top.length > 1) assert.match(champ, /share it/);

    // over, it leaves Pick up where you left off; going, it is listed there
    await open(pg, '/');
    assert.equal(await pg.$$eval('#resumeRow .rc', (as, tid) => as.filter((a) => a.href.includes(tid)).length, tid), 0);
    assert.deepEqual(pg.errors, []);
    await pg.close();
  });

  test('from the darts setup, a darts tournament', async () => {
    const pg = await phone();
    await open(pg, '/darts/');
    await Promise.all([pg.waitForNavigation({ waitUntil: 'domcontentloaded' }), pg.click('#tourneyLink')]);
    await wait(700);
    assert.equal(await pg.evaluate(() => location.pathname + location.search), '/tournament/?game=darts');
    assert.equal(await pg.$eval('#tGame', (s) => s.value), 'darts');
    assert.deepEqual(pg.errors, []);
    await pg.close();
  });

  test('a tournament going is on the home page', async () => {
    const pg = await phone();
    await setUp(pg, ['Alice', 'Bob', 'Cal', 'Dee']);
    const tid = await pg.evaluate(() => T.id);
    await open(pg, '/');
    const card = await pg.$$eval('#resumeRow .rc', (as, tid) => as.filter((a) => a.href.includes(tid)).map((a) => a.textContent), tid);
    assert.deepEqual(card, ['Friday dartsDarts · 0 of 6 played']);
    assert.deepEqual(pg.errors, []);
    await pg.close();
  });
});
