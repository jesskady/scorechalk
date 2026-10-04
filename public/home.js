/* The game chooser's My games: builder games saved to the profile, listed
   under the site's own games when signed in. Signed out, or with sign-in not
   configured, the section stays hidden and the page is exactly as before.
   Needs /builder/rules.js for defaultRules and describeRules. */

(function () {
  const box = document.getElementById('mine');
  const list = document.getElementById('mineList');
  if (!box || !list) return;

  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };

  function chevron() {
    const wrap = el('span', 'game-go');
    wrap.setAttribute('aria-hidden', 'true');
    wrap.innerHTML =
      '<svg viewBox="0 0 24 24" width="14" height="14">' +
      '<path d="M9 5.5 L15 12 L9 18.5" fill="none" stroke="currentColor" stroke-width="2.6" ' +
      'stroke-linecap="round" stroke-linejoin="round"/></svg>';
    return wrap;
  }

  function tile(g) {
    const a = el('a', 'game small');
    a.href = '/builder/#my/' + encodeURIComponent(g.id);
    const icon = el('span', 'game-icon', '⭐');
    icon.setAttribute('aria-hidden', 'true');
    const text = el('span', 'game-text');
    text.append(el('b', null, g.name),
      el('small', null, describeRules({ ...defaultRules(), ...g.rules })));
    a.append(icon, text, chevron());
    return a;
  }

  function show(games) {
    if (games.length) {
      games.forEach((g) => list.append(tile(g)));
    } else {
      // the section is how anyone finds out games can be saved at all
      const p = el('p', 'mine-empty');
      p.append('Build a game in the ');
      const a = el('a', null, 'ScoreChalk Builder');
      a.href = '/builder/';
      p.append(a, ' and save it, and it will be here.');
      list.append(p);
    }
    box.classList.remove('hidden');
  }

  const getJSON = (url) =>
    fetch(url, { headers: { accept: 'application/json' } }).then((r) => (r.ok ? r.json() : null));

  getJSON('/api/me')
    .then((me) => (me && me.user ? getJSON('/api/custom-games') : null))
    .then((data) => { if (data) show(data.games || []); })
    .catch(() => { /* offline or signed out: the page is complete without it */ });
})();
