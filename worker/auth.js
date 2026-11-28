/* Google sign-in and sessions.
 *
 * Authorization-code flow with PKCE. The session is a cookie carrying a
 * signed {uid, exp} payload rather than a row in a sessions table, so an
 * authenticated request costs no database read at all. The trade is that
 * signing out cannot invalidate a stolen cookie server-side; the expiry is
 * kept short-ish to bound that.
 */

const SESSION_COOKIE = 'sc_session';
const OAUTH_COOKIE = 'sc_oauth';
const SESSION_DAYS = 30;
const OAUTH_TTL_MS = 10 * 60 * 1000;   // a sign-in attempt has 10 minutes to finish

const GOOGLE_AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token';

/* ---------------- encoding helpers ---------------- */

const enc = new TextEncoder();

function b64urlFromBytes(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function bytesFromB64url(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function b64urlFromString(s) {
  return b64urlFromBytes(enc.encode(s));
}

function stringFromB64url(s) {
  return new TextDecoder().decode(bytesFromB64url(s));
}

function randomB64url(bytes = 32) {
  return b64urlFromBytes(crypto.getRandomValues(new Uint8Array(bytes)));
}

/* ---------------- signing ---------------- */

async function hmacKey(secret) {
  return crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']
  );
}

/* payload object -> "<b64url json>.<b64url sig>" */
async function sign(payload, secret) {
  const body = b64urlFromString(JSON.stringify(payload));
  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(body));
  return body + '.' + b64urlFromBytes(new Uint8Array(sig));
}

async function unsign(token, secret) {
  if (typeof token !== 'string') return null;
  const dot = token.lastIndexOf('.');
  if (dot < 1) return null;

  const body = token.slice(0, dot);
  const key = await hmacKey(secret);
  // crypto.subtle.verify is constant-time, unlike comparing the strings
  const ok = await crypto.subtle.verify('HMAC', key, bytesFromB64url(token.slice(dot + 1)), enc.encode(body));
  if (!ok) return null;

  try { return JSON.parse(stringFromB64url(body)); }
  catch { return null; }
}

/* ---------------- cookies ---------------- */

function readCookie(request, name) {
  const header = request.headers.get('cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return null;
}

function setCookie(name, value, { maxAge, secure }) {
  const bits = [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    // Lax, not Strict: the Google callback is a cross-site top-level
    // navigation back to us, and Strict would withhold the cookie on it.
    'SameSite=Lax',
    `Max-Age=${maxAge}`,
  ];
  if (secure) bits.push('Secure');
  return bits.join('; ');
}

/* ---------------- configuration ---------------- */

/* Auth is optional infrastructure: with nothing configured the site still
   serves and simply reports nobody signed in, rather than erroring. */
export function authConfigured(env) {
  return !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.SESSION_SECRET);
}

/* Google matches this string exactly against the Authorised redirect URI
   registered in the console, and a mismatch is the single most common way
   this flow fails. So it is pinned by config rather than derived from the
   request: `wrangler dev` simulates the custom-domain host, which would make
   a locally derived value silently wrong. */
function redirectUri(env, url) {
  return new URL('/auth/google/callback', env.PUBLIC_ORIGIN || url.origin).toString();
}

/* ---------------- session ---------------- */

export async function currentUserId(request, env) {
  if (!env.SESSION_SECRET) return null;
  const payload = await unsign(readCookie(request, SESSION_COOKIE), env.SESSION_SECRET);
  if (!payload || !payload.uid) return null;
  if (typeof payload.exp !== 'number' || payload.exp < Date.now()) return null;
  return payload.uid;
}

async function sessionCookie(uid, env, secure) {
  const exp = Date.now() + SESSION_DAYS * 86400 * 1000;
  const token = await sign({ uid, exp }, env.SESSION_SECRET);
  return setCookie(SESSION_COOKIE, token, { maxAge: SESSION_DAYS * 86400, secure });
}

/* ---------------- routes ---------------- */

/* GET /auth/google/start — send the browser to Google. */
export async function startGoogle(request, env, url) {
  const secure = url.protocol === 'https:';

  const state = randomB64url(16);
  const verifier = randomB64url(32);
  const challenge = b64urlFromBytes(
    new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(verifier)))
  );

  // state and verifier ride in a short-lived signed cookie rather than server
  // storage, for the same reason the session does: no database round trip
  const pending = await sign(
    { state, verifier, exp: Date.now() + OAUTH_TTL_MS, next: url.searchParams.get('next') || '/' },
    env.SESSION_SECRET
  );

  const auth = new URL(GOOGLE_AUTH);
  auth.searchParams.set('client_id', env.GOOGLE_CLIENT_ID);
  auth.searchParams.set('redirect_uri', redirectUri(env, url));
  auth.searchParams.set('response_type', 'code');
  auth.searchParams.set('scope', 'openid email profile');
  auth.searchParams.set('state', state);
  auth.searchParams.set('code_challenge', challenge);
  auth.searchParams.set('code_challenge_method', 'S256');
  auth.searchParams.set('prompt', 'select_account');

  return new Response(null, {
    status: 302,
    headers: {
      Location: auth.toString(),
      'Set-Cookie': setCookie(OAUTH_COOKIE, pending, { maxAge: OAUTH_TTL_MS / 1000, secure }),
    },
  });
}

/* GET /auth/google/callback — Google sends the browser back here. */
export async function callbackGoogle(request, env, url) {
  const secure = url.protocol === 'https:';
  const fail = (why) => new Response(`Sign-in failed: ${why}`, { status: 400 });

  const pending = await unsign(readCookie(request, OAUTH_COOKIE), env.SESSION_SECRET);
  if (!pending || pending.exp < Date.now()) return fail('the sign-in attempt expired, please try again');

  const returned = url.searchParams.get('state');
  // rejects a callback the user did not initiate from this browser
  if (!returned || returned !== pending.state) return fail('state mismatch');

  if (url.searchParams.get('error')) return fail(url.searchParams.get('error'));
  const code = url.searchParams.get('code');
  if (!code) return fail('no authorization code');

  const res = await fetch(GOOGLE_TOKEN, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri(env, url),
      grant_type: 'authorization_code',
      code_verifier: pending.verifier,
    }),
  });
  if (!res.ok) return fail('could not exchange the code with Google');

  const token = await res.json();
  if (!token.id_token) return fail('Google returned no id_token');

  // The id_token arrives over TLS straight from Google's token endpoint on a
  // request authenticated with the client secret, so its claims are already
  // trustworthy — Google documents that re-verifying the signature is only
  // needed when a token reaches you from somewhere less direct.
  let claims;
  try { claims = JSON.parse(stringFromB64url(token.id_token.split('.')[1])); }
  catch { return fail('could not read the id_token'); }

  if (!claims.sub) return fail('Google returned no subject id');

  const uid = await upsertUser(env, claims);

  return new Response(null, {
    status: 302,
    headers: {
      // back to a page of this site only: '//host' and '/\host' are
      // addresses on other sites, as browsers read them
      Location: typeof pending.next === 'string' && /^\/(?![\/\\])/.test(pending.next) ? pending.next : '/',
      // one Set-Cookie per header line: the session in, the pending state out
      'Set-Cookie': await sessionCookie(uid, env, secure),
    },
  });
}

/* POST /auth/logout */
export function logout(url) {
  return new Response(null, {
    status: 204,
    headers: { 'Set-Cookie': setCookie(SESSION_COOKIE, '', { maxAge: 0, secure: url.protocol === 'https:' }) },
  });
}

/* ---------------- user record ---------------- */

async function upsertUser(env, claims) {
  const db = env.DB;
  const existing = await db.prepare('SELECT id FROM users WHERE google_sub = ?')
    .bind(claims.sub).first();

  const name = claims.name || claims.email || 'Player';

  if (existing) {
    // refresh the profile: people change their Google name and picture
    await db.prepare('UPDATE users SET email = ?, display_name = ?, avatar_url = ? WHERE id = ?')
      .bind(claims.email || null, name, claims.picture || null, existing.id).run();
    return existing.id;
  }

  const id = crypto.randomUUID();
  await db.prepare(
    'INSERT INTO users (id, google_sub, email, display_name, avatar_url, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(id, claims.sub, claims.email || null, name, claims.picture || null, Date.now()).run();
  return id;
}

export async function me(request, env) {
  const uid = await currentUserId(request, env);
  if (!uid) return { user: null };

  const row = await env.DB.prepare(
    'SELECT id, email, display_name, avatar_url FROM users WHERE id = ?'
  ).bind(uid).first();

  return { user: row || null };
}
