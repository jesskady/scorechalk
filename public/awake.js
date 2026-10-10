/* Keeping the screen on through a game: a phone dimming and locking between
   turns is the commonest annoyance at a table. While a game is on screen the
   page asks for a screen wake lock; the browser drops it whenever the page
   is hidden, so it is asked for again on return. Where the browser can't,
   nothing happens and the phone sleeps as usual.

     SCAwake.keep(true)    a game is on screen
     SCAwake.keep(false)   back to a setup or a list */

window.SCAwake = (function () {
  let want = false, lock = null;

  async function take() {
    if (!want || lock || !('wakeLock' in navigator) || document.visibilityState !== 'visible') return;
    try {
      lock = await navigator.wakeLock.request('screen');
      lock.addEventListener('release', () => { lock = null; });
    } catch (e) { /* not allowed now, or not supported: the phone sleeps as usual */ }
  }
  document.addEventListener('visibilitychange', take);

  return {
    keep(on) {
      want = !!on;
      if (want) take();
      else if (lock) { lock.release().catch(() => {}); lock = null; }
    },
  };
})();
