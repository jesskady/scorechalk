/* The Worker on its own: who may write to a shared game, the card a link
   to one shows, error reports, and the daily job. */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { api, U } from './helpers.mjs';

const ogTitle = async (path) => ((await (await fetch(U + path)).text()).match(/og:title" content="([^"]+)/) || [])[1];

describe('the server', () => {
  test('only the right links can write, and a seat only its own player', async () => {
    const id = crypto.randomUUID();
    const state = { id, cfg: { names: ['Ann', 'Bob'], start: 0 }, log: [], scores: [0, 0] };
    const made = await api('/api/share', 'POST', { id, type: 'builder', state, mode: 'cells', cells: {} });
    assert.equal(made.status, 200);
    assert.equal((await api('/api/share', 'POST', { id, type: 'builder', state, mode: 'cells', cells: {} })).status, 409,
      "the game's id alone hands out nothing");

    const bob = await api(`/api/share/${made.data.join}/seat`, 'POST', { seat: 1 });
    assert.equal(bob.status, 200);
    assert.equal((await api(`/api/share/${made.data.join}/seat`, 'POST', { seat: 1 })).status, 409, 'a seat is taken once');

    const write = (t, key) => api(`/api/share/${t}/cells`, 'PUT', { cells: [{ key, value: { d: 5 }, base: 0 }] });
    assert.equal((await write(bob.data.token, '1:1')).status, 200);
    assert.equal((await write(bob.data.token, '0:1')).status, 403, "a seat can't write another player");
    assert.equal((await write(made.data.view, '1:2')).status, 403, "the watch link can't write");
    assert.equal((await write(made.data.join, '1:2')).status, 403, "the join link can't write");
    assert.equal((await api(`/api/share/${made.data.join}/seat/1`, 'DELETE')).status, 404, 'only the author frees a seat');
  });

  test('a shared game has a size limit, and Turnstile is off until it has keys', async () => {
    const id = crypto.randomUUID();
    const big = { id, names: ['A', 'B'], padding: 'x'.repeat(33 * 1024) };
    assert.equal((await api('/api/share', 'POST', { id, type: 'magic', state: big })).status, 400, 'over 32 KB is refused');
    const fits = { id, names: ['A', 'B'], padding: 'x'.repeat(20 * 1024) };
    assert.equal((await api('/api/share', 'POST', { id, type: 'magic', state: fits })).status, 200, 'a long real game fits');
    assert.deepEqual((await api('/api/share/check')).data, { siteKey: null });
  });

  test('a link to a shared game shows who is playing', async () => {
    const id = crypto.randomUUID();
    const made = await api('/api/share', 'POST', { id, type: 'cribbage', state: { id, names: ['Jess', 'Heather'] }, seats: true });
    assert.equal(await ogTitle(`/cribbage/?s=${made.data.view}`), "Watch Jess and Heather's Cribbage game");
    assert.equal(await ogTitle(`/cribbage/?s=${made.data.join}`), "Join Jess and Heather's Cribbage game");
    assert.equal(await ogTitle('/cribbage/'), 'Cribbage · Score Chalk');
    assert.equal(await ogTitle('/cribbage/?s=aaaaaaaaaaaaaaaaaaaaaaaa'), 'Cribbage · Score Chalk');
  });

  test('error reports are taken, and an empty one refused', async () => {
    assert.equal((await api('/api/errors', 'POST', { message: 'Test error from the suite', place: '/x.js:1:1', page: '/x/' })).status, 200);
    assert.equal((await api('/api/errors', 'POST', {})).status, 400);
  });

  test('the daily job runs, and leaves a game in play alone', async () => {
    const id = crypto.randomUUID();
    const made = await api('/api/share', 'POST', { id, type: 'magic', state: { id, names: ['A', 'B'] } });
    const ran = await fetch(`${U}/__scheduled?cron=17+4+*+*+*`);
    assert.equal(ran.status, 200);
    assert.equal((await api(`/api/share/${made.data.view}`)).status, 200);
  });

  test('the scoring guides are there, each leading to its game, with data search engines can read', async () => {
    const guides = { 'cribbage-score-keeper': '/cribbage/', 'yahtzee-score-sheet': '/yahtzee/', 'darts-scorer': '/darts/',
      'mtg-life-counter': '/magic/', 'canasta-score-keeper': '/builder/#canasta', 'farkle-score-sheet': '/builder/#farkle', 'score-keeper': '/builder/' };
    const sitemap = await (await fetch(U + '/sitemap.xml')).text();
    for (const [slug, game] of Object.entries(guides)) {
      const r = await fetch(`${U}/${slug}/`);
      assert.equal(r.status, 200, slug);
      const html = await r.text();
      assert.ok(html.includes(`class="start" href="${game}"`), slug + ' starts its game');
      const ld = JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
      assert.deepEqual(ld.map((x) => x['@type']), ['WebApplication', 'FAQPage'], slug);
      assert.ok(sitemap.includes(`/${slug}/`), slug + ' is in the sitemap');
    }
    assert.match(await (await fetch(U + '/robots.txt')).text(), /Sitemap: https:\/\/scorechalk\.com\/sitemap\.xml/);
  });

  test('the policy pages are there', async () => {
    for (const path of ['/privacy/', '/terms/']) {
      const r = await fetch(U + path);
      assert.equal(r.status, 200);
      assert.match(await r.text(), /hello@scorechalk\.com/);
    }
  });
});
