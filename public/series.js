/* A series: game after game of the same players and rules, each started
   with Rematch, and who won each. Best two of three, or of five, or just a
   running tally: nobody has to keep it, as the game remembers.

   A game started with Rematch carries `series`, the winners of the games
   before it in order: a player's (or a side's) place, or null for a tie.
   New setup starts a fresh one, with none.

     SCSeries.add(series, winner)   the series with one more game's winner
                                    added: a new array
     SCSeries.move(series, place)   the series after Edit moved the players
                                    (place from SCEditGame.moves)
     SCSeries.text(names, series)   "After 3 games: Ann 2 · Bob 1", or ''
                                    for a single game (nothing to tally yet)
     SCSeries.show(el, names, series)  that, in el, hidden when empty
     SCSeries.next(names, series)   "Game 3 · Ann 2 · Bob 0": said as a
                                    rematch starts, '' for the first */

window.SCSeries = (function () {
  const add = (series, winner) => [...(series || []), Number.isInteger(winner) ? winner : null];

  const move = (series, place) => (Array.isArray(series) ? series.map((w) => (w == null ? w : place(w))) : series);

  // Each player's wins, most first (the order they play in, when level),
  // and the ties, if there were any.
  function standing(names, series) {
    const wins = names.map((_, i) => series.filter((w) => w === i).length);
    const order = names.map((_, i) => i).sort((a, b) => wins[b] - wins[a]);
    const parts = order.map((i) => `${names[i]} ${wins[i]}`);
    const ties = series.filter((w) => w == null).length;
    if (ties) parts.push(`${ties} tied`);
    return parts.join(' · ');
  }

  function text(names, series) {
    if (!Array.isArray(series) || series.length < 2 || names.length < 2) return '';
    return `After ${series.length} games: ${standing(names, series)}`;
  }

  function show(el, names, series) {
    if (!el) return;
    el.textContent = text(names, series);
    el.hidden = !el.textContent;
  }

  function next(names, series) {
    if (!Array.isArray(series) || !series.length || names.length < 2) return '';
    return `Game ${series.length + 1} · ${standing(names, series)}`;
  }

  return { add, move, text, show, next };
})();
