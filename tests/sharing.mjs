/* Sharing by link: joining as a player, scoring only your own, scoring at
   the same moment, the same score from two phones, and watching. */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { phone, open, startGame, share, join, press, settle, wait, api, linksReady } from './helpers.mjs';

async function builderGame(pg, names) {
  await open(pg, '/builder/');
  await pg.evaluate((n) => { Object.assign(cfg, { mode: 'up', start: 0, win: 'none', turns: true, useRounds: false, names: n, players: n.length }); saveCfg(); renderSetup(); }, names);
  await startGame(pg);
}
const scores = (pg) => pg.evaluate(() => S.scores.join('/'));
const openCells = (pg) => pg.evaluate(() => [...document.querySelectorAll('#sheet .cell.open')].map((c) => S.cfg.names[c.dataset.p]));
const notes = (pg) => pg.evaluate(() => [...document.querySelectorAll('div[role=status]')].map((d) => d.textContent).join(' | '));

async function scoreCell(pg, player, v) {
  await pg.evaluate((p) => document.querySelector(`#sheet button.cell.open[data-p="${p}"]`).click(), player);
  await wait(250);
  await pg.type('#typedIn', String(v));
  await pg.click('#typedAdd');
  await pg.click('#commitBtn');
  await wait(300);
}

describe('sharing the Builder by seat', () => {
  test('the author is Jess; Heather joins, scores only Heather, and both score at once', async () => {
    const jess = await phone(), heather = await phone(), watcher = await phone();
    await builderGame(jess, ['Jess', 'Heather']);
    const sh = await share(jess);
    assert.equal(sh.seat, 0, 'the player chosen at setup is taken for the author');

    await open(heather, `/builder/?s=${sh.join}`);
    await heather.waitForFunction(() => !!document.querySelector('.sc-share-ui button'), { timeout: 20000 });
    const picker = await heather.evaluate(() => [...document.querySelectorAll('.sc-share-ui button')].map((b) => b.textContent + (b.disabled ? ' (off)' : '')));
    assert.deepEqual(picker, ['Jess · taken (off)', 'Heather', 'Just watch']);
    await press(heather, 'Heather'); await wait(1200);
    assert.deepEqual(await openCells(heather), ['Heather'], 'a seated phone sees + only in its own cells');

    await Promise.all([scoreCell(jess, 0, 10), scoreCell(heather, 1, 20)]);
    await settle();
    assert.equal(await scores(jess), '10/20');
    assert.equal(await scores(heather), '10/20');
    assert.equal(await notes(jess), '', 'no clash');

    await open(watcher, `/builder/?s=${sh.view}`);
    assert.equal(await watcher.evaluate(() => !!window.SCWatching), true);
    assert.equal(await scores(watcher), '10/20');
    await watcher.evaluate(() => { const c = document.querySelector('#sheet button.cell'); if (c) c.click(); });
    await wait(200);
    assert.equal(await watcher.evaluate(() => entryOverlay.classList.contains('hidden')), true, 'a watcher can change nothing');

    for (const pg of [jess, heather, watcher]) { assert.deepEqual(pg.errors, []); await pg.close(); }
  });

  test('the author limits themselves from the game screen', async () => {
    const jess = await phone();
    await builderGame(jess, ['Jess', 'Heather']);
    await share(jess);
    assert.deepEqual(await openCells(jess), ['Jess', 'Heather']);
    await jess.evaluate(() => [...document.querySelectorAll('.sc-edit-slot button')].find((b) => b.textContent.startsWith('Only')).click());
    await wait(300);
    assert.deepEqual(await openCells(jess), ['Jess']);
    await jess.close();
  });

  test('the same score from two phones: the second gives way, and says so', async () => {
    const jess = await phone(), heather = await phone();
    await builderGame(jess, ['Jess', 'Heather']);
    await jess.evaluate(() => { S.cur = 1; S.pend = 20; commit(20); });
    const sh = await share(jess);
    await join(heather, 'builder', sh.join, 'Heather');
    // Heather won't hear of the author's change before making her own
    await heather.evaluate(() => { const st = SCStore.get(S.id); st.share.seq = 9999; SCStore.setShare(S.id, st.share); });
    await api(`/api/share/${sh.edit}/cells`, 'PUT', { cells: [{ key: '1:1', value: { d: 30, parts: [] }, base: 1 }] });
    await heather.click('#sheet button.cell[data-p="1"][data-r="1"]'); await wait(300);
    await heather.click('#clearBtn'); await heather.type('#typedIn', '40'); await heather.click('#typedAdd');
    await heather.click('#commitBtn'); await wait(300);
    await heather.click('#confirmYes'); await wait(2500);
    assert.equal(await scores(heather), '0/30');
    assert.match(await notes(heather), /same score at the same moment/);
    await jess.close(); await heather.close();
  });

  test('after a link goes out, Done asks once whether to score only your own', async () => {
    const jess = await phone();
    await builderGame(jess, ['Jess', 'Heather']);
    await jess.click('#shareBtn');
    await linksReady(jess);
    await jess.evaluate(() => [...document.querySelectorAll('.sc-share-ui button')].find((b) => b.textContent === 'Copy link').click());
    await wait(300);
    await press(jess, 'Done');
    await jess.waitForFunction(() => document.querySelector('.sc-share-ui h2')?.textContent === 'Score only for Jess?', { timeout: 5000 });
    await press(jess, 'Only Jess'); await wait(400);
    assert.deepEqual(await openCells(jess), ['Jess']);
    await jess.close();
  });
});

describe('sharing Yahtzee by seat', () => {
  test('each player fills their own boxes, at the same moment', async () => {
    const a = await phone(), b = await phone();
    await open(a, '/yahtzee/');
    await startGame(a);
    const sh = await share(a);
    await join(b, 'yahtzee', sh.join, 'Player 2');
    const fill = async (pg, p, id, pick) => {
      await pg.evaluate((p, id) => document.querySelector(`#sheet button.cell[data-p="${p}"][data-id="${id}"]`).click(), p, id);
      await wait(250);
      await pg.evaluate((t) => [...document.querySelectorAll('#entryBody .choice')].find((c) => c.textContent === t).click(), pick);
      await wait(250);
    };
    await Promise.all([fill(a, 0, 'sixes', '18'), fill(b, 1, 'fives', '15')]);
    await settle();
    for (const pg of [a, b]) assert.equal(await pg.evaluate(() => JSON.stringify(S.cells)), '[{"sixes":18},{"fives":15}]');
    await a.close(); await b.close();
  });
});

describe('guests, when the game ends', () => {
  test('whoever joined or watched is offered a game of their own; the author is not', async () => {
    const jess = await phone(), heather = await phone(), watcher = await phone();
    await open(jess, '/builder/');
    await jess.evaluate(() => { Object.assign(cfg, { mode: 'up', start: 0, win: 'target', target: 20, turns: true, useRounds: false, names: ['Jess', 'Heather'], players: 2 }); saveCfg(); renderSetup(); });
    await startGame(jess);
    const sh = await share(jess);
    await join(heather, 'builder', sh.join, 'Heather');
    await open(watcher, `/builder/?s=${sh.view}`);

    await scoreCell(heather, 1, 5);
    await settle();
    await scoreCell(jess, 0, 25);          // the round complete, Jess over the line: the game is won
    await settle();

    const offer = (pg) => pg.evaluate(() => {
      const a = document.querySelector('#winOverlay:not(.hidden) .sc-invite a');
      return a ? a.getAttribute('href') : null;
    });
    assert.equal(await offer(heather), '/builder/?from=shared');
    assert.equal(await offer(watcher), '/builder/?from=shared');
    assert.equal(await jess.evaluate(() => !document.getElementById('winOverlay').classList.contains('hidden')), true, 'the author sees the win…');
    assert.equal(await offer(jess), null, '…but no offer');
    for (const pg of [jess, heather, watcher]) { assert.deepEqual(pg.errors, []); await pg.close(); }
  });
});
