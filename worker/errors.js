/* Errors, kept where they can be looked at (see migrations/0009).

   POST /api/errors   a page's script error, from /report.js:
                      { message, place?, stack?, page? }
   recordError(...)   the Worker's own, from a request that threw

   Each is also written to the Worker's log. The same error from the same
   place is one row, its count going up; the daily job clears rows unseen
   for 30 days. To look at them:

     wrangler d1 execute scorechalk --remote --command
       "SELECT source, count, message, place, page, datetime(last_seen/1000,'unixepoch') AS last
          FROM errors ORDER BY last_seen DESC LIMIT 20"

   — or the D1 console in the Cloudflare dashboard. */

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

const clip = (v, n) => (typeof v === 'string' ? v.slice(0, n) : null);
const KEEP = 30 * 24 * 3600e3;

async function keep(env, source, message, place, stack, page, agent) {
  const now = Date.now();
  const key = `${source}|${message}|${place || ''}`.slice(0, 600);
  console.error(JSON.stringify({ error: source, message, place, page }));
  await env.DB.prepare(
    `INSERT INTO errors (key, source, message, place, stack, page, agent, count, first_seen, last_seen)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
     ON CONFLICT (key) DO UPDATE SET count = count + 1, last_seen = excluded.last_seen,
       stack = excluded.stack, page = excluded.page, agent = excluded.agent`
  ).bind(key, source, message, place, stack, page, agent, now, now).run();
}

export async function reportError(request, env) {
  let b;
  try { b = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
  const message = clip(b && b.message, 300);
  if (!message) return json({ error: 'No message' }, 400);
  await keep(env, 'page', message, clip(b.place, 300), clip(b.stack, 2000), clip(b.page, 200),
    clip(request.headers.get('user-agent'), 200));
  return json({ ok: true });
}

// The Worker's own: never let recording one turn into a second failure.
export async function recordError(env, err, url) {
  try {
    await keep(env, 'worker', clip(String((err && err.message) || err), 300) || 'Unknown error',
      clip(`${url.pathname}`, 300), clip(err && err.stack, 2000), clip(url.pathname, 200), null);
  } catch { /* the database itself may be what failed */ }
}

export async function cleanErrors(env) {
  await env.DB.prepare('DELETE FROM errors WHERE last_seen < ?').bind(Date.now() - KEEP).run();
}
