/* The all-games page's search. The list is plain HTML, so it can be read
   (and found by search engines) without this; typing narrows it to the
   games whose name, note, kind (Cards, Dice…) or other words (data-also) hold every word
   typed. The Builder row is always left showing: whatever someone came
   looking for, it can keep score for it. The search is kept in the address
   (?q=), so a reload or a shared link shows the same list. */

(function () {
  const q = document.getElementById('q');
  const rows = [...document.querySelectorAll('#list li')];
  const count = document.getElementById('count');
  const none = document.getElementById('none');

  // lower case, accents dropped, punctuation as spaces: "Phase-10" finds "phase 10"
  const plain = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ').trim();
  const text = rows.map((li) => plain(`${li.textContent} ${li.dataset.also || ''}`));
  const games = rows.filter((li) => !li.classList.contains('any')).length;

  function show() {
    const words = plain(q.value).split(' ').filter(Boolean);
    let found = 0;
    rows.forEach((li, i) => {
      const hit = li.classList.contains('any') || words.every((w) => text[i].includes(w));
      li.hidden = !hit;
      if (hit && !li.classList.contains('any')) found++;
    });
    count.textContent = words.length ? `${found} of ${games} games` : `${games} games`;
    none.hidden = found > 0;
  }

  const from = new URLSearchParams(location.search).get('q');
  if (from) q.value = from;
  q.addEventListener('input', () => {
    show();
    const url = new URL(location.href);
    if (q.value.trim()) url.searchParams.set('q', q.value.trim()); else url.searchParams.delete('q');
    history.replaceState(null, '', url);
  });
  // Enter opens the game when the search has narrowed to one
  q.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const hits = rows.filter((li) => !li.hidden && !li.classList.contains('any'));
    if (hits.length === 1) location.href = hits[0].querySelector('a').href;
  });
  show();
})();
