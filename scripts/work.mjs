/* The work board from a terminal: what a Claude session on the laptop uses
   to start an item, mark it done once it's deployed, or add a bug it found.
   It talks to the live site's /api/work (worker/work.js), with the token
   from WORK_TOKEN or the gitignored .work-token file at the repo root.

     npm run work -- list [open|done|dismissed|all] [seo|me]
     npm run work -- show SEO-012
     npm run work -- doing SEO-012 ["what's being done"]
     npm run work -- done SEO-012 ["Deployed in 1a2b3c4: what shipped"]
     npm run work -- todo|new|dismissed SEO-012 ["why"]
     npm run work -- note SEO-012 "a line for its notes"
     npm run work -- add bug|improvement|idea|task "title" ["detail"]
     npm run work -- sync

   WORK_URL points it elsewhere (http://localhost:8790 for npm run dev);
   WORK_BY names who is acting in the item's history (default "claude"). */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = (process.env.WORK_URL || 'https://scorechalk.com').replace(/\/$/, '');
const STATUS = { new: 'New', todo: 'To do', doing: 'In progress', done: 'Done', dismissed: "Won't do" };
const OPEN = ['doing', 'new', 'todo'];

function token() {
  if (process.env.WORK_TOKEN) return process.env.WORK_TOKEN.trim();
  try { return readFileSync(join(ROOT, '.work-token'), 'utf8').trim(); } catch { return ''; }
}

async function call(path, method = 'GET', body) {
  const t = token();
  if (!t) die('No token: put it in .work-token at the repo root, or set WORK_TOKEN.');
  const r = await fetch(BASE + '/api' + path, {
    method,
    headers: { authorization: 'Bearer ' + t, 'x-work-by': process.env.WORK_BY || 'claude', 'content-type': 'application/json' },
    body: body && JSON.stringify(body),
  });
  const data = await r.json().catch(() => null);
  if (!r.ok) die(`${r.status}: ${(data && data.error) || r.statusText}`);
  return data;
}

function die(msg) { console.error(msg); process.exit(1); }

const line = (i) => `${i.id.padEnd(8)} ${STATUS[i.status].padEnd(11)} ${(i.impact || '').padEnd(4)} ${i.title}`;

const [cmd, ...args] = process.argv.slice(2);

if (cmd === 'list' || !cmd) {
  const [which = 'open', source] = args;
  const { items } = await call('/work');
  const order = ['doing', 'new', 'todo', 'done', 'dismissed'];
  const rank = { High: 0, Med: 1, Low: 2 };
  const n = (id) => Number(id.replace(/\D/g, ''));
  const shown = items
    .filter((i) => which === 'all' || (which === 'open' ? OPEN.includes(i.status) : i.status === which))
    .filter((i) => !source || i.source === source)
    .sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status) || (rank[a.impact] ?? 3) - (rank[b.impact] ?? 3) || n(a.id) - n(b.id));
  shown.forEach((i) => console.log(line(i)));
  console.log(`\n${shown.length} ${which} of ${items.length}`);
} else if (cmd === 'show') {
  const { item: i, log } = await call('/work/item/' + encodeURIComponent(args[0] || die('Which item?')));
  console.log(`${i.id} · ${STATUS[i.status]} · ${[i.source === 'me' ? 'added by hand' : i.source, i.kind, i.area, i.impact && i.impact + ' impact', i.effort && 'effort ' + i.effort].filter(Boolean).join(' · ')}`);
  console.log(`\n${i.title}\n`);
  if (i.detail) console.log(i.detail + '\n');
  if (i.agent_notes) console.log(`What the agent last saw (${i.last_checked || '?'}; ledger says ${i.agent_status}):\n${i.agent_notes}\n`);
  if (i.notes) console.log(`Owner's notes:\n${i.notes}\n`);
  console.log('History:');
  log.forEach((x) => console.log(`  ${new Date(x.at).toISOString().slice(0, 16).replace('T', ' ')}  ${x.by}: ${x.change}`));
} else if (cmd in STATUS) {
  const [id, note] = args;
  if (!id) die('Which item?');
  const { item } = await call('/work/item/' + encodeURIComponent(id), 'PATCH', { status: cmd, ...(note ? { note } : {}) });
  console.log(line(item));
} else if (cmd === 'note') {
  const [id, note] = args;
  if (!id || !note) die('npm run work -- note <id> "text"');
  const { item } = await call('/work/item/' + encodeURIComponent(id), 'PATCH', { note });
  console.log(line(item));
} else if (cmd === 'add') {
  const [kind, title, detail] = args;
  if (!title) die('npm run work -- add bug|improvement|idea|task "title" ["detail"]');
  const { id } = await call('/work', 'POST', { kind, title, detail });
  console.log('Added ' + id);
} else if (cmd === 'sync') {
  const { results } = await call('/work/sync', 'POST');
  for (const r of results) console.log(r.error ? `${r.source}: ${r.error}` : `${r.source}: ${r.rows} rows, ${r.added} new, ${r.moved} moved by the agent, ${r.refreshed} refreshed`);
} else {
  die('Commands: list, show, doing, done, todo, new, dismissed, note, add, sync');
}
