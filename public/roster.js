/* Reordering a players' list (.roster, styled in /shared.css) by dragging
   the grip at the end of a row — the tournament's setup and the Builder's.

     SCRoster.grip(label)        a grip button for a row, to append to its li
     SCRoster.sortable(list, onMove)
                                 lets the rows of the <ol> be dragged by their
                                 grips; onMove(from, to) is told where one
                                 went, and redraws the list itself

   While a row is dragged it follows the finger, and the rows it passes slide
   out of its way, so where it will land is plain before it is let go. The
   list itself is only changed by onMove, once, on letting go. A grip also
   moves its row with the arrow keys. Rows hidden (a setup showing fewer
   players than it has rows, as Darts does) are passed over: hidden rows
   come last, so a row's place among those shown is its place in the list. */

window.SCRoster = (function () {
  function grip(label) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'roster-grip';
    b.setAttribute('aria-label', label);
    return b;
  }

  function sortable(list, onMove) {
    let drag = null;   // { li, from, to, y0, mids, h, id }
    const shown = () => [...list.children].filter((x) => !x.hidden && !x.classList.contains('hidden'));

    list.addEventListener('pointerdown', (e) => {
      const g = e.target.closest('.roster-grip');
      if (!g || drag) return;
      const li = g.closest('li'), rows = shown();
      const from = rows.indexOf(li);
      if (from < 0 || rows.length < 2) return;
      e.preventDefault();
      g.setPointerCapture(e.pointerId);
      const r = li.getBoundingClientRect();
      // where each row's middle is now, for working out where this one lands
      drag = {
        li, from, to: from, y0: e.clientY, id: e.pointerId, rows,
        h: r.height, mids: rows.map((x) => { const b = x.getBoundingClientRect(); return b.top + b.height / 2; }),
      };
      li.classList.add('dragging');
      list.classList.add('sorting');
    });

    list.addEventListener('pointermove', (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const dy = e.clientY - drag.y0;
      drag.li.style.transform = `translateY(${dy}px)`;
      // its middle, as dragged, against the others' middles
      const mid = drag.mids[drag.from] + dy;
      let to = drag.from;
      while (to < drag.rows.length - 1 && mid > drag.mids[to + 1]) to++;
      while (to > 0 && mid < drag.mids[to - 1]) to--;
      drag.to = to;
      drag.rows.forEach((x, i) => {
        if (x === drag.li) return;
        const shift = drag.from < to && i > drag.from && i <= to ? -drag.h
          : drag.from > to && i < drag.from && i >= to ? drag.h : 0;
        x.style.transform = shift ? `translateY(${shift}px)` : '';
      });
    });

    const end = (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const { from, to, rows, li } = drag;
      drag = null;
      rows.forEach((x) => { x.style.transform = ''; });
      li.classList.remove('dragging');
      list.classList.remove('sorting');
      if (to !== from && e.type === 'pointerup') onMove(from, to);
    };
    list.addEventListener('pointerup', end);
    list.addEventListener('pointercancel', end);

    // the arrow keys, for a grip that has the focus
    list.addEventListener('keydown', (e) => {
      const g = e.target.closest('.roster-grip');
      if (!g || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
      const rows = shown(), from = rows.indexOf(g.closest('li'));
      const to = from + (e.key === 'ArrowUp' ? -1 : 1);
      if (to < 0 || to >= rows.length) return;
      e.preventDefault();
      onMove(from, to);
      const again = list.children[to] && list.children[to].querySelector('.roster-grip');
      if (again) again.focus();
    });
  }

  return { grip, sortable };
})();
