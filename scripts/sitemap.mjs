/* Writes public/sitemap.xml: every page in pages.mjs, each with the date its
   page last changed in git. Run `npm run sitemap` after committing a change
   to a page, then commit the sitemap. */

import { writeFileSync } from 'node:fs';
import { ORIGIN, PAGES, source, git } from './pages.mjs';

const rows = PAGES.map((p) => {
  const d = git('log', '-1', '--format=%cs', '--', source(p));
  return `  <url><loc>${ORIGIN}${p}</loc>${d ? `<lastmod>${d}</lastmod>` : ''}</url>`;
});
writeFileSync('public/sitemap.xml',
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${rows.join('\n')}\n</urlset>\n`);
console.log(`sitemap.xml: ${rows.length} pages`);
