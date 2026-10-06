/* My games: rule sets built with the ScoreChalk Builder and saved to a
 * profile.
 *
 * One PUT both creates and updates, keyed by a client-chosen id, so a save
 * that fails halfway is simply sent again. The rules are rebuilt from a
 * whitelist rather than stored as sent: they come from a browser, and the
 * builder, home page and profile all read them back.
 */

import { currentUserId } from './auth.js';

// Generous for a list someone keeps by hand; it bounds a runaway client.
const MAX_GAMES = 100;
const MAX_NAME = 24;

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

const isInt = (v) => Number.isInteger(v);
const isBool = (v) => typeof v === 'boolean';

/* ---------------- validation ---------------- */

/* The builder's rule fields (defaultRules in public/builder/rules.js), each
   with what it may hold. Returns the clean rules, or the name of the first
   bad field. The game's name is its own column, not a rule. */
const RULE_FIELDS = {
  mode:      (v) => v === 'up' || v === 'down',
  start:     (v) => isInt(v) && Math.abs(v) <= 1e7,
  win:       (v) => ['none', 'target', 'low', 'zero'].includes(v),
  target:    (v) => isInt(v) && v >= 1 && v <= 1e7,
  useRounds: isBool,
  rounds:    (v) => isInt(v) && v >= 1 && v <= 999,
  // room for named keys: "Natural canasta 500, Mixed canasta 300, ..."
  quick:     (v) => typeof v === 'string' && v.length <= 300,
  typed:     isBool,
  signs:     isBool,
  turns:     isBool,
  teams:     isBool,
  teamCount: (v) => isInt(v) && v >= 2 && v <= 4,
  players:   (v) => isInt(v) && v >= 1 && v <= 8,
  theme:     (v) => ['parlor', 'living', 'workshop'].includes(v),
};

// Fields added after My games shipped. A browser still running the page from
// before them sends rules without them, so they are filled in, not refused.
const OPTIONAL = { teams: false, teamCount: 2, players: 2, theme: 'workshop' };

function cleanRules(rules) {
  if (!rules || typeof rules !== 'object') return { bad: 'rules' };
  const out = {};
  for (const [k, ok] of Object.entries(RULE_FIELDS)) {
    if (!(k in rules) && k in OPTIONAL) { out[k] = OPTIONAL[k]; continue; }
    if (!(k in rules)) return { bad: `rules.${k}` };
    if (!ok(rules[k])) return { bad: `rules.${k}` };
    out[k] = rules[k];
  }
  return { rules: out };
}

/* ---------------- routes ---------------- */

/* Listed by name: this is a shelf you pick from, not a feed. */
export async function listCustomGames(request, env) {
  const uid = await currentUserId(request, env);
  if (!uid) return json({ error: 'Not signed in' }, 401);

  const rows = await env.DB.prepare(
    `SELECT id, name, rules, created_at, updated_at
       FROM custom_games WHERE owner_user_id = ?
      ORDER BY name COLLATE NOCASE`
  ).bind(uid).all();

  return json({
    games: (rows.results || []).map((r) => ({ ...r, rules: parse(r.rules, {}) })),
  });
}

export async function putCustomGame(request, env, id) {
  const uid = await currentUserId(request, env);
  if (!uid) return json({ error: 'Not signed in' }, 401);

  let body;
  try { body = await request.json(); }
  catch { return json({ error: 'Invalid JSON' }, 400); }

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name || name.length > MAX_NAME) return json({ error: 'Invalid payload: name' }, 400);
  const { rules, bad } = cleanRules(body.rules);
  if (bad) return json({ error: `Invalid payload: ${bad}` }, 400);

  // The id is the client's, so it could name someone else's row: refuse
  // rather than overwrite. A new row also has to fit under the limit.
  const existing = await env.DB.prepare('SELECT owner_user_id FROM custom_games WHERE id = ?')
    .bind(id).first();
  if (existing && existing.owner_user_id !== uid) return json({ error: 'Not your game' }, 403);
  if (!existing) {
    const { n } = await env.DB.prepare('SELECT COUNT(*) AS n FROM custom_games WHERE owner_user_id = ?')
      .bind(uid).first();
    if (n >= MAX_GAMES) return json({ error: `You can keep up to ${MAX_GAMES} games.` }, 409);
  }

  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO custom_games (id, owner_user_id, name, rules, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       rules = excluded.rules,
       updated_at = excluded.updated_at`
  ).bind(id, uid, name, JSON.stringify(rules), now, now).run();

  return json({ game: { id, name, rules, updated_at: now } });
}

export async function deleteCustomGame(request, env, id) {
  const uid = await currentUserId(request, env);
  if (!uid) return json({ error: 'Not signed in' }, 401);

  // scoped by owner, so a guessed id cannot delete someone else's game
  const res = await env.DB.prepare('DELETE FROM custom_games WHERE id = ? AND owner_user_id = ?')
    .bind(id, uid).run();

  if (!res.meta || res.meta.changes === 0) return json({ error: 'Not found' }, 404);
  return json({ ok: true });
}

function parse(s, fallback) {
  try { return JSON.parse(s); } catch { return fallback; }
}
