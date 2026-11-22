/* The admin side: only an admin gets in, sees the tables, and deletes a
   game or a user along with everything that was theirs. */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
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
    await wait(200);
    assert.deepEqual(pg.errors, []);
    await pg.close();
  });
});
