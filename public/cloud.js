/* Saving any game to the profile as it is played.

   Signed in, every game goes to the profile after each change, so it can be
   picked up again on another device and isn't lost with this one; signed
   out, none of this does anything. localStorage stays the live game: a save
   is quiet, and one that fails is made whole by the next, since every save
   sends the whole game (see worker/games.js).

   A game hands over a `build` function rather than the game itself. It runs
   when the save is sent and returns the payload for /api/games — the game's
   id, players, turns and, while unfinished, `state`: the game's own object,
   which is what resuming it puts back. It returns null when there is nothing
   worth saving yet, such as a game with no score in it.

     SCCloud.keep(build)   after a change: saved a moment later, so a run of
                           quick taps goes up as one save
     SCCloud.now(build)    at the end of a game: right away; resolves true
                           when saved, false when signed out, and throws when
                           the save failed, so the page can say so
     SCCloud.drop(id)      a game given up unfinished: off the profile too
     SCCloud.resumeId()    the ?resume=<id> a page was opened with, if any;
                           taken off the address so a reload doesn't repeat it
     SCCloud.load(id)      a saved game, with its state

   Saves and drops go one at a time in the order asked for, so an older save
   can never land after a newer one, or bring back a game just dropped. */

window.SCCloud = (function () {
  // one /api/me for the page, shared with account.js and darts' sync.js
  const me = () =>
    (window.SCMe ||
      (window.SCMe = fetch('/api/me', { headers: { accept: 'application/json' } })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null)));
  const signedIn = () => me().then((d) => !!(d && d.user));

  let chain = Promise.resolve();
  const queue = (job) => {
    const run = chain.then(job);
    chain = run.catch(() => {});
    return run;
  };

  async function send(build) {
    if (!(await signedIn())) return false;
    const body = build();
    if (!body) return false;
    const res = await fetch('/api/games', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'save failed');
    return true;
  }

  // known once /api/me answers, so a page that is closing can send at once
  let known = false;
  signedIn().then((v) => { known = v; });

  let pending = null, timer = null;
  function flush(closing) {
    clearTimeout(timer);
    const build = pending;
    pending = null;
    if (!build) return;
    if (closing && known) {
      // a closing page runs nothing it has to wait for, so this goes now,
      // as a request that outlives the page; browsers allow that only for
      // small bodies
      const body = build();
      if (!body) return;
      const text = JSON.stringify(body);
      try {
        fetch('/api/games', { method: 'POST', headers: { 'content-type': 'application/json' }, body: text, keepalive: text.length < 60000 });
      } catch (e) { /* the next save tries again */ }
      return;
    }
    queue(() => send(build)).catch(() => { /* the next save tries again */ });
  }
  // leaving the page, or switching away from it on a phone, sends what's waiting
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(true); });
  window.addEventListener('pagehide', () => flush(true));

  return {
    me,

    keep(build) {
      pending = build;
      clearTimeout(timer);
      timer = setTimeout(flush, 800);
    },

    now(build) {
      clearTimeout(timer);
      pending = null;
      return queue(() => send(build));
    },

    drop(id) {
      clearTimeout(timer);
      pending = null;
      if (!id) return Promise.resolve();
      return queue(async () => {
        if (!(await signedIn())) return;
        await fetch('/api/games/' + encodeURIComponent(id), { method: 'DELETE' });
      }).catch(() => {});
    },

    resumeId() {
      const q = new URLSearchParams(location.search);
      const id = q.get('resume');
      if (!id) return null;
      history.replaceState(null, '', location.pathname + location.hash);
      return id;
    },

    async load(id) {
      const res = await fetch('/api/games/' + encodeURIComponent(id), { headers: { accept: 'application/json' } });
      if (!res.ok) throw new Error('could not load that game');
      return (await res.json()).game;
    },
  };
})();
