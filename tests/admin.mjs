/* The admin side: only an admin gets in, sees the tables, and deletes a
   game or a user along with everything that was theirs. */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { U, account, sql, phone, open, wait } from './helpers.mjs';

const as = (who, path, method = 'GET', body) =>
  fetch(U + path, {
    method,
    headers: { 'content-type': 'application/json', ...(who ? { cookie: who.cookie } : {}) },
    body: body && JSON.stringify(body),
  }).then(async (r) => ({ status: r.status, data: await r.json().catch(() => null) }));

const saveGame = (who) => {
  const id = crypto.randomUUID();
  return as(who, '/api/games', 'POST', {
    id, game_type: 'darts', config: { start: 501 }, started_at: Date.now(),
    players: [{ idx: 0, name: 'Ann' }, { idx: 1, name: 'Bob' }],
    turns: [{ player_idx: 0, turn_no: 0, points: 60, score_after: 441, created_at: Date.now(), detail: [] }],
  }).then((r) => { assert.equal(r.status, 200, JSON.stringify(r.data)); return id; });
};

describe('the admin side', () => {
  test('only an admin gets in', async () => {
    const player = account('player@test.local');
    assert.equal((await as(null, '/api/admin/overview')).status, 403, 'signed out');
    assert.equal((await as(player, '/api/admin/overview')).status, 403, 'signed in, not an admin');
    assert.equal((await as(player, `/api/admin/rows/users/${player.id}`, 'DELETE')).status, 403);
    assert.equal((await as(player, '/api/me')).data.admin, false);

    const boss = account('Admin@Test.local');
    assert.equal((await as(boss, '/api/me')).data.admin, true, 'the address matches whatever its case');
    const d = (await as(boss, '/api/admin/overview')).data;
    assert.ok(d.tables.some((t) => t.name === 'users' && t.rows >= 2));
    assert.ok(!d.tables.some((t) => t.name === 'd1_migrations'));

    const evil = await fetch(U + `/api/admin/rows/users/${player.id}`, { method: 'DELETE', headers: { cookie: boss.cookie, origin: 'https://evil.example' } });
    assert.equal(evil.status, 403, 'a delete from another site is refused');
  });

  test('looking at tables, filtered, and only known ones', async () => {
    const boss = account('admin@test.local', 'Boss');
    const ann = account('ann@test.local', 'Ann');
    const game = await saveGame(ann);

    const games = await as(boss, `/api/admin/tables/games?col=owner_user_id&val=${ann.id}`);
    assert.equal(games.status, 200);
    assert.deepEqual(games.data.rows.map((r) => r.id), [game]);
    assert.equal(games.data.key, 'id');
    assert.equal((await as(boss, `/api/admin/tables/turns?col=game_id&val=${game}`)).data.key, null, 'turns are looked at only');
    assert.equal((await as(boss, '/api/admin/tables/sqlite_master')).status, 404);
    assert.equal((await as(boss, '/api/admin/tables/games?col=nope&val=1')).status, 400);

    const found = (await as(boss, '/api/admin/users?q=ann@test')).data.users;
    assert.equal(found.length, 1);
    assert.equal(found[0].games, 1);
  });

  test('deleting a game, then a user with all that was theirs', async () => {
    const boss = account('admin@test.local', 'Boss');
    const ann = account('ann2@test.local', 'Ann');
    const [g1, g2] = [await saveGame(ann), await saveGame(ann)];
    sql(`INSERT INTO custom_games (id, owner_user_id, name, rules, created_at, updated_at) VALUES ('${crypto.randomUUID()}', '${ann.id}', 'House rules', '{}', 1, 1)`);

    assert.equal((await as(boss, `/api/admin/rows/games/${g1}`, 'DELETE')).status, 200);
    assert.equal((await as(boss, `/api/admin/rows/games/${g1}`, 'DELETE')).status, 404, 'gone already');
    assert.equal(sql(`SELECT COUNT(*) AS n FROM turns WHERE game_id = '${g1}'`)[0].n, 0, 'its turns went with it');

    assert.equal((await as(boss, `/api/admin/rows/turns/x`, 'DELETE')).status, 400);
    assert.equal((await as(boss, `/api/admin/rows/users/${boss.id}`, 'DELETE')).status, 400, "an admin can't delete themselves");

    assert.equal((await as(boss, `/api/admin/rows/users/${ann.id}`, 'DELETE')).status, 200);
    const left = sql(`SELECT
      (SELECT COUNT(*) FROM games WHERE owner_user_id = '${ann.id}') AS games,
      (SELECT COUNT(*) FROM turns WHERE game_id = '${g2}') AS turns,
      (SELECT COUNT(*) FROM game_players WHERE game_id = '${g2}') AS players,
      (SELECT COUNT(*) FROM custom_games WHERE owner_user_id = '${ann.id}') AS custom`)[0];
    assert.deepEqual(left, { games: 0, turns: 0, players: 0, custom: 0 });
    assert.equal((await as(ann, '/api/me')).data.user, null, 'their session finds nobody');
  });

  test('every delete is in the log, with what it was', async () => {
    const boss = account('admin@test.local', 'Boss');
    const cal = account('cal@test.local', 'Cal');
    const game = await saveGame(cal);
    assert.equal((await as(boss, `/api/admin/rows/games/${game}`, 'DELETE')).data.summary, 'darts: Ann v Bob, saved by cal@test.local');
    assert.equal((await as(boss, `/api/admin/rows/users/${cal.id}`, 'DELETE')).status, 200);
    assert.equal((await as(boss, `/api/admin/rows/users/${cal.id}`, 'DELETE')).status, 404, 'a delete of nothing is not logged');

    const log = (await as(boss, '/api/admin/log')).data.entries;
    assert.deepEqual(log.slice(0, 2).map((x) => [x.action, x.target, x.target_id, x.admin_email]),
      [['delete', 'users', cal.id, 'admin@test.local'], ['delete', 'games', game, 'admin@test.local']]);
    assert.equal(log[0].summary, 'Cal (cal@test.local), 0 games, 0 My games');
    assert.equal(log.filter((x) => x.target_id === cal.id).length, 1);
    assert.equal((await as(boss, `/api/admin/rows/admin_log/${log[0].id}`, 'DELETE')).status, 400, "the log can't be deleted from");
  });

  test('errors: listed, commonest first, and marked fixed', async () => {
    const boss = account('admin@test.local', 'Boss');
    for (let k = 0; k < 3; k++) await as(null, '/api/errors', 'POST', { message: 'Admin test: common', place: '/a.js:1:1', page: '/a/' });
    await as(null, '/api/errors', 'POST', { message: 'Admin test: rare', place: '/b.js:2:2', page: '/b/' });

    const byCount = (await as(boss, '/api/admin/errors?sort=count')).data;
    const mine = byCount.errors.filter((e) => e.message.startsWith('Admin test'));
    assert.deepEqual(mine.map((e) => [e.message, e.count]), [['Admin test: common', 3], ['Admin test: rare', 1]]);
    assert.ok(byCount.last_day.n >= 4);

    assert.equal((await as(boss, `/api/admin/rows/errors/${encodeURIComponent(mine[0].key)}`, 'DELETE')).status, 200);
    assert.ok(!(await as(boss, '/api/admin/errors')).data.errors.some((e) => e.key === mine[0].key));
    assert.equal((await as(boss, '/api/admin/log')).data.entries[0].action, 'fixed');
  });

  test('activity: a day for every day, today counted', async () => {
    const boss = account('admin@test.local', 'Boss');
    const dee = account('dee@test.local', 'Dee');
    await saveGame(dee);
    const d = (await as(boss, '/api/admin/activity?days=7')).data;
    assert.equal(d.days, 7);
    for (const s of Object.values(d.series)) assert.equal(s.length, 7);
    assert.ok(d.series.signups[6] >= 2, 'today is the last day');
    assert.ok(d.series.started[6] >= 1);
    assert.ok(d.types.some((t) => t.game_type === 'darts' && t.recent >= 1));
    assert.ok(d.active_users >= 1);
    assert.equal((await as(boss, '/api/admin/activity?days=9999')).data.days, 365, 'a year at most');
  });

  test('the work board: a ledger read in, a status set here kept until the agent changes its own', async () => {
    const boss = account('admin@test.local', 'Boss');
    const player = account('player2@test.local');
    const ledger = (s1, s2, note = 'Checked live.') => [
      '# Score Chalk SEO ledger', '',
      '| ID | Suggestion | Area | Impact | Effort | First seen | Status | Last checked | Evidence / notes |',
      '|---|---|---|---|---|---|---|---|---|',
      `| SEO-901 | Send \`X-Robots-Tag: noindex\` on shared links. The Worker already rewrites these. | Technical: Crawling | High | S | 2026-11-22 | ${s1} | 2026-11-25 | ${note} |`,
      `| SEO-902 | Add a **Cricket** mode, then a guide page. | Content & UX: New pages | Med | L | 2026-11-23 | ${s2} | 2026-11-25 | |`,
      '', 'Not part of the table.',
    ].join('\n');
    const read = (md) => as(boss, '/api/admin/work/import', 'POST', { source: 'seo', markdown: md });
    const items = async () => Object.fromEntries((await as(boss, '/api/admin/work')).data.items.map((i) => [i.id, i]));

    assert.equal((await as(player, '/api/admin/work')).status, 403, 'admins only');
    const first = await read(ledger('Pending', 'New'));
    assert.equal(first.status, 200, JSON.stringify(first.data));
    assert.deepEqual([first.data.rows, first.data.added], [2, 2]);
    let it = await items();
    assert.equal(it['SEO-901'].title, 'Send `X-Robots-Tag: noindex` on shared links', 'the first sentence is the title');
    assert.deepEqual([it['SEO-901'].status, it['SEO-901'].impact, it['SEO-902'].status], ['todo', 'High', 'new']);

    // set here, the same ledger read again: it stays
    assert.equal((await as(boss, '/api/admin/work/item/SEO-902', 'PATCH', { status: 'dismissed', notes: 'Not this year' })).status, 200);
    assert.equal((await read(ledger('Pending', 'New', 'Checked again.'))).data.moved, 0);
    it = await items();
    assert.deepEqual([it['SEO-902'].status, it['SEO-902'].notes], ['dismissed', 'Not this year']);
    assert.equal(it['SEO-901'].agent_notes, 'Checked again.', "the agent's evidence is kept up to date");

    // the agent finds it done: that moves it
    assert.equal((await read(ledger('Done', 'Pending'))).data.moved, 2);
    it = await items();
    assert.equal(it['SEO-901'].status, 'done');
    assert.ok(it['SEO-901'].done_at);
    assert.equal(it['SEO-902'].status, 'todo');
    const log = (await as(boss, '/api/admin/work/item/SEO-902')).data.log.map((x) => [x.by, x.change]);
    assert.deepEqual(log, [
      ['sync: seo', 'Added by the SEO audit as New'],
      ['admin@test.local', "New → Won't do"], ['admin@test.local', 'Notes edited'],
      ['sync: seo', "Won't do → To do (the SEO audit says Pending)"],
    ]);
    assert.equal((await as(boss, '/api/admin/work/item/SEO-901', 'DELETE')).status, 400, "an agent's item isn't deleted, it would come back");
    assert.equal((await as(boss, '/api/admin/work/item/SEO-901', 'PATCH', { title: 'Mine now' })).data.item.title,
      'Send `X-Robots-Tag: noindex` on shared links', "an agent's words stay the ledger's");
  });

  test('the work board: an item written by hand', async () => {
    const boss = account('admin@test.local', 'Boss');
    assert.equal((await as(boss, '/api/admin/work', 'POST', { title: '  ' })).status, 400);
    const a = await as(boss, '/api/admin/work', 'POST', { title: 'Darts: two tabs lose a turn', kind: 'bug', impact: 'High' });
    const b = await as(boss, '/api/admin/work', 'POST', { title: 'Dark mode for Yahtzee', kind: 'idea' });
    assert.match(a.data.id, /^W-\d{3}$/);
    assert.equal(Number(b.data.id.slice(2)), Number(a.data.id.slice(2)) + 1, 'numbered in turn');
    const p = await as(boss, `/api/admin/work/item/${a.data.id}`, 'PATCH', { status: 'doing', title: 'Darts: two tabs on one game lose a turn' });
    assert.deepEqual([p.data.item.status, p.data.item.title, p.data.item.source], ['doing', 'Darts: two tabs on one game lose a turn', 'me']);
    assert.equal((await as(boss, `/api/admin/work/item/${a.data.id}`, 'PATCH', { status: 'nope' })).status, 400);
    assert.equal((await as(boss, `/api/admin/work/item/${b.data.id}`, 'DELETE')).status, 200);
    assert.equal((await as(boss, `/api/admin/work/item/${b.data.id}`)).status, 404);
  });

  test('the work board from a terminal: a token, not a cookie', async () => {
    const TOKEN = 'test-only-work-token-0123456789abcdef';
    const api = (path, method = 'GET', body, tok = TOKEN) => fetch(U + '/api' + path, {
      method, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + tok, 'x-work-by': 'claude' },
      body: body && JSON.stringify(body),
    }).then(async (r) => ({ status: r.status, data: await r.json().catch(() => null) }));
    const boss = account('admin@test.local', 'Boss');

    assert.equal((await api('/work', 'GET', null, '')).status, 403, 'no token');
    assert.equal((await api('/work', 'GET', null, TOKEN + 'x')).status, 403, 'the wrong one');
    assert.equal((await as(boss, '/api/work')).status, 403, "an admin's cookie isn't the token");

    const { id } = (await api('/work', 'POST', { kind: 'bug', title: 'Found while fixing something else' })).data;
    const cli = (...args) => spawnSync(process.execPath, ['scripts/work.mjs', ...args], {
      cwd: new URL('..', import.meta.url), encoding: 'utf8', env: { ...process.env, WORK_URL: U, WORK_TOKEN: TOKEN },
    });
    const started = cli('doing', id);
    assert.equal(started.status, 0, started.stderr);
    const done = cli('done', id, 'Deployed in abc1234');
    assert.match(done.stdout, new RegExp(`${id}\\s+Done`));
    assert.match(cli('list', 'done').stdout, new RegExp(id));
    const shown = cli('show', id).stdout;
    assert.match(shown, /\d{4}-\d\d-\d\d: Deployed in abc1234/, 'the note is dated, in the notes');
    assert.match(shown, /api: claude: In progress → Done/, 'the history says who');
    assert.notEqual(cli('show', 'NOPE-1').status, 0);
  });

  test('the page: a stranger is asked to sign in, an admin sees the users', async () => {
    const boss = account('admin@test.local', 'Boss');
    const pg = await phone(1200, 800);
    await open(pg, '/admin/');
    assert.match(await pg.$eval('#view', (v) => v.textContent), /Sign in with an admin account/);

    const [name, value] = boss.cookie.split('=');
    await pg.setCookie({ name, value, url: U });
    await open(pg, '/admin/#users');
    await pg.waitForSelector('.adm-user', { timeout: 10000 });
    assert.ok(await pg.$$eval('.adm-who b', (bs) => bs.some((b) => b.textContent === 'Boss (you)')));

    await open(pg, '/admin/#tables/users');
    await pg.waitForSelector('.adm-table', { timeout: 10000 });
    await open(pg, '/admin/#activity/30');
    await pg.waitForSelector('.adm-chart svg', { timeout: 10000 });
    assert.equal(await pg.$$eval('.adm-chart', (c) => c.length), 4);
    await open(pg, '/admin/#errors/count');
    await pg.waitForSelector('.adm-err', { timeout: 10000 });
    await open(pg, '/admin/#log');
    await pg.waitForSelector('.adm-log', { timeout: 10000 });

    // the work board: add a bug, open it, move it on
    await open(pg, '/admin/#work');
    await pg.waitForSelector('.adm-works', { timeout: 10000 });
    await pg.click('.adm-add summary');
    await pg.type('.adm-add input[name=title]', 'Cribbage: the crib counts twice');
    await pg.select('.adm-add select[name=kind]', 'bug');
    await pg.click('.adm-add button');
    await pg.waitForFunction(() => [...document.querySelectorAll('.adm-work-title')].some((b) => b.textContent === 'Cribbage: the crib counts twice'), { timeout: 10000 });
    const row = await pg.evaluateHandle(() => [...document.querySelectorAll('.adm-work')].find((r) => r.textContent.includes('the crib counts twice')));
    await (await row.$('.adm-work-title')).click();
    await pg.waitForFunction((r) => r.querySelector('.adm-hist li'), { timeout: 10000 }, row);
    await (await row.$('.adm-status')).select('doing');
    await pg.waitForFunction((r) => r.dataset.status === 'doing' && r.querySelectorAll('.adm-hist li').length === 2, { timeout: 10000 }, row);
    assert.equal(await pg.$eval('.st-doing b', (b) => Number(b.textContent) >= 1), true, 'the count follows');
    await wait(200);
    assert.deepEqual(pg.errors, []);
    await pg.close();
  });
});
