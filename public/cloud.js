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
     SCCloud.offer(el, { build, me, pick })
                           a result screen's line about the profile: signed
                           in, the game saved there and saying so; signed
                           out, an offer to sign in and keep it, asking
                           which player you were when it doesn't know
     SCCloud.claiming(id)  whether this page is the way back from signing in
                           to keep game id, so the game shows its result
                           screen again and offer() saves it

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

  /* Signing in from a result screen. The finished game is still kept on
     this device (see /store.js), and the game's address carries its id, so
     Google sends us back to the same game. A note of which game it was says
     the result screen is wanted again, and offer() saves it on arrival. An
     hour is far longer than signing in takes, and short enough that an old
     note never surprises anyone. */
  const CLAIM = 'sc-keep';
  const claim = () => { try { return JSON.parse(localStorage.getItem(CLAIM)); } catch (e) { return null; } };
  const claiming = (id) => { const c = claim(); return !!(c && id && c.id === id && Date.now() - c.at < 3600e3); };
  const unclaim = () => { try { localStorage.removeItem(CLAIM); } catch (e) { /* private mode */ } };

  function node(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  async function offer(el, opts) {
    if (!el) return;
    el.replaceChildren();
    el.onclick = null;
    el.classList.remove('keep');
    if (window.SCWatching) return;
    const data = await me();
    if (!data || !data.auth) return;       // sign-in not set up here: nothing to offer
    const body = opts.build();
    if (!body) return;

    if (data.user) {
      const back = claiming(body.id);
      el.textContent = 'Saving to your profile…';
      try {
        if (!(await queue(() => send(opts.build)))) { el.textContent = ''; return; }
        if (back) unclaim();
        el.replaceChildren(back ? 'Signed in, and this game is saved to ' : 'Saved to ', Object.assign(node('a', null, 'your profile'), { href: '/account/' }));
      } catch (e) {
        el.textContent = 'Could not save to your profile. Tap to try again.';
        el.onclick = () => offer(el, opts);
      }
      return;
    }

    // Signed out. Which player you were decides whose statistics the game
    // goes to, so it is asked when the setup didn't, rather than guessed.
    const names = body.players.map((p) => p.name);
    let mine = Number.isInteger(opts.me) && opts.me < names.length ? opts.me : names.length === 1 ? 0 : null;
    el.classList.add('keep');
    const lede = node('span', 'keep-lede');
    lede.append(node('b', null, 'Keep this game? '), 'Sign in and it’s saved to your profile, with your results and stats from every game after it.');
    el.append(lede);

    let row = null;
    if (names.length > 1) {
      row = node('span', 'keep-who');
      const ask = node('span', 'keep-ask', 'You were');
      row.append(ask);
      names.forEach((name, i) => {
        const b = node('button', 'seg' + (i === mine ? ' is-on' : ''), name);
        b.type = 'button';
        b.onclick = () => {
          mine = i;
          row.querySelectorAll('.seg').forEach((x, j) => x.classList.toggle('is-on', j === i));
          ask.classList.remove('is-asking');
          if (opts.pick) opts.pick(i);
        };
        row.append(b);
      });
      el.append(row);
    }

    const go = node('a', 'keep-go');
    go.append(node('span', 'acct-g', 'G'), node('span', null, 'Sign in to save it'));
    go.href = '/auth/google/start?next=' + encodeURIComponent(location.pathname + location.search + location.hash);
    go.onclick = (e) => {
      if (mine === null) {
        e.preventDefault();
        row.querySelector('.keep-ask').classList.add('is-asking');
        row.querySelector('.keep-ask').textContent = 'Which one were you?';
        return;
      }
      try { localStorage.setItem(CLAIM, JSON.stringify({ id: body.id, at: Date.now() })); } catch (err) { /* private mode: signs in all the same */ }
    };
    el.append(go);
  }

  return {
    me,
    offer,
    claiming,

    // Watching someone else's game by link (see /share.js) saves nothing.
    keep(build) {
      if (window.SCWatching) return;
      pending = build;
      clearTimeout(timer);
      timer = setTimeout(flush, 800);
    },

    now(build) {
      if (window.SCWatching) return Promise.resolve(false);
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
