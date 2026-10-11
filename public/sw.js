/* Score Chalk's service worker: the site keeps working with no signal.

   On install it fetches every game page, and everything each one loads —
   scripts, styles, images — so any game opens offline, even one not yet
   visited, and a game in progress opens by its own link (?g=<id>) from
   the games kept on the device (see /store.js).

   - Pages are fetched fresh whenever there is a connection, so a deploy
     shows at once; the copy kept is only for when there isn't one.
   - Scripts and styles with a ?v= are never changed under that version,
     so they come from the copy kept; anything else is shown from the copy
     and refreshed behind it.
   - /api/ and /auth/ — sharing, sign-in, the profile — are live, and
     never kept.
   - The fonts come from Google, and are kept once fetched.

   VERSION is changed when this file changes in a way the old copies can't
   carry over; the old ones are then let go. */

const VERSION = 'sc-v2';
const FONTS = 'sc-fonts';
const PAGES = ['/', '/darts/', '/cribbage/', '/yahtzee/', '/magic/', '/builder/', '/privacy/', '/terms/'];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    for (const page of PAGES) {
      try {
        const res = await fetch(page, { cache: 'no-cache' });
        if (!res.ok) continue;
        await cache.put(page, res.clone());
        // and what the page loads, from this site
        const html = await res.text();
        const wanted = [...html.matchAll(/(?:src|href)="([^"#:]+\.(?:js|css|png|svg|webmanifest)(?:\?[^"]*)?)"/g)]
          .map((m) => new URL(m[1], location.origin + page).href);
        await Promise.all([...new Set(wanted)].map((u) => cache.add(u).catch(() => {})));
      } catch (e) { /* offline while installing: it fills in as pages are visited */ }
    }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== VERSION && key !== FONTS) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(fromCopy(req, FONTS));
    return;
  }
  if (url.origin !== location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/')) return;

  if (req.mode === 'navigate') event.respondWith(page(req, url));
  else if (url.searchParams.has('v')) event.respondWith(fromCopy(req, VERSION));
  else event.respondWith(copyThenRefresh(req));
});

// A page: fresh when there's a connection, kept by its path for when there
// isn't — whatever ?g or ?s it was opened with, which the page reads itself.
async function page(req, url) {
  const cache = await caches.open(VERSION);
  try {
    const res = await fetch(req);
    // a shared game's link has its card filled in for that game: not the page to keep
    if (res.ok && !url.searchParams.has('s')) cache.put(url.pathname, res.clone());
    return res;
  } catch (e) {
    return (await cache.match(url.pathname)) || (await cache.match('/')) || Response.error();
  }
}

async function fromCopy(req, name) {
  const cache = await caches.open(name);
  const kept = await cache.match(req);
  if (kept) return kept;
  const res = await fetch(req);
  if (res.ok || res.type === 'opaque') cache.put(req, res.clone());
  return res;
}

async function copyThenRefresh(req) {
  const cache = await caches.open(VERSION);
  const kept = await cache.match(req);
  const fresh = fetch(req).then((res) => { if (res.ok) cache.put(req, res.clone()); return res; }).catch(() => kept);
  return kept || fresh;
}
