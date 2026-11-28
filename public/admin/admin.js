/* The admin side: what is in the database, and deleting users and games.
   Everything comes from /api/admin (worker/admin.js), which answers only an
   account named in ADMIN_EMAILS; this page is just a way of looking.

   Where you are is kept in the address, so a reload or Back lands on it:
     #overview
     #activity/<days>
     #users  or  #users/<search>
     #errors/latest  or  #errors/count
     #log
     #work/<open|done|dismissed|all>[/<source>]   the work board
     #tables/<table>  or  #tables/<table>/<column>/<value>[/<offset>] */

(function () {
  const view = document.getElementById('view');
  const tabs = document.getElementById('tabs');

  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };
  const note = (text) => el('p', 'adm-note', text);

  async function api(path, method = 'GET') {
    const r = await fetch('/api/admin' + path, { method, headers: { accept: 'application/json' } });
    const data = await r.json().catch(() => null);
    if (!r.ok) throw Object.assign(new Error((data && data.error) || `Error ${r.status}`), { status: r.status });
    return data;
  }

  const fmtDate = (ms) => new Date(ms).toLocaleString(undefined,
    { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const isTime = (col) => /(_at|_seen)$/.test(col);
  const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;
  const go = (hash) => { location.hash = hash; };
  const part = (s) => encodeURIComponent(s);

  /* A delete button that asks first: one tap arms it, a second within a few
     seconds deletes. Nothing here can be undone. */
  function deleteButton(label, ask, run) {
    const b = el('button', 'adm-del', label);
    let armed = null;
    b.addEventListener('click', async () => {
      if (!armed) {
        b.textContent = ask;
        b.classList.add('armed');
        armed = setTimeout(() => { armed = null; b.textContent = label; b.classList.remove('armed'); }, 4000);
        return;
      }
      clearTimeout(armed);
      b.disabled = true;
      b.textContent = 'Deleting…';
      try { await run(); }
      catch (e) { b.textContent = e.message; b.classList.remove('armed'); }
    });
    return b;
  }

  /* ---------------- overview ---------------- */

  async function overview() {
    const d = await api('/overview');
    const out = [];

    if (d.size_bytes != null) {
      const mb = d.size_bytes / 1024 / 1024;
      const used = el('section', 'adm-card');
      used.append(el('h2', null, 'Database'),
        el('p', null, `${mb.toFixed(2)} MB of the ${d.ceiling_mb} MB ceiling`));
      const bar = el('div', 'adm-bar');
      const fill = el('span');
      fill.style.width = Math.min(100, (mb / d.ceiling_mb) * 100).toFixed(1) + '%';
      bar.append(fill);
      used.append(bar);
      out.push(used);
    }

    const grid = el('div', 'adm-grid');
    for (const t of d.tables) {
      const a = el('a', 'adm-tile');
      a.href = '#tables/' + part(t.name);
      a.append(el('b', null, t.rows.toLocaleString()), el('span', null, t.name));
      grid.append(a);
    }
    const tables = el('section', 'adm-card');
    tables.append(el('h2', null, 'Tables'), grid);
    out.push(tables);
    return out;
  }

  /* ---------------- users ---------------- */

  function initials(name) {
    return (name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';
  }

  function userRow(u, me) {
    const row = el('li', 'adm-user');
    const pic = el('span', 'adm-avatar', initials(u.display_name));
    if (u.avatar_url) {
      const img = el('img', 'adm-avatar');
      img.src = u.avatar_url; img.alt = ''; img.referrerPolicy = 'no-referrer';
      img.addEventListener('error', () => img.replaceWith(pic));
      row.append(img);
    } else row.append(pic);

    const who = el('div', 'adm-who');
    who.append(el('b', null, u.display_name + (u.id === me ? ' (you)' : '')), el('small', null, u.email || 'no email'));
    const facts = [`joined ${fmtDate(u.created_at)}`, plural(u.games, 'game'), plural(u.custom_games, 'My game', 'My games')];
    if (u.last_played) facts.push(`last saved ${fmtDate(u.last_played)}`);
    who.append(el('small', null, facts.join(' · ')));
    row.append(who);

    const acts = el('div', 'adm-acts');
    const games = el('a', 'adm-btn', 'Games');
    games.href = `#tables/games/owner_user_id/${part(u.id)}`;
    const custom = el('a', 'adm-btn', 'My games');
    custom.href = `#tables/custom_games/owner_user_id/${part(u.id)}`;
    acts.append(games, custom);
    if (u.id !== me) {
      acts.append(deleteButton('Delete', `Delete with ${plural(u.games + u.custom_games, 'save')}?`, async () => {
        await api('/rows/users/' + part(u.id), 'DELETE');
        row.remove();
      }));
    }
    row.append(acts);
    return row;
  }

  async function users(q, offset = 0) {
    const form = el('form', 'adm-search');
    const input = el('input');
    input.type = 'search'; input.placeholder = 'Name, email or id'; input.value = q;
    form.append(input, el('button', 'adm-btn', 'Search'));
    form.addEventListener('submit', (e) => { e.preventDefault(); go('users' + (input.value.trim() ? '/' + part(input.value.trim()) : '')); });

    const d = await api(`/users?q=${part(q)}&offset=${offset}`);
    const card = el('section', 'adm-card');
    card.append(el('h2', null, q ? `Users matching “${q}”` : 'Users, newest first'));
    if (!d.users.length) card.append(note('No users.'));
    const list = el('ul', 'adm-users');
    d.users.forEach((u) => list.append(userRow(u, d.me)));
    card.append(list);
    if (d.more) {
      const more = el('button', 'adm-btn adm-more', 'More');
      let shown = d.users.length;
      more.addEventListener('click', async () => {
        more.disabled = true;
        const next = await api(`/users?q=${part(q)}&offset=${offset + shown}`);
        shown += next.users.length;
        next.users.forEach((u) => list.append(userRow(u, d.me)));
        if (next.more) more.disabled = false; else more.remove();
      });
      card.append(more);
    }
    return [form, card];
  }

  /* ---------------- tables ---------------- */

  // A long value — a game's state, an error's stack — shows its start, and
  // all of it when tapped.
  function cell(col, v) {
    const td = el('td');
    if (v == null) { td.append(el('span', 'adm-null', 'null')); return td; }
    if (isTime(col) && typeof v === 'number' && v > 0) {
      td.textContent = fmtDate(v);
      td.title = String(v);
      return td;
    }
    const s = String(v);
    if (s.length <= 80) { td.textContent = s; return td; }
    td.textContent = s.slice(0, 80) + '…';
    td.className = 'adm-long';
    td.title = 'Tap to show all';
    td.addEventListener('click', () => {
      const open = td.classList.toggle('open');
      td.textContent = open ? pretty(s) : s.slice(0, 80) + '…';
    });
    return td;
  }

  function pretty(s) {
    try { return JSON.stringify(JSON.parse(s), null, 2); } catch { return s; }
  }

  // Columns that point at another table's row, so a user's id can be
  // followed to their games and a game's to its turns.
  function link(table, col, v) {
    if (v == null) return null;
    if (col === 'owner_user_id' || col === 'user_id') return ['users', 'id'];
    // in shared_cells and shared_seats it means a shared game, elsewhere a game
    if (col === 'game_id') return table.startsWith('shared_') ? ['shared_games', 'id'] : ['games', 'id'];
    if (col === 'id' && table === 'users') return ['games', 'owner_user_id'];
    if (col === 'id' && table === 'games') return ['turns', 'game_id'];
    if (col === 'id' && table === 'shared_games') return ['shared_cells', 'game_id'];
    return null;
  }

  async function tables(name, col, val, offset) {
    const names = (await api('/overview')).tables;
    if (!name) name = names[0] && names[0].name;

    const pick = el('select');
    for (const t of names) {
      const o = el('option', null, `${t.name} (${t.rows.toLocaleString()})`);
      o.value = t.name;
      if (t.name === name) o.selected = true;
      pick.append(o);
    }
    pick.addEventListener('change', () => go('tables/' + part(pick.value)));

    const d = await api(`/tables/${part(name)}?offset=${offset}` + (col ? `&col=${part(col)}&val=${part(val)}` : ''));

    // the filter: one column equal to one value
    const form = el('form', 'adm-search');
    const colPick = el('select');
    colPick.append(Object.assign(el('option', null, 'Filter by…'), { value: '' }));
    for (const c of d.columns) {
      const o = el('option', null, c);
      o.value = c;
      if (c === col) o.selected = true;
      colPick.append(o);
    }
    const valIn = el('input');
    valIn.placeholder = 'equals'; valIn.value = val || '';
    form.append(pick, colPick, valIn, el('button', 'adm-btn', 'Filter'));
    if (col) {
      const clear = el('a', 'adm-btn', 'Clear');
      clear.href = '#tables/' + part(name);
      form.append(clear);
    }
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      go('tables/' + part(name) + (colPick.value ? `/${part(colPick.value)}/${part(valIn.value)}` : ''));
    });

    const card = el('section', 'adm-card');
    const shown = d.rows.length ? `${offset + 1}–${offset + d.rows.length} of ${d.total.toLocaleString()}` : 'No rows';
    card.append(el('h2', null, `${name}${col ? ` where ${col} = ${val}` : ''} · ${shown}`));
    if (!d.key) card.append(note('Looked at only: rows here go when what they belong to is deleted.'));

    if (d.rows.length) {
      const wrap = el('div', 'adm-scroll');
      const t = el('table', 'adm-table');
      const head = el('tr');
      if (d.key) head.append(el('th'));
      d.columns.forEach((c) => head.append(el('th', null, c)));
      t.append(head);
      for (const r of d.rows) {
        const tr = el('tr');
        if (d.key) {
          const td = el('td', 'adm-rowdel');
          td.append(deleteButton('Delete', 'Sure?', async () => {
            await api(`/rows/${part(name)}/${part(String(r[d.key]))}`, 'DELETE');
            tr.remove();
          }));
          tr.append(td);
        }
        for (const c of d.columns) {
          const td = cell(c, r[c]);
          const to = link(name, c, r[c]);
          if (to && !td.classList.contains('adm-long')) {
            const a = el('a', null, td.textContent);
            a.href = `#tables/${to[0]}/${to[1]}/${part(String(r[c]))}`;
            td.replaceChildren(a);
          }
          tr.append(td);
        }
        t.append(tr);
      }
      wrap.append(t);
      card.append(wrap);
    }

    // the pager
    const base = '#tables/' + part(name) + (col ? `/${part(col)}/${part(val)}` : '/-/-');
    const pager = el('div', 'adm-pager');
    if (offset > 0) {
      const prev = el('a', 'adm-btn', '‹ Newer');
      prev.href = `${base}/${Math.max(0, offset - d.page)}`;
      pager.append(prev);
    }
    if (offset + d.rows.length < d.total) {
      const next = el('a', 'adm-btn', 'Older ›');
      next.href = `${base}/${offset + d.page}`;
      pager.append(next);
    }
    if (pager.children.length) card.append(pager);

    return [form, card];
  }

  /* ---------------- activity ---------------- */

  const SVG = 'http://www.w3.org/2000/svg';
  const svg = (tag, attrs) => {
    const n = document.createElementNS(SVG, tag);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    return n;
  };
  const dayName = (ms) => new Date(ms).toLocaleDateString(undefined, { timeZone: 'UTC', day: 'numeric', month: 'short' });

  function tile(value, label, note) {
    const t = el('div', 'adm-stat');
    t.append(el('b', null, value.toLocaleString()), el('span', null, label));
    if (note) t.append(el('small', null, note));
    return t;
  }

  /* One measure, a bar a day: one hue, so no legend — the title names it.
     The top of each bar is rounded and its foot sits on the baseline; a
     hover (or a tap) on a day's column shows that day's number. */
  function dayBars(title, unit, values, firstDay) {
    const card = el('section', 'adm-card adm-chart');
    const total = values.reduce((a, b) => a + b, 0);
    card.append(el('h2', null, `${title} · ${total.toLocaleString()}`));

    // Drawn at the width it is shown at, and again when that changes, so
    // the labels stay at their own size rather than scaling with the card.
    const H = 130, top = 14, bottom = 20, left = 28;
    const max = Math.max(1, ...values);
    const plotH = H - top - bottom;
    const wrap = el('div', 'adm-plot');
    const tip = el('div', 'adm-tip hidden');
    const label = (x, y, text, anchor) => {
      const t = svg('text', { x, y, class: 'adm-tick', 'text-anchor': anchor });
      t.textContent = text;
      return t;
    };

    function draw(W) {
      const step = (W - left) / values.length;
      const gap = Math.min(2, step / 3);                     // a 2px surface gap between bars
      const g = svg('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, class: 'adm-svg', role: 'img',
        'aria-label': `${title}: ${total} over ${values.length} days, at most ${max} in a day` });

      // recessive frame: the baseline, the top value named once, the first and last day
      g.append(svg('line', { x1: left, x2: W, y1: top + plotH, y2: top + plotH, class: 'adm-axis' }));
      g.append(svg('line', { x1: left, x2: W, y1: top, y2: top, class: 'adm-grid' }));
      g.append(label(left - 6, top + 4, String(max), 'end'), label(left - 6, top + plotH + 4, '0', 'end'),
        label(left, H - 4, dayName(firstDay), 'start'),
        label(W, H - 4, dayName(firstDay + (values.length - 1) * 86400e3), 'end'));

      values.forEach((v, i) => {
        const x = left + i * step + gap / 2, w = Math.max(1, step - gap);
        if (v > 0) {
          const h = Math.max(2, (v / max) * plotH), y = top + plotH - h, r = Math.min(4, w / 2, h);
          g.append(svg('path', { class: 'adm-bar-mark',
            d: `M${x},${top + plotH} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${top + plotH} Z` }));
        }
        // the hit target is the whole column, not just the bar
        const hit = svg('rect', { x: left + i * step, y: top, width: step, height: plotH, class: 'adm-hit' });
        const showTip = () => {
          g.querySelectorAll('.adm-hit.on').forEach((n) => n.classList.remove('on'));
          tip.textContent = `${dayName(firstDay + i * 86400e3)} · ${plural(v, unit)}`;
          tip.classList.remove('hidden');
          tip.style.left = Math.min(W - 50, Math.max(50, left + (i + 0.5) * step)) + 'px';
          hit.classList.add('on');
        };
        const hideTip = () => { tip.classList.add('hidden'); hit.classList.remove('on'); };
        // a mouse shows it while over the day; a finger by tapping, until the next tap
        hit.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') showTip(); });
        hit.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') hideTip(); });
        hit.addEventListener('click', showTip);
        g.append(hit);
      });
      tip.classList.add('hidden');
      wrap.replaceChildren(g, tip);
    }

    let drawn = 0;
    new ResizeObserver(() => {
      const W = Math.floor(wrap.clientWidth);
      if (W > 0 && W !== drawn) { drawn = W; draw(W); }
    }).observe(wrap);
    card.append(wrap);
    return card;
  }

  // Which games are played: one bar each, longest first, the number beside it.
  function typeBars(types, days) {
    const card = el('section', 'adm-card');
    card.append(el('h2', null, `Games played, last ${days} days`));
    if (!types.length) { card.append(note('No games saved yet.')); return card; }
    const max = Math.max(1, ...types.map((t) => t.recent));
    const list = el('div', 'adm-hbars');
    for (const t of types) {
      const row = el('div', 'adm-hbar');
      row.title = `${t.game_type}: ${t.recent} in the last ${days} days, ${t.total} in all`;
      const track = el('div', 'adm-htrack');
      const fill = el('span');
      fill.style.width = (t.recent / max * 100) + '%';
      track.append(fill);
      row.append(el('span', 'adm-hname', t.game_type), track,
        el('span', 'adm-hval', `${t.recent.toLocaleString()}`), el('small', null, `${t.total.toLocaleString()} in all`));
      list.append(row);
    }
    card.append(list);
    return card;
  }

  // The same numbers as the charts, day by day, for reading or copying.
  function dayTable(d) {
    const box = el('details', 'adm-card');
    box.append(el('summary', null, 'The same, as a table'));
    const wrap = el('div', 'adm-scroll');
    const t = el('table', 'adm-table');
    const head = el('tr');
    ['Day', 'Sign-ups', 'Games started', 'Games finished', 'Shares', 'My games'].forEach((h) => head.append(el('th', null, h)));
    t.append(head);
    const s = d.series;
    for (let i = d.days - 1; i >= 0; i--) {
      const tr = el('tr');
      tr.append(el('td', null, dayName(d.first_day + i * 86400e3)));
      [s.signups, s.started, s.finished, s.shares, s.custom].forEach((col) => tr.append(el('td', null, String(col[i]))));
      t.append(tr);
    }
    wrap.append(t);
    box.append(wrap);
    return box;
  }

  async function activity(days) {
    const d = await api(`/activity?days=${days}`);
    const sum = (a) => a.reduce((x, y) => x + y, 0);

    const range = el('div', 'adm-search');
    for (const n of [7, 30, 90, 365]) {
      const a = el('a', 'adm-btn' + (n === d.days ? ' on' : ''), n === 365 ? 'Year' : `${n} days`);
      a.href = `#activity/${n}`;
      range.append(a);
    }

    const stats = el('div', 'adm-stats');
    stats.append(
      tile(sum(d.series.signups), 'sign-ups', `${d.totals.users.toLocaleString()} users in all`),
      tile(d.active_users, 'players saving games', 'accounts with a game saved'),
      tile(sum(d.series.started), 'games started', `${d.totals.games.toLocaleString()} in all`),
      tile(sum(d.series.finished), 'games finished'),
      tile(sum(d.series.shares), 'games shared', `${d.totals.shares.toLocaleString()} kept now`),
    );

    const charts = el('div', 'adm-charts');
    charts.append(
      dayBars('Sign-ups', 'sign-up', d.series.signups, d.first_day),
      dayBars('Games started', 'game', d.series.started, d.first_day),
      dayBars('Games finished', 'game', d.series.finished, d.first_day),
      dayBars('Games shared', 'share', d.series.shares, d.first_day),
    );
    return [range, stats, charts, typeBars(d.types, d.days),
      note('Days are UTC. Shared games are those still kept: any left unchanged for 30 days are let go.'), dayTable(d)];
  }

  /* ---------------- errors ---------------- */

  function errorRow(e) {
    const row = el('li', 'adm-err');
    const head = el('div', 'adm-err-head');
    head.append(el('span', 'adm-badge ' + e.source, e.source), el('span', 'adm-count', '×' + e.count.toLocaleString()));
    const msg = el('b', 'adm-err-msg', e.message);
    const facts = [e.place, e.page && e.page !== e.place ? 'on ' + e.page : null,
      `last ${fmtDate(e.last_seen)}`, `first ${fmtDate(e.first_seen)}`].filter(Boolean);
    const more = el('details');
    more.append(el('summary', null, 'Stack and browser'), el('pre', null, (e.stack || 'no stack') + (e.agent ? '\n\n' + e.agent : '')));
    const fixed = deleteButton('Mark fixed', 'Sure? It comes back if it happens again', async () => {
      await api('/rows/errors/' + part(e.key), 'DELETE');
      row.remove();
    });
    row.append(head, msg, el('small', null, facts.join(' · ')), more, fixed);
    return row;
  }

  async function errors(sort) {
    const d = await api('/errors' + (sort === 'count' ? '?sort=count' : ''));
    const bar = el('div', 'adm-search');
    for (const [key, label] of [['latest', 'Latest'], ['count', 'Commonest']]) {
      const a = el('a', 'adm-btn' + ((sort === 'count') === (key === 'count') ? ' on' : ''), label);
      a.href = '#errors/' + key;
      bar.append(a);
    }
    const card = el('section', 'adm-card');
    card.append(el('h2', null, `${plural(d.last_day.n, 'error')} in the last day, of ${plural(d.last_day.kinds, 'kind')}`));
    if (!d.errors.length) card.append(note('No errors kept. Errors unseen for 30 days are cleared by the daily job.'));
    const list = el('ul', 'adm-errs');
    d.errors.forEach((e) => list.append(errorRow(e)));
    card.append(list);
    return [bar, card];
  }

  /* ---------------- the log ---------------- */

  function logRow(x) {
    const row = el('li', 'adm-log');
    row.append(
      el('small', null, `${fmtDate(x.at)} · ${x.admin_email || 'unknown admin'}`),
      el('b', null, `${x.action === 'fixed' ? 'Marked fixed' : 'Deleted'} from ${x.target}: ${x.summary || ''}`),
      el('small', 'adm-mono', x.target_id),
    );
    return row;
  }

  async function log() {
    const card = el('section', 'adm-card');
    card.append(el('h2', null, 'What admins have done, newest first'));
    const list = el('ul', 'adm-logs');
    card.append(list);
    let offset = 0;
    const more = el('button', 'adm-btn adm-more', 'More');
    async function page() {
      more.disabled = true;
      const d = await api('/log?offset=' + offset);
      offset += d.entries.length;
      d.entries.forEach((x) => list.append(logRow(x)));
      if (!offset) card.append(note('Nothing yet. Every delete from this page is written here.'));
      if (d.more) more.disabled = false; else more.remove();
    }
    more.addEventListener('click', page);
    card.append(more);
    await page();
    return [card];
  }

  /* ---------------- the work board ---------------- */

  // Which statuses each filter shows. Open is what's still to be done.
  const FILTERS = { open: ['doing', 'new', 'todo'], done: ['done'], dismissed: ['dismissed'], all: null };
  const ORDER = ['doing', 'new', 'todo', 'done', 'dismissed'];
  const IMPACT = { High: 0, Med: 1, Low: 2 };
  const idNum = (id) => Number((id.match(/\d+$/) || [0])[0]);

  async function send(path, method, body) {
    const r = await fetch('/api/admin' + path, {
      method, headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify(body || {}),
    });
    const data = await r.json().catch(() => null);
    if (!r.ok) throw new Error((data && data.error) || `Error ${r.status}`);
    return data;
  }

  // The ledgers are Markdown: `code` and **bold** are shown as such, the rest as text.
  function inline(text) {
    const p = el('p', 'adm-md');
    String(text || '').split(/(`[^`]+`|\*\*[^*]+\*\*)/).forEach((bit) => {
      if (/^`.+`$/.test(bit)) p.append(el('code', null, bit.slice(1, -1)));
      else if (/^\*\*.+\*\*$/.test(bit)) p.append(el('b', null, bit.slice(2, -2)));
      else if (bit) p.append(document.createTextNode(bit));
    });
    return p;
  }

  function statusPick(statuses, value) {
    const s = el('select', 'adm-status');
    for (const k of ORDER) {
      const o = el('option', null, statuses[k]);
      o.value = k;
      if (k === value) o.selected = true;
      s.append(o);
    }
    return s;
  }

  function workRow(it, d, recount) {
    const row = el('li', 'adm-work');
    row.dataset.status = it.status;
    const from = it.source === 'me' ? 'Mine' : (d.sources[it.source] || it.source);

    const head = el('div', 'adm-work-head');
    const facts = el('div', 'adm-work-facts');
    facts.append(el('span', 'adm-mono adm-work-id', it.id));
    // an agent's items are all of its one kind, which the source already says
    if (it.source === 'me') facts.append(el('span', 'adm-badge kind-' + it.kind, it.kind));
    if (it.impact) facts.append(el('span', 'adm-badge imp-' + it.impact.toLowerCase(), it.impact + ' impact'));
    if (it.effort) facts.append(el('span', 'adm-badge', 'effort ' + it.effort));
    facts.append(el('small', null, [from, it.area].filter(Boolean).join(' · ')));

    const pick = statusPick(d.statuses, it.status);
    pick.setAttribute('aria-label', `Status of ${it.id}`);
    pick.addEventListener('change', async () => {
      pick.disabled = true;
      try {
        const r = await send('/work/item/' + part(it.id), 'PATCH', { status: pick.value });
        Object.assign(it, r.item);
        row.dataset.status = it.status;
        recount();
        if (body.isConnected && !body.classList.contains('hidden')) fill();
      } catch (e) { pick.value = it.status; alertIn(row, e.message); }
      pick.disabled = false;
    });
    head.append(facts, pick);

    const title = el('button', 'adm-work-title', it.title);
    title.setAttribute('aria-expanded', 'false');
    const body = el('div', 'adm-work-body hidden');

    // what's inside is drawn when first opened, and again after a change
    async function fill() {
      const parts = [];
      if (it.detail) parts.push(inline(it.detail));
      if (it.agent_notes) {
        const det = el('details');
        det.append(el('summary', null, `What the ${from} last saw` + (it.last_checked ? `, ${it.last_checked}` : '')), inline(it.agent_notes));
        parts.push(det);
      }
      const dates = [it.first_seen && `first seen ${it.first_seen}`,
        it.agent_status && it.agent_status !== d.statuses[it.status] && `the ledger says ${it.agent_status}`,
        it.done_at && `done ${fmtDate(it.done_at)}`].filter(Boolean);
      if (dates.length) parts.push(el('small', null, dates.join(' · ')));

      // your own notes: kept apart from the ledger's, so a sync never touches them
      const notes = el('textarea', 'adm-notes');
      notes.placeholder = 'Your notes';
      notes.value = it.notes || '';
      notes.rows = Math.min(8, Math.max(2, (it.notes || '').split('\n').length + 1));
      const save = el('button', 'adm-btn', 'Save notes');
      save.addEventListener('click', async () => {
        save.disabled = true;
        try {
          Object.assign(it, (await send('/work/item/' + part(it.id), 'PATCH', { notes: notes.value })).item);
          save.textContent = 'Saved';
          setTimeout(() => { save.textContent = 'Save notes'; }, 1500);
          showLog();
        } catch (e) { save.textContent = e.message; }
        save.disabled = false;
      });
      const acts = el('div', 'adm-acts');
      acts.append(save);
      if (it.source === 'me') {
        acts.append(deleteButton('Delete', 'Sure? It goes for good', async () => {
          await send('/work/item/' + part(it.id), 'DELETE');
          d.items.splice(d.items.indexOf(it), 1);
          row.remove();
          recount();
        }));
      }
      const hist = el('ul', 'adm-hist');
      async function showLog() {
        const r = await api('/work/item/' + part(it.id));
        hist.replaceChildren(...r.log.map((x) => {
          const li = el('li');
          li.append(el('small', null, `${fmtDate(x.at)} · ${x.by}`), document.createTextNode(' ' + x.change));
          return li;
        }));
      }
      parts.push(notes, acts, hist);
      body.replaceChildren(...parts);
      showLog().catch(() => {});
    }

    title.addEventListener('click', () => {
      const open = body.classList.toggle('hidden') === false;
      title.setAttribute('aria-expanded', String(open));
      if (open) fill();
    });
    row.append(head, title, body);
    return row;
  }

  function alertIn(row, msg) {
    const n = note(msg);
    row.append(n);
    setTimeout(() => n.remove(), 5000);
  }

  // a new bug, idea or task, written by hand
  function addForm(onAdded) {
    const box = el('details', 'adm-card adm-add');
    box.append(el('summary', null, 'Add a bug, idea or task'));
    const form = el('form', 'adm-form');
    const title = Object.assign(el('input'), { placeholder: 'What is it?', required: true, maxLength: 200, name: 'title' });
    const kind = el('select');
    kind.name = 'kind';
    for (const k of ['bug', 'improvement', 'idea', 'task']) kind.append(Object.assign(el('option', null, k), { value: k }));
    const impact = el('select');
    impact.name = 'impact';
    impact.append(Object.assign(el('option', null, 'Impact…'), { value: '' }));
    for (const k of ['High', 'Med', 'Low']) impact.append(Object.assign(el('option', null, k), { value: k }));
    const detail = Object.assign(el('textarea'), { placeholder: 'Details: where it happens, what should happen instead', rows: 3, name: 'detail' });
    const go = el('button', 'adm-btn', 'Add');
    const row = el('div', 'adm-search');
    row.append(kind, impact, go);
    form.append(title, detail, row);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      go.disabled = true;
      try {
        await send('/work', 'POST', { title: title.value, kind: kind.value, impact: impact.value || null, detail: detail.value });
        form.reset();
        await onAdded();
      } catch (err) { go.textContent = err.message; setTimeout(() => { go.textContent = 'Add'; }, 3000); }
      go.disabled = false;
    });
    box.append(form);
    return box;
  }

  async function workBoard(filter, source) {
    if (!(filter in FILTERS)) filter = 'open';
    const d = await api('/work');
    const base = (f, s) => `#work/${f}` + (s ? '/' + part(s) : '');

    const bar = el('div', 'adm-search');
    for (const [k, label] of [['open', 'Open'], ['done', 'Done'], ['dismissed', "Won't do"], ['all', 'All']]) {
      const a = el('a', 'adm-btn' + (k === filter ? ' on' : ''), label);
      a.href = base(k, source);
      bar.append(a);
    }
    const from = el('select');
    from.setAttribute('aria-label', 'Where items came from');
    from.append(Object.assign(el('option', null, 'Everywhere'), { value: '' }));
    for (const [k, name] of [...Object.entries(d.sources), ['me', 'Mine']]) {
      const o = Object.assign(el('option', null, name), { value: k });
      if (k === source) o.selected = true;
      from.append(o);
    }
    from.addEventListener('change', () => go(base(filter, from.value).slice(1)));
    const find = Object.assign(el('input'), { type: 'search', placeholder: 'Find' });
    find.setAttribute('aria-label', 'Find an item');
    const sync = el('button', 'adm-btn', 'Sync ledgers');
    sync.type = 'button';
    bar.append(from, find, sync);

    const stats = el('div', 'adm-stats adm-work-stats');
    const list = el('ul', 'adm-works');
    const card = el('section', 'adm-card');
    const heading = el('h2');
    const empty = note('');
    card.append(heading, list, empty);
    const syncNote = note('');
    syncNote.classList.add('hidden');

    const inSource = (it) => !source || it.source === source;
    function recount() {
      const n = {};
      d.items.filter(inSource).forEach((it) => { n[it.status] = (n[it.status] || 0) + 1; });
      stats.replaceChildren(...ORDER.map((k) => {
        const a = el('a', 'adm-stat adm-stat-link st-' + k);
        a.href = base(k === 'done' || k === 'dismissed' ? k : 'open', source);
        a.append(el('b', null, String(n[k] || 0)), el('span', null, d.statuses[k]));
        return a;
      }));
    }

    function draw() {
      const want = FILTERS[filter];
      const q = find.value.trim().toLowerCase();
      const shown = d.items
        .filter((it) => inSource(it) && (!want || want.includes(it.status)))
        .filter((it) => !q || [it.id, it.title, it.detail, it.area, it.notes].some((s) => s && s.toLowerCase().includes(q)))
        .sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status) ||
          (IMPACT[a.impact] ?? 3) - (IMPACT[b.impact] ?? 3) ||
          a.id.split('-')[0].localeCompare(b.id.split('-')[0]) || idNum(a.id) - idNum(b.id));
      heading.textContent = `${plural(shown.length, 'item')}${q ? ` matching “${find.value.trim()}”` : ''}`;
      list.replaceChildren(...shown.map((it) => workRow(it, d, recount)));
      empty.textContent = shown.length ? '' : (d.items.length ? 'Nothing here.' : 'No items yet. Sync the ledgers, or add one.');
    }
    find.addEventListener('input', draw);

    async function reload() {
      Object.assign(d, await api('/work'));
      recount();
      draw();
    }

    sync.addEventListener('click', async () => {
      sync.disabled = true;
      sync.textContent = 'Syncing…';
      try {
        const r = (await send('/work/sync', 'POST')).results;
        syncNote.textContent = r.map((x) => `${d.sources[x.source] || x.source}: ` + (x.error ? `couldn't read the ledger (${x.error})`
          : `${plural(x.rows, 'row')}, ${x.added} new, ${x.moved} moved by the agent`)).join('. ') + '.';
        await reload();
      } catch (e) { syncNote.textContent = e.message; }
      syncNote.classList.remove('hidden');
      sync.disabled = false;
      sync.textContent = 'Sync ledgers';
    });

    recount();
    draw();
    return [bar, syncNote, stats, addForm(reload), card,
      note('Agent items come from their ledgers on GitHub, read every morning and when you press Sync. A status you set here stays until the agent reports a different one.')];
  }

  /* ---------------- where you are ---------------- */

  async function show() {
    const [tab, ...rest] = (location.hash.slice(1) || 'overview').split('/').map(decodeURIComponent);
    for (const a of tabs.querySelectorAll('a')) a.classList.toggle('on', a.dataset.tab === tab);
    view.replaceChildren(note('Loading…'));
    try {
      let nodes;
      if (tab === 'work') nodes = await workBoard(rest[0] || 'open', rest[1] || '');
      else if (tab === 'users') nodes = await users(rest[0] || '');
      else if (tab === 'activity') nodes = await activity(Number(rest[0]) || 30);
      else if (tab === 'errors') nodes = await errors(rest[0]);
      else if (tab === 'log') nodes = await log();
      else if (tab === 'tables') {
        const [name, col, val, offset] = rest;
        const filtered = col && col !== '-';
        nodes = await tables(name, filtered ? col : null, filtered ? val : null, Number(offset) || 0);
      } else nodes = await overview();
      view.replaceChildren(...nodes);
      tabs.classList.remove('hidden');
    } catch (e) {
      if (e.status === 403) {
        tabs.classList.add('hidden');
        const a = el('a', 'adm-btn', 'Sign in');
        a.href = '/auth/google/start?next=' + encodeURIComponent('/admin/');
        view.replaceChildren(note('This page is for Score Chalk admins. Sign in with an admin account to use it.'), a);
      } else view.replaceChildren(note('Could not load: ' + e.message));
    }
  }

  window.addEventListener('hashchange', show);
  show();
})();
