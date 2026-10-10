/* Shared games: a game kept on the server for anyone holding its link,
 * signed in or not (see migrations/0007 and 0008).
 *
 * A game is shared one of two ways:
 *   'state'  the whole game goes back and forth, and a change made on an
 *            old version is refused. Darts, Cribbage, Magic.
 *   'cells'  each score is a cell of its own with its own version, so only
 *            changes to the same cell clash; and players join by seat,
 *            each scoring only their own. The Builder, Yahtzee, Darts.
 *
 * Tokens, all long and random, none derived from the game's id (which a
 * viewer can see):
 *   view   watch only
 *   edit   whoever shared it: change anything, free a seat, stop sharing
 *   join   pick a seat, and be given that seat's token: every 'cells'
 *          game, and a 'state' game shared with seats (Cribbage)
 *   seat   score one player. In a 'cells' game the server holds a seat to
 *          its own player's cells; a 'state' game goes whole, so there the
 *          page keeps to it.
 *
 *   POST   /api/share                  share: { id, type, state, mode?, cells? }
 *   GET    /api/share/:token           the game. ?since=<version or seq>
 *                                      answers only what is newer
 *   PUT    /api/share/:token           'state', edit or seat: { state, base }
 *   PUT    /api/share/:token/cells     'cells', edit or seat: { cells: [{ key, value, base }] }
 *   POST   /api/share/:token/seat      join or edit: { seat } → its token
 *   DELETE /api/share/:token/seat/:n   edit: free a seat
 *   DELETE /api/share/:token           edit: stop sharing
 */

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

const TYPES = ['darts', 'cribbage', 'yahtzee', 'magic', 'builder'];
const CELL_TYPES = ['builder', 'yahtzee', 'darts'];
const MAX_STATE = 256 * 1024;   // as for a game saved to a profile
const MAX_CELL = 4 * 1024;
const MAX_SEATS = 12;
// '<player>:<round or box>'
const CELL_KEY = /^(\d{1,2}):[A-Za-z0-9_]{1,24}$/;

// 24 random bytes, URL-safe: 192 bits, not something to guess
function token() {
  const b = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function body(request) {
  try { return await request.json(); } catch { return null; }
}

function stateText(s) {
  if (!s || typeof s !== 'object' || Array.isArray(s)) return null;
  const text = JSON.stringify(s);
  return text.length <= MAX_STATE ? text : null;
}

// a cell's value as kept: JSON, or null for a cell taken back
function cellText(v) {
  if (v === null || v === undefined) return null;
  const text = JSON.stringify(v);
  return text.length <= MAX_CELL ? text : undefined;
}

const parse = (s) => { try { return JSON.parse(s); } catch { return null; } };
const seatOf = (key) => Number(CELL_KEY.exec(key)[1]);

/* ---------------- finding a game by its token ---------------- */

async function resolve(env, t) {
  const row = await env.DB.prepare(
    'SELECT * FROM shared_games WHERE view_token = ? OR edit_token = ? OR join_token = ?'
  ).bind(t, t, t).first();
  if (row) {
    const kind = row.edit_token === t ? 'edit' : row.join_token === t ? 'join' : 'view';
    return { row, kind };
  }
  const seat = await env.DB.prepare('SELECT game_id, seat FROM shared_seats WHERE token = ?').bind(t).first();
  if (!seat) return null;
  const game = await env.DB.prepare('SELECT * FROM shared_games WHERE id = ?').bind(seat.game_id).first();
  return game ? { row: game, kind: 'seat', seat: seat.seat } : null;
}

// The other links a token's holder may pass on: a scorer can always hand
// out a link to watch, and whoever shared the game the link to join.
function links(row, kind) {
  const out = {};
  if (kind !== 'view') out.view = row.view_token;
  if (kind === 'edit' && row.join_token) out.join = row.join_token;
  return out;
}

/* ---------------- sharing a game ---------------- */

export async function createShare(request, env) {
  const b = await body(request);
  if (!b || typeof b.id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(b.id)) return json({ error: 'Invalid id' }, 400);
  if (!TYPES.includes(b.type)) return json({ error: 'Invalid type' }, 400);
  const text = stateText(b.state);
  if (!text) return json({ error: 'Invalid or too large state' }, 400);
  if (b.state.id !== b.id) return json({ error: 'State is for another game' }, 400);
  const cells = b.mode === 'cells';
  if (cells && !CELL_TYPES.includes(b.type)) return json({ error: 'This game is shared whole' }, 400);
  if (cells && (!b.cells || typeof b.cells !== 'object' || Array.isArray(b.cells))) return json({ error: 'Invalid cells' }, 400);

  const found = await env.DB.prepare('SELECT * FROM shared_games WHERE id = ?').bind(b.id).first();
  if (found) {
    // answered only to whoever shared it: the id alone hands out nothing
    if (b.edit !== found.edit_token) return json({ error: 'Already shared' }, 409);
    return json({ mode: found.mode, edit: found.edit_token, ...links(found, 'edit'), version: found.version, seq: found.seq });
  }

  const now = Date.now(), view = token(), edit = token(), join = cells || b.seats ? token() : null;
  const stmts = [env.DB.prepare(
    `INSERT INTO shared_games (id, game_type, state, version, view_token, edit_token, created_at, updated_at, mode, join_token, seq)
     VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(b.id, b.type, text, view, edit, now, now, cells ? 'cells' : 'state', join, 0)];

  let seq = 0;
  if (cells) {
    for (const [key, v] of Object.entries(b.cells)) {
      const vt = cellText(v);
      if (!CELL_KEY.test(key) || vt === undefined) return json({ error: 'Invalid cell ' + key }, 400);
      if (vt === null) continue;
      seq += 1;
      stmts.push(env.DB.prepare(
        'INSERT INTO shared_cells (game_id, key, value, version, seq, updated_at) VALUES (?, ?, ?, 1, ?, ?)'
      ).bind(b.id, key, vt, seq, now));
    }
    stmts.push(env.DB.prepare('UPDATE shared_games SET seq = ? WHERE id = ?').bind(seq, b.id));
  }
  await env.DB.batch(stmts);
  return json({ mode: cells ? 'cells' : 'state', view, edit, ...(join ? { join } : {}), version: 1, seq });
}

/* ---------------- reading one ---------------- */

export async function getShare(request, env, t, url) {
  const found = await resolve(env, t);
  if (!found) return json({ error: 'Not shared' }, 404);
  const { row, kind } = found;
  const since = url.searchParams.has('since') ? Number(url.searchParams.get('since')) : null;
  const who = { kind, ...(kind === 'seat' ? { seat: found.seat } : {}), ...links(row, kind) };

  const seats = (await env.DB.prepare('SELECT seat FROM shared_seats WHERE game_id = ? ORDER BY seat')
    .bind(row.id).all()).results.map((r) => r.seat);

  if (row.mode !== 'cells') {
    if (Number.isInteger(since) && since >= row.version) return json({ unchanged: true, version: row.version, seats, ...who });
    return json({
      mode: 'state', type: row.game_type, version: row.version, updated_at: row.updated_at,
      state: parse(row.state), seats, ...who,
    });
  }

  const fresh = !Number.isInteger(since);
  if (!fresh && since >= row.seq) return json({ unchanged: true, mode: 'cells', seq: row.seq, seats, ...who });
  const cells = (await env.DB.prepare(
    'SELECT key, value, version, seq FROM shared_cells WHERE game_id = ? AND seq > ? ORDER BY seq'
  ).bind(row.id, fresh ? 0 : since).all()).results.map((c) => ({ ...c, value: parse(c.value) }));
  return json({
    mode: 'cells', type: row.game_type, seq: row.seq, seats, cells, ...who,
    // where the game started, for a phone that doesn't have it yet
    ...(fresh ? { state: parse(row.state) } : {}),
  });
}

/* ---------------- writing ---------------- */

// 'state': the whole game, refused when made on an old version
export async function putShare(request, env, t) {
  const found = await resolve(env, t);
  if (!found || found.row.mode !== 'state') return json({ error: 'Not shared' }, 404);
  if (found.kind !== 'edit' && found.kind !== 'seat') return json({ error: 'This link can only watch' }, 403);
  const b = await body(request);
  const text = b && stateText(b.state);
  if (!text || !Number.isInteger(b.base) || b.state.id !== found.row.id) return json({ error: 'Invalid payload' }, 400);
  const res = await env.DB.prepare(
    `UPDATE shared_games SET state = ?, version = version + 1, updated_at = ?
      WHERE id = ? AND version = ? AND mode = 'state'`
  ).bind(text, Date.now(), found.row.id, b.base).run();
  if (res.meta && res.meta.changes) return json({ version: b.base + 1 });

  // refused: with what is there now
  const now = await env.DB.prepare('SELECT state, version FROM shared_games WHERE id = ?').bind(found.row.id).first();
  return json({ error: 'Changed elsewhere', version: now.version, state: parse(now.state) }, 409);
}

// 'cells': each cell on its own. A cell changed since the version it was
// changed from is refused, and comes back as it now is; the rest go in.
export async function putCells(request, env, t) {
  const found = await resolve(env, t);
  if (!found || found.row.mode !== 'cells') return json({ error: 'Not shared' }, 404);
  if (found.kind !== 'edit' && found.kind !== 'seat') return json({ error: 'This link can only watch' }, 403);
  const b = await body(request);
  if (!b || !Array.isArray(b.cells) || b.cells.length > 40) return json({ error: 'Invalid payload' }, 400);

  const id = found.row.id, applied = [], conflicts = [];
  for (const c of b.cells) {
    if (!c || typeof c.key !== 'string' || !CELL_KEY.test(c.key) || !Number.isInteger(c.base) || c.base < 0) {
      return json({ error: 'Invalid cell' }, 400);
    }
    // a seat scores its own player only
    if (found.kind === 'seat' && seatOf(c.key) !== found.seat) return json({ error: 'Not your seat' }, 403);
    const vt = cellText(c.value);
    if (vt === undefined) return json({ error: 'Cell too large' }, 400);

    const now = Date.now();
    const { seq } = await env.DB.prepare('UPDATE shared_games SET seq = seq + 1, updated_at = ? WHERE id = ? RETURNING seq')
      .bind(now, id).first();
    const done = await env.DB.prepare(
      `INSERT INTO shared_cells (game_id, key, value, version, seq, updated_at) VALUES (?, ?, ?, 1, ?, ?)
       ON CONFLICT (game_id, key) DO UPDATE SET value = excluded.value, version = shared_cells.version + 1,
         seq = excluded.seq, updated_at = excluded.updated_at
       WHERE shared_cells.version = ?
       RETURNING version, seq`
    ).bind(id, c.key, vt, seq, now, c.base).first();
    if (done) { applied.push({ key: c.key, version: done.version, seq: done.seq }); continue; }
    const cur = await env.DB.prepare('SELECT key, value, version, seq FROM shared_cells WHERE game_id = ? AND key = ?')
      .bind(id, c.key).first();
    conflicts.push({ ...cur, value: parse(cur.value) });
  }
  const { seq } = await env.DB.prepare('SELECT seq FROM shared_games WHERE id = ?').bind(id).first();
  return json({ applied, conflicts, seq });
}

/* ---------------- seats ---------------- */

export async function claimSeat(request, env, t) {
  const found = await resolve(env, t);
  if (!found || !found.row.join_token) return json({ error: 'Not shared' }, 404);
  if (found.kind !== 'join' && found.kind !== 'edit') return json({ error: 'This link can only watch' }, 403);
  const b = await body(request);
  if (!b || !Number.isInteger(b.seat) || b.seat < 0 || b.seat >= MAX_SEATS) return json({ error: 'Invalid seat' }, 400);
  const seatToken = token();
  try {
    await env.DB.prepare('INSERT INTO shared_seats (game_id, seat, token, claimed_at) VALUES (?, ?, ?, ?)')
      .bind(found.row.id, b.seat, seatToken, Date.now()).run();
  } catch {
    return json({ error: 'That seat is taken' }, 409);
  }
  return json({ seat: b.seat, token: seatToken, view: found.row.view_token });
}

export async function freeSeat(request, env, t, seat) {
  const found = await resolve(env, t);
  if (!found || found.kind !== 'edit') return json({ error: 'Not shared' }, 404);
  await env.DB.prepare('DELETE FROM shared_seats WHERE game_id = ? AND seat = ?').bind(found.row.id, seat).run();
  return json({ ok: true });
}

/* ---------------- stopping ---------------- */

export async function deleteShare(request, env, t) {
  const found = await resolve(env, t);
  if (!found || found.kind !== 'edit') return json({ error: 'Not shared' }, 404);
  const id = found.row.id;
  await env.DB.batch([
    env.DB.prepare('DELETE FROM shared_cells WHERE game_id = ?').bind(id),
    env.DB.prepare('DELETE FROM shared_seats WHERE game_id = ?').bind(id),
    env.DB.prepare('DELETE FROM shared_games WHERE id = ?').bind(id),
  ]);
  return json({ ok: true });
}
