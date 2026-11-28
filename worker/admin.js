/* The admin side: looking at what is in the database, and deleting users
   and games. Served to /admin/, for the accounts named in ADMIN_EMAILS — a
   secret, comma-separated (wrangler secret put ADMIN_EMAILS). Unset, there
   is no admin at all. Who is an admin is decided on every request from the
   signed-in account's email, so taking an address out of the list takes
   its admin away at once, cookie or no cookie.

   GET    /api/admin/overview                 every table and how many rows it has
   GET    /api/admin/users?q=                 accounts, with how much each has saved
   GET    /api/admin/tables/<name>?col=&val=&offset=
                                              a table's rows, newest first, 50 at a time
   GET    /api/admin/errors?sort=count        errors kept from pages and the Worker
   GET    /api/admin/activity?days=30         sign-ups, games and shares per day
   GET    /api/admin/log?offset=              what admins have deleted, newest first
   ...    /api/admin/work                     the work board: see worker/work.js
   DELETE /api/admin/rows/<table>/<id>        one user, game, My game, shared game
                                              or error — and everything that hangs off it

   Deleting leans on the schema's ON DELETE CASCADE, which D1 enforces, as
   deleteGame in games.js does: a user takes their games, turns, players and
   My games with them, and a game its turns and players. Shared games are
   cleared by hand, as share.js clears them. Every delete is written to
   admin_log (migrations/0010) in the same batch, with what it was in words. */

import { currentUserId } from './auth.js';
import { work } from './work.js';

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

const PAGE = 50;

// What can be deleted, and by which column. Every other table is looked at only.
const DELETABLE = {
  users: 'id',
  games: 'id',
  custom_games: 'id',
  shared_games: 'id',
  errors: 'key',
};

export function isAdminEmail(env, email) {
  if (!env.ADMIN_EMAILS || typeof email !== 'string' || !email) return false;
  return env.ADMIN_EMAILS.split(',').map((e) => e.trim().toLowerCase()).filter(Boolean)
    .includes(email.toLowerCase());
}

async function whichAdmin(request, env) {
  const uid = await currentUserId(request, env);
  if (!uid || !env.ADMIN_EMAILS) return null;
  const row = await env.DB.prepare('SELECT email FROM users WHERE id = ?').bind(uid).first();
  return row && isAdminEmail(env, row.email) ? { id: uid, email: row.email } : null;
}

const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;

// What a row is, in words, for the log — or null when there is no such row.
async function describe(env, table, id) {
  const db = env.DB;
  if (table === 'users') {
    const u = await db.prepare(
      `SELECT display_name, email,
              (SELECT COUNT(*) FROM games WHERE owner_user_id = u.id) AS games,
              (SELECT COUNT(*) FROM custom_games WHERE owner_user_id = u.id) AS custom
         FROM users u WHERE id = ?`).bind(id).first();
    return u && `${u.display_name} (${u.email || 'no email'}), ${plural(u.games, 'game')}, ${plural(u.custom, 'My game', 'My games')}`;
  }
  if (table === 'games') {
    const g = await db.prepare(
      `SELECT g.game_type, u.email,
              (SELECT GROUP_CONCAT(name, ' v ') FROM (SELECT name FROM game_players WHERE game_id = g.id ORDER BY idx)) AS players
         FROM games g LEFT JOIN users u ON u.id = g.owner_user_id WHERE g.id = ?`).bind(id).first();
    return g && `${g.game_type}: ${g.players || 'no players'}, saved by ${g.email || 'unknown'}`;
  }
  if (table === 'custom_games') {
    const c = await db.prepare(
      'SELECT c.name, u.email FROM custom_games c LEFT JOIN users u ON u.id = c.owner_user_id WHERE c.id = ?').bind(id).first();
    return c && `“${c.name}”, saved by ${c.email || 'unknown'}`;
  }
  if (table === 'shared_games') {
    const s = await db.prepare('SELECT game_type, created_at FROM shared_games WHERE id = ?').bind(id).first();
    return s && `shared ${s.game_type}, made ${new Date(s.created_at).toISOString().slice(0, 10)}`;
  }
  if (table === 'errors') {
    const e = await db.prepare('SELECT source, message, count FROM errors WHERE key = ?').bind(id).first();
    return e && `${e.source}: ${e.message.slice(0, 200)} (seen ${plural(e.count, 'time')})`;
  }
  return null;
}

const DAY = 86400e3;

// The tables there are, from the database itself, so a new migration's
// table shows up here with nothing to add. D1's own and SQLite's are left out.
async function tableNames(env) {
  const { results } = await env.DB.prepare(
    `SELECT name FROM sqlite_master WHERE type = 'table'
       AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name != 'd1_migrations'
     ORDER BY name`
  ).all();
  return results.map((r) => r.name);
}

export async function admin(request, env, url) {
  // A delete must come from this site's own page. The session cookie is
  // SameSite=Lax, which already keeps it off another site's fetch; this
  // is the second lock on the same door.
  const origin = request.headers.get('origin');
  if (request.method !== 'GET' && origin && origin !== url.origin) return json({ error: 'Forbidden' }, 403);

  const me = await whichAdmin(request, env);
  if (!me) return json({ error: 'Not an admin' }, 403);
  const uid = me.id;

  const path = url.pathname.slice('/api/admin'.length);

  // the work board: see worker/work.js
  if (path === '/work' || path.startsWith('/work/')) return work(request, env, path, me);

  if (path === '/overview' && request.method === 'GET') {
    const names = await tableNames(env);
    const counts = names.length
      ? await env.DB.batch(names.map((n) => env.DB.prepare(`SELECT COUNT(*) AS n FROM "${n}"`)))
      : [];
    const size = counts.length && counts[0].meta ? counts[0].meta.size_after : null;
    return json({
      tables: names.map((name, i) => ({ name, rows: counts[i].results[0].n, deletable: name in DELETABLE })),
      size_bytes: typeof size === 'number' ? size : null,
      ceiling_mb: Number(env.DB_CEILING_MB) || 400,
    });
  }

  if (path === '/users' && request.method === 'GET') {
    const q = (url.searchParams.get('q') || '').trim().slice(0, 100);
    const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0);
    const where = q ? 'WHERE u.email LIKE ?1 OR u.display_name LIKE ?1 OR u.id = ?2' : '';
    const stmt = env.DB.prepare(
      `SELECT u.id, u.email, u.display_name, u.avatar_url, u.created_at,
              (SELECT COUNT(*) FROM games g WHERE g.owner_user_id = u.id) AS games,
              (SELECT COUNT(*) FROM custom_games c WHERE c.owner_user_id = u.id) AS custom_games,
              (SELECT MAX(g.updated_at) FROM games g WHERE g.owner_user_id = u.id) AS last_played
         FROM users u ${where}
        ORDER BY u.created_at DESC LIMIT ${PAGE + 1} OFFSET ${offset}`
    );
    const { results } = await (q ? stmt.bind(`%${q}%`, q) : stmt).all();
    return json({ users: results.slice(0, PAGE), more: results.length > PAGE, me: uid });
  }

  const table = path.match(/^\/tables\/([a-z_]{1,64})$/);
  if (table && request.method === 'GET') {
    const name = table[1];
    if (!(await tableNames(env)).includes(name)) return json({ error: 'No such table' }, 404);
    const { results: info } = await env.DB.prepare(`PRAGMA table_info("${name}")`).all();
    const columns = info.map((c) => c.name);

    // one column equal to one value: enough for "this user's games"
    const col = url.searchParams.get('col');
    const val = url.searchParams.get('val');
    if (col && !columns.includes(col)) return json({ error: 'No such column' }, 400);
    const where = col && val != null ? `WHERE "${col}" = ?` : '';
    const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0);

    // rowid order is the order rows were put in: every table here has one
    const select = env.DB.prepare(`SELECT * FROM "${name}" ${where} ORDER BY rowid DESC LIMIT ${PAGE} OFFSET ${offset}`);
    const count = env.DB.prepare(`SELECT COUNT(*) AS n FROM "${name}" ${where}`);
    const [rows, total] = await env.DB.batch(where ? [select.bind(val), count.bind(val)] : [select, count]);
    return json({
      table: name, columns, rows: rows.results, total: total.results[0].n, offset, page: PAGE,
      key: DELETABLE[name] || null,
    });
  }

  // the errors, the commonest or the latest first
  if (path === '/errors' && request.method === 'GET') {
    const order = url.searchParams.get('sort') === 'count' ? 'count DESC, last_seen DESC' : 'last_seen DESC';
    const { results } = await env.DB.prepare(
      `SELECT key, source, message, place, stack, page, agent, count, first_seen, last_seen
         FROM errors ORDER BY ${order} LIMIT 200`).all();
    const day = await env.DB.prepare('SELECT COUNT(*) AS kinds, COALESCE(SUM(count), 0) AS n FROM errors WHERE last_seen >= ?')
      .bind(Date.now() - DAY).first();
    return json({ errors: results, last_day: day });
  }

  // per day, by UTC day: sign-ups, games started and finished, shares, My
  // games — and which games are played. Shared games are only those still
  // kept: the daily job lets go of any 30 days unchanged.
  if (path === '/activity' && request.method === 'GET') {
    const days = Math.min(365, Math.max(7, Number(url.searchParams.get('days')) || 30));
    const today = Math.floor(Date.now() / DAY);
    const since = (today - days + 1) * DAY;
    const perDay = (table, col) =>
      env.DB.prepare(`SELECT CAST(${col} / ${DAY} AS INTEGER) AS d, COUNT(*) AS n FROM ${table} WHERE ${col} >= ? GROUP BY d`).bind(since);
    const [signups, started, finished, shares, custom, types, active, totals] = await env.DB.batch([
      perDay('users', 'created_at'),
      perDay('games', 'started_at'),
      perDay('games', 'ended_at'),
      perDay('shared_games', 'created_at'),
      perDay('custom_games', 'created_at'),
      env.DB.prepare(
        `SELECT game_type, COUNT(*) AS total, SUM(started_at >= ?) AS recent
           FROM games GROUP BY game_type ORDER BY recent DESC, total DESC`).bind(since),
      env.DB.prepare('SELECT COUNT(DISTINCT owner_user_id) AS n FROM games WHERE updated_at >= ?').bind(since),
      env.DB.prepare(
        `SELECT (SELECT COUNT(*) FROM users) AS users, (SELECT COUNT(*) FROM games) AS games,
                (SELECT COUNT(*) FROM shared_games) AS shares, (SELECT COUNT(*) FROM custom_games) AS custom`),
    ]);
    // every day in the window, with 0 for a quiet one
    const fill = (r) => {
      const by = new Map(r.results.map((x) => [x.d, x.n]));
      return Array.from({ length: days }, (_, i) => by.get(today - days + 1 + i) || 0);
    };
    return json({
      days, first_day: (today - days + 1) * DAY,
      series: { signups: fill(signups), started: fill(started), finished: fill(finished), shares: fill(shares), custom: fill(custom) },
      types: types.results, active_users: active.results[0].n, totals: totals.results[0],
    });
  }

  if (path === '/log' && request.method === 'GET') {
    const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0);
    const { results } = await env.DB.prepare(
      `SELECT id, at, admin_email, action, target, target_id, summary FROM admin_log
        ORDER BY id DESC LIMIT ${PAGE + 1} OFFSET ${offset}`).all();
    return json({ entries: results.slice(0, PAGE), more: results.length > PAGE });
  }

  const row = path.match(/^\/rows\/([a-z_]{1,64})\/(.{1,2000})$/);
  if (row && request.method === 'DELETE') {
    const [, name, raw] = row;
    const keyCol = DELETABLE[name];
    if (!keyCol) return json({ error: 'Rows in this table are not deleted from here' }, 400);
    const id = decodeURIComponent(raw);
    if (name === 'users' && id === uid) return json({ error: "That's you. Sign in as another admin to delete this account." }, 400);

    const summary = await describe(env, name, id);
    if (!summary) return json({ error: 'Not found' }, 404);

    // the log entry and the delete in one batch: both happen, or neither
    const log = env.DB.prepare(
      'INSERT INTO admin_log (at, admin_id, admin_email, action, target, target_id, summary) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).bind(Date.now(), uid, me.email, name === 'errors' ? 'fixed' : 'delete', name, id, summary);
    const deletes = name === 'shared_games'
      ? [
        env.DB.prepare('DELETE FROM shared_cells WHERE game_id = ?').bind(id),
        env.DB.prepare('DELETE FROM shared_seats WHERE game_id = ?').bind(id),
        env.DB.prepare('DELETE FROM shared_games WHERE id = ?').bind(id),
      ]
      : [env.DB.prepare(`DELETE FROM "${name}" WHERE "${keyCol}" = ?`).bind(id)];
    await env.DB.batch([log, ...deletes]);
    return json({ ok: true, summary });
  }

  return json({ error: 'Not found' }, 404);
}
