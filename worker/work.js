/* The work board: /admin/#work. One list of everything there is to do on
   the site, whoever thought of it: the scheduled agents' suggestions, and
   bugs and ideas written in by hand so they aren't lost.

   An agent's items come from its ledger in the repo, a Markdown table with
   one row per item and stable IDs (qa/seo/ledger.md; the format is in
   .claude/agents/scorechalk-seo-auditor.md). The repo is public, so the
   ledger is read straight from GitHub: once a day by the scheduled job,
   and whenever Sync is pressed. A new agent is one more entry in SOURCES,
   as long as its ledger uses the same columns.

   Who decides an item's status: the board, until the agent changes its
   mind. A sync only moves an item when the ledger's status differs from
   what the ledger said last time (agent_status, migrations/0011), so
   marking something Won't do here sticks until the agent reports something
   new about it, such as finding it done on the live site.

   Served under /api/admin (worker/admin.js has already checked the admin):
   GET    /api/admin/work              every item, and the sources
   GET    /api/admin/work/item/<id>    one item's history
   POST   /api/admin/work              a new item, by hand
   PATCH  /api/admin/work/item/<id>    status, notes, or `note` (one dated line
                                       added to them); title, detail, kind and
                                       impact too for one written by hand
   DELETE /api/admin/work/item/<id>    only one written by hand: an agent's
                                       would come back at the next sync
   POST   /api/admin/work/sync         read every ledger from GitHub now
   POST   /api/admin/work/import       {source, markdown}: read a ledger from
                                       the request instead (the tests, or a
                                       ledger on a branch not pushed yet)

   The same paths under /api/work answer a token instead: see workApi. */

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

const RAW = 'https://raw.githubusercontent.com/jesskady/scorechalk/refs/heads/';

export const SOURCES = {
  seo: { name: 'SEO audit', kind: 'seo', url: RAW + 'qa/seo/qa/seo/ledger.md' },
};

export const STATUSES = { new: 'New', todo: 'To do', doing: 'In progress', done: 'Done', dismissed: "Won't do" };
const KINDS = ['bug', 'improvement', 'idea', 'task', 'seo'];
const IMPACTS = ['High', 'Med', 'Low'];

// the ledgers' words for a status, in the board's
function fromLedger(word) {
  const w = String(word || '').toLowerCase().replace(/\*/g, '').trim();
  if (w === 'new') return 'new';
  if (w === 'done') return 'done';
  if (w === 'dismissed') return 'dismissed';
  if (w === 'partly done' || w === 'in progress') return 'doing';
  return 'todo';                          // Pending, and anything unforeseen
}

/* The rows of a ledger's table, by its header's names, so a column added or
   moved doesn't put the wrong thing in the wrong place. Rows without an ID
   like SEO-012 are skipped: the header's rule line, and anything else. */
export function parseLedger(md) {
  const rows = [];
  let head = null;
  for (const line of String(md).split(/\r?\n/)) {
    const t = line.trim();
    if (!t.startsWith('|')) { head = null; continue; }   // a table ends at its first other line
    const cells = t.replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
    if (!head) { head = cells.map((c) => c.toLowerCase()); continue; }
    const r = {};
    head.forEach((h, i) => { r[h] = cells[i] || ''; });
    const id = (r.id || '').replace(/\*/g, '');
    if (!/^[A-Z]{1,10}-\d{1,5}$/.test(id)) continue;
    const pick = (...names) => {
      const k = head.find((h) => names.some((n) => h.startsWith(n)));
      return k ? r[k] : '';
    };
    rows.push({
      id,
      detail: pick('suggestion', 'finding', 'item', 'title'),
      area: pick('area') || null,
      impact: normImpact(pick('impact', 'severity')),
      effort: pick('effort') || null,
      first_seen: pick('first seen') || null,
      status: pick('status'),
      last_checked: pick('last checked') || null,
      notes: pick('evidence', 'notes') || null,
    });
  }
  return rows;
}

function normImpact(s) {
  const w = String(s || '').toLowerCase();
  if (w.startsWith('h')) return 'High';
  if (w.startsWith('m')) return 'Med';
  if (w.startsWith('l')) return 'Low';
  return null;
}

/* A one-line title from a ledger's suggestion: its first sentence, without
   the Markdown bold, cut at a word if it runs long. A full stop inside
   `code` (a file name, `?v=`) doesn't end the sentence. */
export function titleOf(text) {
  const s = String(text || '').replace(/\*\*/g, '').trim();
  let end = s.length, code = false;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '`') code = !code;
    else if (!code && '.!?'.includes(s[i]) && (i + 1 === s.length || /\s/.test(s[i + 1])) &&
      !/\b(e\.g|i\.e|etc|vs|aka)\.$/i.test(s.slice(0, i + 1))) { end = i + 1; break; }
  }
  let t = s.slice(0, end).replace(/\.$/, '');
  if (t.length > 140) t = t.slice(0, 140).replace(/\s+\S*$/, '') + '…';
  return t || s.slice(0, 140);
}

/* Bring one source's items in line with its ledger. Only what changed is
   written, and every status the agent changes is logged as the sync's. */
export async function importLedger(env, source, md) {
  const src = SOURCES[source];
  if (!src) throw new Error('No such source');
  const rows = parseLedger(md);
  const { results } = await env.DB.prepare('SELECT * FROM work_items WHERE source = ?').bind(source).all();
  const have = new Map(results.map((r) => [r.id, r]));
  const now = Date.now();
  const by = 'sync: ' + source;
  const stmts = [];
  const log = (id, change) => stmts.push(env.DB.prepare(
    'INSERT INTO work_log (item_id, at, by, change) VALUES (?, ?, ?, ?)').bind(id, now, by, change));
  let added = 0, moved = 0, refreshed = 0;

  for (const r of rows) {
    const status = fromLedger(r.status);
    const title = titleOf(r.detail);
    const old = have.get(r.id);
    if (!old) {
      stmts.push(env.DB.prepare(
        `INSERT INTO work_items (id, source, kind, title, detail, area, impact, effort, status, agent_status,
                                 agent_notes, first_seen, last_checked, created_at, updated_at, done_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
        r.id, source, src.kind, title, r.detail, r.area, r.impact, r.effort, status, r.status,
        r.notes, r.first_seen, r.last_checked, now, now, status === 'done' ? now : null));
      log(r.id, `Added by the ${src.name} as ${STATUSES[status]}`);
      added++;
      continue;
    }
    // the agent's word changed: it wins, this once
    const agentMoved = old.agent_status !== r.status && old.status !== status;
    const same = old.title === title && old.detail === r.detail && old.area === r.area && old.impact === r.impact &&
      old.effort === r.effort && old.agent_status === r.status && old.agent_notes === r.notes &&
      old.first_seen === r.first_seen && old.last_checked === r.last_checked;
    if (same) continue;
    const next = agentMoved ? status : old.status;
    stmts.push(env.DB.prepare(
      `UPDATE work_items SET title = ?, detail = ?, area = ?, impact = ?, effort = ?, agent_status = ?,
              agent_notes = ?, first_seen = ?, last_checked = ?, status = ?, updated_at = ?, done_at = ?
        WHERE id = ?`).bind(
      title, r.detail, r.area, r.impact, r.effort, r.status, r.notes, r.first_seen, r.last_checked,
      next, agentMoved ? now : old.updated_at, doneAt(old, next, now), r.id));
    if (agentMoved) { log(r.id, `${STATUSES[old.status]} → ${STATUSES[next]} (the ${src.name} says ${r.status})`); moved++; }
    else refreshed++;
  }
  // D1 takes a batch as one transaction; a ledger is a few hundred rows at most
  if (stmts.length) await env.DB.batch(stmts);
  return { source, rows: rows.length, added, moved, refreshed };
}

const doneAt = (old, next, now) => (next === 'done' ? (old.status === 'done' ? old.done_at : now) : null);

// Every source, from GitHub. One failing doesn't stop the rest.
export async function syncWork(env) {
  const out = [];
  for (const [source, src] of Object.entries(SOURCES)) {
    try {
      const r = await fetch(src.url, { headers: { 'user-agent': 'scorechalk-worker' }, cf: { cacheTtl: 0 } });
      if (!r.ok) throw new Error(`GitHub answered ${r.status}`);
      out.push(await importLedger(env, source, await r.text()));
    } catch (e) {
      out.push({ source, error: e.message });
    }
  }
  return out;
}

const clip = (s, n) => (s == null ? null : String(s).slice(0, n));

export async function work(request, env, path, by) {
  const m = request.method;

  if (path === '/work' && m === 'GET') {
    const { results } = await env.DB.prepare(
      `SELECT id, source, kind, title, detail, area, impact, effort, status, agent_status, agent_notes, notes,
              first_seen, last_checked, created_at, updated_at, done_at FROM work_items`).all();
    return json({
      items: results,
      statuses: STATUSES,
      sources: Object.fromEntries(Object.entries(SOURCES).map(([k, s]) => [k, s.name])),
    });
  }

  if (path === '/work' && m === 'POST') {
    const b = await request.json().catch(() => ({}));
    const title = String(b.title || '').trim().slice(0, 200);
    if (!title) return json({ error: 'An item needs a title' }, 400);
    const kind = KINDS.includes(b.kind) ? b.kind : 'task';
    const status = b.status in STATUSES ? b.status : 'todo';
    const n = await env.DB.prepare(
      "SELECT COALESCE(MAX(CAST(substr(id, 3) AS INTEGER)), 0) + 1 AS n FROM work_items WHERE id LIKE 'W-%'").first('n');
    const id = 'W-' + String(n).padStart(3, '0');
    const now = Date.now();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO work_items (id, source, kind, title, detail, impact, status, notes, created_at, updated_at, done_at)
         VALUES (?, 'me', ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
        id, kind, title, clip(b.detail, 20000) || null, IMPACTS.includes(b.impact) ? b.impact : null,
        status, clip(b.notes, 20000) || null, now, now, status === 'done' ? now : null),
      env.DB.prepare('INSERT INTO work_log (item_id, at, by, change) VALUES (?, ?, ?, ?)')
        .bind(id, now, by, `Added as ${STATUSES[status]}`),
    ]);
    return json({ ok: true, id });
  }

  if (path === '/work/sync' && m === 'POST') return json({ results: await syncWork(env) });

  if (path === '/work/import' && m === 'POST') {
    const b = await request.json().catch(() => ({}));
    if (!SOURCES[b.source]) return json({ error: 'No such source' }, 400);
    if (typeof b.markdown !== 'string' || !b.markdown) return json({ error: 'No ledger given' }, 400);
    return json(await importLedger(env, b.source, b.markdown.slice(0, 2e6)));
  }

  const one = path.match(/^\/work\/item\/([A-Za-z0-9-]{1,40})$/);
  if (!one) return json({ error: 'Not found' }, 404);
  const id = one[1];
  const old = await env.DB.prepare('SELECT * FROM work_items WHERE id = ?').bind(id).first();
  if (!old) return json({ error: 'Not found' }, 404);

  if (m === 'GET') {
    const { results } = await env.DB.prepare(
      'SELECT at, by, change FROM work_log WHERE item_id = ? ORDER BY id').bind(id).all();
    return json({ item: old, log: results });
  }

  if (m === 'PATCH') {
    const b = await request.json().catch(() => ({}));
    const mine = old.source === 'me';
    const next = { ...old };
    const changes = [];
    if (b.status !== undefined) {
      if (!(b.status in STATUSES)) return json({ error: 'No such status' }, 400);
      if (b.status !== old.status) { next.status = b.status; changes.push(`${STATUSES[old.status]} → ${STATUSES[b.status]}`); }
    }
    if (b.notes !== undefined && (clip(b.notes, 20000) || null) !== old.notes) {
      next.notes = clip(b.notes, 20000) || null;
      changes.push('Notes edited');
    }
    // a line added to the notes, dated, without having to send them all back:
    // "Deployed in 1a2b3c4" from a session that has just shipped it
    if (b.note !== undefined && String(b.note).trim()) {
      const line = `${new Date().toISOString().slice(0, 10)}: ${String(b.note).trim().slice(0, 2000)}`;
      next.notes = clip((next.notes ? next.notes + '\n' : '') + line, 20000);
      changes.push('Note: ' + String(b.note).trim().slice(0, 200));
    }
    // an agent's own words are the ledger's, and the next sync would put them back
    if (mine) {
      if (b.title !== undefined) {
        const t = String(b.title).trim().slice(0, 200);
        if (!t) return json({ error: 'An item needs a title' }, 400);
        if (t !== old.title) { next.title = t; changes.push('Title edited'); }
      }
      if (b.detail !== undefined && (clip(b.detail, 20000) || null) !== old.detail) { next.detail = clip(b.detail, 20000) || null; changes.push('Detail edited'); }
      if (b.kind !== undefined && KINDS.includes(b.kind) && b.kind !== old.kind) { next.kind = b.kind; changes.push(`Kind: ${b.kind}`); }
      if (b.impact !== undefined) {
        const imp = IMPACTS.includes(b.impact) ? b.impact : null;
        if (imp !== old.impact) { next.impact = imp; changes.push(`Impact: ${imp || 'none'}`); }
      }
    }
    if (!changes.length) return json({ ok: true, item: old });
    const now = Date.now();
    next.updated_at = now;
    next.done_at = doneAt(old, next.status, now);
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE work_items SET status = ?, notes = ?, title = ?, detail = ?, kind = ?, impact = ?, updated_at = ?, done_at = ?
          WHERE id = ?`).bind(next.status, next.notes, next.title, next.detail, next.kind, next.impact, now, next.done_at, id),
      ...changes.map((c) => env.DB.prepare('INSERT INTO work_log (item_id, at, by, change) VALUES (?, ?, ?, ?)')
        .bind(id, now, by, c)),
    ]);
    return json({ ok: true, item: next });
  }

  if (m === 'DELETE') {
    if (old.source !== 'me') return json({ error: `This came from the ${SOURCES[old.source] ? SOURCES[old.source].name : old.source}, and would come back at the next sync. Mark it Won't do instead.` }, 400);
    await env.DB.batch([
      env.DB.prepare('DELETE FROM work_items WHERE id = ?').bind(id),
      env.DB.prepare('DELETE FROM work_log WHERE item_id = ?').bind(id),
    ]);
    return json({ ok: true });
  }

  return json({ error: 'Method not allowed' }, 405);
}

/* The same board for the agents and for Claude sessions on the owner's
   laptop, which have no admin cookie: /api/work/..., the same paths as
   under /api/admin, with `Authorization: Bearer <WORK_TOKEN>`. WORK_TOKEN
   is a secret (wrangler secret put WORK_TOKEN); unset, this door is shut.
   In the cloud sandbox the token is a network secret for scorechalk.com,
   so the proxy adds the header and the agent never sees it; on the laptop
   scripts/work.mjs reads it from .work-token (gitignored).
   `X-Work-By` names who is acting ("seo audit", "claude"), for the history. */
export async function workApi(request, env, url) {
  const want = env.WORK_TOKEN;
  const got = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!want || want.length < 32 || !(await same(got, want))) return json({ error: 'Not allowed' }, 403);
  const who = (request.headers.get('x-work-by') || '').replace(/[^\w .()-]/g, '').trim().slice(0, 40);
  return work(request, env, url.pathname.slice('/api'.length), 'api: ' + (who || 'unnamed'));
}

// compared by their digests, so how long the check takes says nothing about the token
async function same(a, b) {
  const enc = new TextEncoder();
  const [x, y] = await Promise.all([a, b].map((s) => crypto.subtle.digest('SHA-256', enc.encode(s))));
  const u = new Uint8Array(x), v = new Uint8Array(y);
  let d = 0;
  for (let i = 0; i < u.length; i++) d |= u[i] ^ v[i];
  return d === 0;
}
