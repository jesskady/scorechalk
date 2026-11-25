/* The pages search engines should find, for the sitemap (sitemap.mjs) and
   the IndexNow ping after a deploy (indexnow.mjs). The profile, the admin
   side and the not-found page are left out on purpose: they are noindex
   (see finish in worker/index.js). */

import { execFileSync } from 'node:child_process';

export const ORIGIN = 'https://scorechalk.com';

export const PAGES = [
  '/', '/darts/', '/cribbage/', '/yahtzee/', '/magic/', '/builder/', '/tournament/',
  '/cribbage-score-keeper/', '/yahtzee-score-sheet/', '/darts-scorer/', '/mtg-life-counter/',
  '/canasta-score-keeper/', '/farkle-score-sheet/', '/score-keeper/',
  '/privacy/', '/terms/',
];

// what in public/ makes up a page: its own folder, or index.html for the home page
export const source = (page) => (page === '/' ? 'public/index.html' : `public${page}`);

export const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
