/* Request router.
 *
 * Almost everything here is static: the games live in public/ and are served
 * straight from the asset store. This Worker exists for the www redirect,
 * the handful of /auth and /api routes behind sign-in, and shared games.
 */

import { authConfigured, startGoogle, callbackGoogle, logout, me } from './auth.js';
import { saveGame, listGames, getGame, patchGame, deleteGame } from './games.js';
import { getStats } from './stats.js';
import { listCustomGames, putCustomGame, deleteCustomGame } from './custom-games.js';
import { reportError, recordError, cleanErrors } from './errors.js';
import { accountKey } from './guard.js';
import { admin, isAdminEmail } from './admin.js';
import { shareCheck, createShare, getShare, putShare, putCells, claimSeat, freeSeat, deleteShare, cleanShares, previewFor } from './share.js';

const CANONICAL = 'scorechalk.com';

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

export default {
  // Once a day (see "triggers" in wrangler.jsonc): let go of shared games
  // that have gone 30 days without a change, and errors unseen as long.
  async scheduled(event, env, ctx) {
    ctx.waitUntil(Promise.all([cleanShares(env), cleanErrors(env)]));
  },

  // Every request, with any that throws kept as an error (see errors.js)
  // rather than left to the log's sampling.
  async fetch(request, env) {
    const url = new URL(request.url);
    const moved = toCanonical(request, url);
    if (moved) return moved;
    let res;
    try {
      res = await route(request, env, url);
    } catch (err) {
      await recordError(env, err, url);
      return json({ error: 'Something went wrong. Try again in a moment.' }, 500);
    }
    return finish(request, url, res);
  },
};

/* One address for the live site: https://scorechalk.com. Plain http and the
   www host are sent there in one permanent hop, so search engines see a
   single copy of each page. Only the live hosts are moved; `wrangler dev`
   and the tests run on localhost over http and are left alone. A GET is
   sent with 301; anything else with 308, which keeps the method and body. */
function toCanonical(request, url) {
  const live = url.hostname === CANONICAL || url.hostname === 'www.' + CANONICAL;
  if (!live || (url.hostname === CANONICAL && url.protocol === 'https:')) return null;
  url.hostname = CANONICAL;
  url.protocol = 'https:';
  const read = request.method === 'GET' || request.method === 'HEAD';
  return Response.redirect(url.toString(), read ? 301 : 308);
}

// game pages that a shared game's link opens, as /darts/?s=<token>
const GAME_PAGE = /^\/(darts|cribbage|yahtzee|magic|builder)\/$/;

/* What every response gets on its way out, for browsers and search engines:
   - HSTS on the live site, so a browser never tries plain http again.
   - The asset store's trailing-slash redirects (/darts → /darts/) made
     permanent: it answers 307, which tells search engines the move is
     temporary.
   - noindex where a page isn't one to be found by search: a shared game's
     link (the players' names are in its title), the profile, the admin side
     and the not-found page. robots.txt lets these be crawled, so that the
     noindex can be seen.
   - Long caching for files that don't change under their name: anything
     loaded with ?v= (bumped whenever the file changes; see the note in each
     page's head) and the icons and link-card images. */
function finish(request, url, res) {
  const out = new Response(res.body, res);
  const h = out.headers;
  if (url.hostname === CANONICAL) h.set('strict-transport-security', 'max-age=31536000');

  if (out.status === 307 && h.has('location') && !url.pathname.startsWith('/api/') && !url.pathname.startsWith('/auth/')) {
    return new Response(null, { status: 301, headers: h });
  }

  const p = url.pathname;
  if ((GAME_PAGE.test(p) && url.searchParams.has('s')) || p.startsWith('/account/') ||
      p.startsWith('/admin/') || p === '/404' || p === '/404.html') {
    h.set('x-robots-tag', 'noindex');
  }

  if (out.status === 200 && request.method === 'GET' && !p.startsWith('/api/') && !p.startsWith('/auth/')) {
    if (url.searchParams.has('v')) h.set('cache-control', 'public, max-age=31536000, immutable');
    else if (p.startsWith('/icons/') || p.startsWith('/og/') || p === '/favicon.svg') {
      h.set('cache-control', 'public, max-age=2592000');
    }
  }
  return out;
}

async function route(request, env, url) {

    // a page's script error, from /report.js: limited per visitor like the
    // shared games, so it can't be used to fill the table
    if (url.pathname === '/api/errors') {
      if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
      if (env.ERRORS && env.LIMITS !== 'off') {
        const { success } = await env.ERRORS.limit({ key: request.headers.get('cf-connecting-ip') || 'local' });
        if (!success) return json({ error: 'Too many requests' }, 429);
      }
      return reportError(request, env);
    }

    // the icon is /favicon.svg and /icons/icon-192.png (see each page's head);
    // this is for whatever still asks for the old default
    if (url.pathname === '/favicon.ico') {
      return Response.redirect(new URL('/icons/icon-192.png', url).toString(), 301);
    }

    if (url.pathname === '/api/me') {
      // Deliberately not an error when auth is unconfigured: the site is
      // usable signed out, so "nobody is signed in" is the honest answer.
      if (!authConfigured(env)) return json({ user: null, auth: false });
      const who = await me(request, env);
      // only ever true for an admin, so the profile can link to /admin/
      return json({ ...who, admin: isAdminEmail(env, who.user && who.user.email), auth: true });
    }

    // the admin side: see worker/admin.js
    if (url.pathname.startsWith('/api/admin/')) {
      if (!authConfigured(env)) return json({ error: 'Sign-in is not configured.' }, 503);
      return admin(request, env, url);
    }

    // Writes from a signed-in account — saving games, My games — are limited
    // per account, by its session, so a script with many IP addresses gets
    // no further (see "ratelimits" in wrangler.jsonc).
    if ((url.pathname.startsWith('/api/games') || url.pathname.startsWith('/api/custom-games')) &&
        request.method !== 'GET' && env.ACCOUNT_WRITE && env.LIMITS !== 'off') {
      const key = accountKey(request);
      if (key) {
        const { success } = await env.ACCOUNT_WRITE.limit({ key });
        if (!success) return json({ error: 'Too many changes at once. Wait a moment and try again.' }, 429);
      }
    }

    if (url.pathname === '/api/stats') {
      if (!authConfigured(env)) return json({ error: 'Sign-in is not configured.' }, 503);
      if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);
      return getStats(request, env, url);
    }

    if (url.pathname === '/api/games') {
      if (!authConfigured(env)) return json({ error: 'Sign-in is not configured.' }, 503);
      if (request.method === 'POST') return saveGame(request, env);
      if (request.method === 'GET') return listGames(request, env, url);
      return json({ error: 'Method not allowed' }, 405);
    }

    const game = url.pathname.match(/^\/api\/games\/([A-Za-z0-9_-]{1,64})$/);
    if (game) {
      if (!authConfigured(env)) return json({ error: 'Sign-in is not configured.' }, 503);
      if (request.method === 'GET') return getGame(request, env, game[1]);
      if (request.method === 'PATCH') return patchGame(request, env, game[1]);
      if (request.method === 'DELETE') return deleteGame(request, env, game[1]);
      return json({ error: 'Method not allowed' }, 405);
    }

    // My games: builder rule sets saved to the profile
    if (url.pathname === '/api/custom-games') {
      if (!authConfigured(env)) return json({ error: 'Sign-in is not configured.' }, 503);
      if (request.method === 'GET') return listCustomGames(request, env);
      return json({ error: 'Method not allowed' }, 405);
    }

    const custom = url.pathname.match(/^\/api\/custom-games\/([A-Za-z0-9_-]{1,64})$/);
    if (custom) {
      if (!authConfigured(env)) return json({ error: 'Sign-in is not configured.' }, 503);
      if (request.method === 'PUT') return putCustomGame(request, env, custom[1]);
      if (request.method === 'DELETE') return deleteCustomGame(request, env, custom[1]);
      return json({ error: 'Method not allowed' }, 405);
    }

    // Shared games: open to anyone holding a link, signed in or not, so each
    // visitor is limited (see "ratelimits" in wrangler.jsonc): making shares
    // and claiming seats, writing, and reading each have their own allowance.
    if (url.pathname.startsWith('/api/share')) {
      const limiter = request.method === 'GET' ? env.SHARE_READ
        : url.pathname === '/api/share' || url.pathname.includes('/seat') ? env.SHARE_CREATE
        : env.SHARE_WRITE;
      if (limiter && env.LIMITS !== 'off') {   // off only for the tests: see tests/helpers.mjs
        const key = request.headers.get('cf-connecting-ip') || 'local';
        const { success } = await limiter.limit({ key });
        if (!success) return json({ error: 'Too many requests. Wait a moment and try again.' }, 429);
      }
    }

    // whether to show Turnstile before sharing, and its public site key
    if (url.pathname === '/api/share/check') return shareCheck(env);

    if (url.pathname === '/api/share') {
      if (request.method === 'POST') return createShare(request, env);
      return json({ error: 'Method not allowed' }, 405);
    }

    const share = url.pathname.match(/^\/api\/share\/([A-Za-z0-9_-]{20,64})$/);
    if (share) {
      if (request.method === 'GET') return getShare(request, env, share[1], url);
      if (request.method === 'PUT') return putShare(request, env, share[1]);
      if (request.method === 'DELETE') return deleteShare(request, env, share[1]);
      return json({ error: 'Method not allowed' }, 405);
    }

    // scoring together by seat: the cells, and the seats
    const cells = url.pathname.match(/^\/api\/share\/([A-Za-z0-9_-]{20,64})\/cells$/);
    if (cells) {
      if (request.method === 'PUT') return putCells(request, env, cells[1]);
      return json({ error: 'Method not allowed' }, 405);
    }
    const seat = url.pathname.match(/^\/api\/share\/([A-Za-z0-9_-]{20,64})\/seat(?:\/(\d{1,2}))?$/);
    if (seat) {
      if (request.method === 'POST' && !seat[2]) return claimSeat(request, env, seat[1]);
      if (request.method === 'DELETE' && seat[2]) return freeSeat(request, env, seat[1], Number(seat[2]));
      return json({ error: 'Method not allowed' }, 405);
    }

    if (url.pathname.startsWith('/auth/')) {
      if (!authConfigured(env)) {
        return json({ error: 'Sign-in is not configured on this deployment.' }, 503);
      }
      if (url.pathname === '/auth/google/start') return startGoogle(request, env, url);
      if (url.pathname === '/auth/google/callback') return callbackGoogle(request, env, url);
      if (url.pathname === '/auth/logout' && request.method === 'POST') return logout(url);
      return json({ error: 'Not found' }, 404);
    }

    // A link to a shared game — /cribbage/?s=<token> — shows a card in a
    // message naming who is playing and what the link is for, so the page's
    // own title and description are filled in for that game.
    const page = url.pathname.match(GAME_PAGE);
    const token = url.searchParams.get('s');
    if (page && token && request.method === 'GET' && /^[A-Za-z0-9_-]{20,64}$/.test(token)) {
      const res = await env.ASSETS.fetch(request);
      const card = res.ok ? await previewFor(env, token, page[1]).catch(() => null) : null;
      if (!card) return res;
      const content = (value) => ({ element(e) { e.setAttribute('content', value); } });
      return new HTMLRewriter()
        .on('title', { element(e) { e.setInnerContent(`${card.title} · Score Chalk`); } })
        .on('meta[property="og:title"]', content(card.title))
        .on('meta[property="og:description"]', content(card.description))
        .on('meta[name="description"]', content(card.description))
        .transform(res);
    }

    return env.ASSETS.fetch(request);
}
