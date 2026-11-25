/* Writes public/sitemap.xml: every page search engines should find, each
   with the date its page last changed in git. Run `npm run sitemap` after
   committing a change to a page, then commit the sitemap. The profile, the
   admin side and the not-found page are left out on purpose: they are
   noindex (see finish in worker/index.js). */

import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const PAGES = [
  '/', '/darts/', '/cribbage/', '/yahtzee/', '/magic/', '/builder/', '/tournament/',
  '/cribbage-score-keeper/', '/yahtzee-score-sheet/', '/darts-scorer/', '/mtg-life-counter/',
  '/canasta-score-keeper/', '/farkle-score-sheet/', '/score-keeper/',
  '/privacy/', '/terms/',
];

const changed = (page) => {
  const dir = page === '/' ? 'public/index.html' : `public${page}`;
  return execFileSync('git', ['log', '-1', '--format=%cs', '--', dir], { encoding: 'utf8' }).trim();
};

const rows = PAGES.map((p) => {
  const d = changed(p);
  return `  <url><loc>https://scorechalk.com${p}</loc>${d ? `<lastmod>${d}</lastmod>` : ''}</url>`;
});
writeFileSync('public/sitemap.xml',
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${rows.join('\n')}\n</urlset>\n`);
console.log(`sitemap.xml: ${rows.length} pages`);
