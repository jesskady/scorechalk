/* The pages search engines should find, for the sitemap (sitemap.mjs) and
   the IndexNow ping after a deploy (indexnow.mjs). The profile, the admin
   side and the not-found page are left out on purpose: they are noindex
   (see finish in worker/index.js). */

import { execFileSync } from 'node:child_process';

export const ORIGIN = 'https://scorechalk.com';

export const PAGES = [
  '/', '/darts/', '/cribbage/', '/yahtzee/', '/magic/', '/builder/', '/tournament/',
  '/cribbage-score-keeper/', '/yahtzee-score-sheet/', '/darts-scorer/', '/mtg-life-counter/',
  '/canasta-score-keeper/', '/farkle-score-sheet/', '/uno-score-keeper/', '/euchre-score-keeper/', '/score-keeper/',
  '/privacy/', '/terms/',
];

// what in public/ makes up a page: its own folder, or index.html for the home page
export const source = (page) => (page === '/' ? 'public/index.html' : `public${page}`);

export const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();

/* A change to what every page shares (the header, the badge, a stylesheet's
   ?v= bump) touches every page's files, but isn't a change to any page's
   content, and search engines should hear about content changes only:
   Google trusts a sitemap's dates only while they stay accurate. So a
   commit like that carries the line `Sitemap: chrome` in its message, and
   the sitemap and the IndexNow ping skip it. Use it only on commits that
   change nothing else: a page's real change in the same commit would be
   skipped with it. */
export const CHROME_TRAILER = 'Sitemap: chrome';
// commits of that kind from before the trailer existed
const CHROME_BEFORE_TRAILER = ['f120507'];

// The commits that changed a page's content, newest first, as [hash, date];
// only those within `range` (such as 'abc1234..HEAD') when it is given.
export function contentCommits(page, range) {
  const out = git('log', '--format=%H %cs', '--invert-grep', `--grep=^${CHROME_TRAILER}$`,
    ...(range ? [range] : []), '--', source(page));
  return out.split('\n').filter(Boolean).map((l) => l.split(' '))
    .filter(([h]) => !CHROME_BEFORE_TRAILER.some((c) => h.startsWith(c)));
}
