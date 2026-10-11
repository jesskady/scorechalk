/* Score Chalk as an app: the service worker that keeps it working offline
   (see /sw.js), and — where the browser offers installing — an "Install
   the app" button, on any page that has one (#installBtn). On an iPhone
   installing is Share › Add to Home Screen, which a page can't offer. */

(function () {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(() => { /* the site works as before */ });
    });
  }

  let offer = null;
  const btn = () => document.getElementById('installBtn');
  const installed = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();          // offered by our button, not the browser's banner
    offer = e;
    const b = btn();
    if (b && !installed()) b.hidden = false;
  });
  window.addEventListener('appinstalled', () => {
    offer = null;
    const b = btn();
    if (b) b.hidden = true;
  });
  document.addEventListener('click', async (e) => {
    if (!offer || !e.target.closest('#installBtn')) return;
    const o = offer;
    offer = null;
    o.prompt();
    await o.userChoice.catch(() => {});
    const b = btn();
    if (b) b.hidden = true;
  });
})();
