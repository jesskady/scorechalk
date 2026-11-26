/* Writes public/sitemap.xml: every page in pages.mjs, each with the date its
   content last changed in git (commits marked `Sitemap: chrome` don't count;
   see pages.mjs). `npm run deploy` runs this first, so the live sitemap is
   never behind the pages; when it changes the file, commit it. */

import { readFileSync, writeFileSync } from 'node:fs';
import { ORIGIN, PAGES, contentCommits } from './pages.mjs';

const FILE = 'public/sitemap.xml';
const rows = PAGES.map((p) => {
  const d = contentCommits(p)[0]?.[1];
  return `  <url><loc>${ORIGIN}${p}</loc>${d ? `<lastmod>${d}</lastmod>` : ''}</url>`;
});
const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${rows.join('\n')}\n</urlset>\n`;

let before = '';
try { before = readFileSync(FILE, 'utf8').replace(/\r\n/g, '\n'); } catch (e) { /* first time */ }
writeFileSync(FILE, xml);
console.log(`sitemap.xml: ${rows.length} pages, ` + (xml === before ? 'unchanged.' : 'updated: commit public/sitemap.xml.'));
