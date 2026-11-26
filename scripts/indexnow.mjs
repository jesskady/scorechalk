/* After a deploy, tells search engines that use IndexNow (Bing, and through
   it DuckDuckGo and others; Yandex; Seznam) which pages changed, so they
   crawl them again soon instead of whenever they next happen by. Google
   doesn't use IndexNow; it has the sitemap's dates.

   `npm run deploy` runs this after `wrangler deploy`. It sends the pages
   whose content changed since the commit it last sent for (commits marked
   `Sitemap: chrome` don't count; see pages.mjs), which it keeps in
   .wrangler/indexnow-last (not in git, so each machine keeps its own). The
   first time, with nothing kept, it sends every page. A failed ping never
   fails the deploy: it says so, and the next deploy sends those pages again.

   The key proves the site is ours: search engines fetch it from
   public/<KEY>.txt, which must hold the key and nothing else. It is public
   by design.

   `node scripts/indexnow.mjs --dry-run` lists what would be sent. */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { ORIGIN, PAGES, git, contentCommits } from './pages.mjs';

const KEY = '4be6f923f66ca69a5ae6683142929759';
const KEPT = '.wrangler/indexnow-last';
const dry = process.argv.includes('--dry-run');

const head = git('rev-parse', 'HEAD');
let last = '';
try { last = readFileSync(KEPT, 'utf8').trim(); } catch (e) { /* first time */ }
try { if (last) git('cat-file', '-e', last + '^{commit}'); } catch (e) { last = ''; }

const changed = last
  ? PAGES.filter((p) => contentCommits(p, `${last}..${head}`).length)
  : PAGES;

if (!changed.length) {
  console.log('IndexNow: no page changed since the last ping.');
  process.exit(0);
}

const urlList = changed.map((p) => ORIGIN + p);
if (dry) {
  console.log(`IndexNow (dry run), ${last ? 'changed since ' + last.slice(0, 7) : 'first ping, every page'}:\n  ${urlList.join('\n  ')}`);
  process.exit(0);
}

try {
  const res = await fetch('https://api.indexnow.org/indexnow', {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ host: new URL(ORIGIN).host, key: KEY, keyLocation: `${ORIGIN}/${KEY}.txt`, urlList }),
  });
  // 200 and 202 both mean taken; anything else is reported and retried next deploy
  if (res.status === 200 || res.status === 202) {
    mkdirSync('.wrangler', { recursive: true });
    writeFileSync(KEPT, head + '\n');
    console.log(`IndexNow: sent ${urlList.length} page(s), answered ${res.status}.`);
  } else {
    console.log(`IndexNow: not sent, answered ${res.status} ${await res.text().catch(() => '')}`.trim());
  }
} catch (err) {
  console.log('IndexNow: not sent (' + err.message + '). The next deploy will send these pages again.');
}
