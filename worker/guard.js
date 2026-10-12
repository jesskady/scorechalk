/* Keeping the site standing against a script, rather than a person.

   - full(): whether the database has grown past its ceiling. Past it, new
     shared games and new saved games are refused politely, while every
     game already there keeps working — and nothing a script does can fill
     the database to where the site stops. D1 reports the database's size
     with every query; DB_CEILING_MB (wrangler.jsonc) sets the ceiling,
     well under the 500 MB a free database can hold.
   - human(): Cloudflare Turnstile, the usually invisible check that a
     person, not a script, is making a new share or taking a seat. Only on
     once both TURNSTILE_SITE_KEY (a var) and TURNSTILE_SECRET (a secret)
     are set; until then it lets everything through.
   - accountKey(): who a signed-in write is from, for its rate limit — the
     session itself, so changing IP address doesn't reset it. */

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

export async function full(env) {
  const mb = Number(env.DB_CEILING_MB) || 400;
  try {
    const { meta } = await env.DB.prepare('SELECT 1').run();
    return typeof meta.size_after === 'number' && meta.size_after > mb * 1024 * 1024;
  } catch { return false; }
}

export const tooFull = () =>
  json({ error: 'Score Chalk is very busy right now. Your games are safe; please try sharing again later.' }, 503);

export const turnstileOn = (env) => !!(env.TURNSTILE_SITE_KEY && env.TURNSTILE_SECRET);

export async function human(request, env, token) {
  if (!turnstileOn(env)) return true;
  if (typeof token !== 'string' || !token || token.length > 4096) return false;
  const form = new FormData();
  form.append('secret', env.TURNSTILE_SECRET);
  form.append('response', token);
  const ip = request.headers.get('cf-connecting-ip');
  if (ip) form.append('remoteip', ip);
  try {
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: form });
    const out = await res.json();
    return !!out.success;
  } catch { return false; }
}

export const notHuman = () =>
  json({ error: "Couldn't confirm you're a person. Please try again." }, 403);

export function accountKey(request) {
  const m = (request.headers.get('cookie') || '').match(/(?:^|;\s*)sc_session=([^;]+)/);
  return m ? 'acct:' + m[1].slice(0, 120) : null;
}
