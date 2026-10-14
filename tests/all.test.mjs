/* The test run: one server and one browser for every suite, started here
   once and stopped at the end. `npm test` runs this file; see README.md.

   Each suite plays the site as people would — with phones of their own
   storage, tapping what a person taps where it matters — and checks what
   they would see. They are slow by the clock (phones look for news every
   few seconds), and run one after another. */

import { before, after } from 'node:test';
import { startServer, stopServer, startBrowser, stopBrowser } from './helpers.mjs';

before(async () => {
  await startServer();
  await startBrowser();
}, { timeout: 120000 });

after(async () => {
  await stopBrowser();
  await stopServer();
});

await import('./links.mjs');
await import('./builder.mjs');
await import('./sharing.mjs');
await import('./darts.mjs');
await import('./cribbage.mjs');
await import('./server.mjs');
await import('./offline.mjs');
await import('./tournament.mjs');
