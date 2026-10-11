/* What a page tells us, and nothing about the person using it.

   - Visits: Cloudflare Web Analytics, which counts pages, countries and
     devices with no cookies and nothing personal. Cloudflare adds it to
     the pages itself (see ANALYTICS_TOKEN below).
   - Errors: a script that fails on this site's own pages is sent to
     /api/errors (see worker/errors.js) — the message, where it happened,
     the page. At most a few per page, each only once; errors from browser
     extensions, and the browser's blank "Script error.", aren't ours. */

(function () {
  // Empty on purpose: Web Analytics for scorechalk.com is on "automatic
  // setup" in the Cloudflare dashboard (Analytics & Logs › Web Analytics),
  // which adds the counter itself. A token here as well would count every
  // visit twice. Set one only if automatic setup is ever switched off.
  const ANALYTICS_TOKEN = '';

  if (ANALYTICS_TOKEN) {
    const s = document.createElement('script');
    s.defer = true;
    s.src = 'https://static.cloudflareinsights.com/beacon.min.js';
    s.setAttribute('data-cf-beacon', JSON.stringify({ token: ANALYTICS_TOKEN }));
    document.head.appendChild(s);
  }

  const sent = new Set();
  let left = 5;

  function send(message, place, stack) {
    if (!message || left <= 0) return;
    const key = message + '|' + (place || '');
    if (sent.has(key)) return;
    sent.add(key);
    left -= 1;
    const body = JSON.stringify({ message: String(message).slice(0, 300), place, stack: stack ? String(stack).slice(0, 2000) : undefined, page: location.pathname });
    try {
      if (navigator.sendBeacon) navigator.sendBeacon('/api/errors', new Blob([body], { type: 'application/json' }));
      else fetch('/api/errors', { method: 'POST', headers: { 'content-type': 'application/json' }, body, keepalive: true });
    } catch (e) { /* reporting must never be the next error */ }
  }

  // a file of ours: the same origin, not an extension or another site
  const ours = (file) => !file || file.startsWith(location.origin);

  window.addEventListener('error', (e) => {
    if (!e.message || e.message === 'Script error.' || !ours(e.filename)) return;
    const file = e.filename ? e.filename.replace(location.origin, '') : '';
    send(e.message, file ? `${file}:${e.lineno}:${e.colno}` : null, e.error && e.error.stack);
  });

  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason;
    const message = r && r.message ? r.message : typeof r === 'string' ? r : null;
    // a fetch failing offline is expected, and every page already says so
    if (!message || /Failed to fetch|NetworkError|Load failed/i.test(message)) return;
    send('Unhandled: ' + message, null, r && r.stack);
  });
})();
