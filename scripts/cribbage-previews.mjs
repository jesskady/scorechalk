/* The pictures on cribbage's "How do you want to score?" screens: the real
   controls, photographed from a real game, so a player sees exactly what
   each choice looks like. Run `npm run previews` after changing how the
   play pad or the hand card looks, and commit public/cribbage/previews/.

   Uses the test server and browser (tests/helpers.mjs): a local Worker on
   its own port, and Chrome or Edge from this machine. */

import { startServer, stopServer, startBrowser, stopBrowser, phone, open, wait } from '../tests/helpers.mjs';

const OUT = new URL('../public/cribbage/previews/', import.meta.url);
const shot = (pg, name, sels) => pg.evaluate((sels) => {
  // one picture spanning the given elements, top of the first to bottom of the last
  const boxes = sels.map((q) => document.querySelector(q).getBoundingClientRect()).filter((b) => b.height);
  const top = Math.min(...boxes.map((b) => b.top)), bottom = Math.max(...boxes.map((b) => b.bottom));
  const left = Math.min(...boxes.map((b) => b.left)), right = Math.max(...boxes.map((b) => b.right));
  return { x: left - 6, y: top - 6 + window.scrollY, width: right - left + 12, height: bottom - top + 12 };
}, sels).then((clip) => pg.screenshot({ path: new URL(name, OUT), type: 'webp', quality: 82, clip }));

await startServer();
await startBrowser();
try {
  const pg = await phone(390, 1200);
  await pg.setViewport({ width: 390, height: 1200, deviceScaleFactor: 2 });
  await open(pg, '/cribbage/');
  await pg.evaluate(() => { setupNames = ['Ann', 'Bob', '']; setupN = 2; beginGame(); });
  await wait(600);

  // the play, Simple then Detailed: one player's column, shown side by side
  await pg.evaluate(() => { playMode = 'simple'; render(); });
  await wait(200);
  await shot(pg, 'play-simple.webp', ['#players > :first-child']);
  await pg.evaluate(() => { playMode = 'detailed'; render(); });
  await wait(200);
  await shot(pg, 'play-detailed.webp', ['#players > :first-child']);

  // the count: a hand of 5 5 J 10 with a 5 starter, by its cards, then by buttons
  await pg.click('#mainBtn'); await wait(400);
  await pg.evaluate(() => { handMode = 'cards'; render(); });
  for (const r of [5, 5, 11, 10, 5]) { await pg.click(`.ct-rank[data-r="${r}"]`); await wait(120); }
  // answer whatever the ranks leave open (a flush, the Jack's suit) with No
  for (let k = 0; k < 3; k++) {
    const asked = await pg.$('.ct-q:not(.hidden) [data-yes="0"]');
    if (!asked) break;
    await asked.click(); await wait(150);
  }
  await wait(300);
  await shot(pg, 'hand-cards.webp', ['#handCard']);
  // the same hand by buttons, part counted: three fifteens and three of a kind so far
  await pg.evaluate(() => { handMode = 'buttons'; render(); });
  for (let k = 0; k < 3; k++) { await pg.click('#handPad [data-id="15"]'); await wait(80); }
  await pg.click('#handPad [data-id="three"]');
  await wait(200);
  await shot(pg, 'hand-buttons.webp', ['#handCard']);

  if (pg.errors.length) throw new Error(pg.errors.join('\n'));
  console.log('previews written to public/cribbage/previews/');
} finally {
  await stopBrowser();
  await stopServer();
}
