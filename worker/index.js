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
import { createShare, getShare, putShare, putCells, claimSeat, freeSeat, deleteShare } from './share.js';

const CANONICAL = 'scorechalk.com';

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.hostname === 'www.' + CANONICAL) {
      url.hostname = CANONICAL;
      return Response.redirect(url.toString(), 301);
    }

    if (url.pathname === '/api/me') {
      // Deliberately not an error when auth is unconfigured: the site is
      // usable signed out, so "nobody is signed in" is the honest answer.
      if (!authConfigured(env)) return json({ user: null, auth: false });
      return json({ ...(await me(request, env)), auth: true });
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

    // Shared games: open to anyone holding a link, signed in or not
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

    return env.ASSETS.fetch(request);
  },
};
