/* The pictures on the "how do you want to score?" screens, where a game
   offers two ways of doing the same thing: cribbage's play and count, and
   the Builder's board or sheet. Each is the real thing, photographed from a
   real game, so a player sees exactly what they are choosing. Run
   `npm run previews` after changing how any of these looks, and commit the
   previews/ folders it writes.

   Uses the test server and browser (tests/helpers.mjs): a local Worker on
   its own port, and Chrome or Edge from this machine. */

import { startServer, stopServer, startBrowser, stopBrowser, phone, open, wait } from '../tests/helpers.mjs';

// one picture spanning the given elements, top of the first to bottom of the last
const shot = (pg, dir, name, sels) => pg.evaluate((sels) => {
  const boxes = sels.map((q) => document.querySelector(q).getBoundingClientRect()).filter((b) => b.height);
  const top = Math.min(...boxes.map((b) => b.top)), bottom = Math.max(...boxes.map((b) => b.bottom));
  const left = Math.min(...boxes.map((b) => b.left)), right = Math.max(...boxes.map((b) => b.right));
  return { x: left - 6, y: top - 6 + window.scrollY, width: right - left + 12, height: bottom - top + 12 };
}, sels).then((clip) => pg.screenshot({ path: new URL(`../public/${dir}/previews/${name}`, import.meta.url), type: 'webp', quality: 82, clip }));

// a phone-sized page at twice the pixels, so the pictures are sharp
async function hiDpi() {
  const pg = await phone(390, 1200);
  await pg.setViewport({ width: 390, height: 1200, deviceScaleFactor: 2 });
  return pg;
}

await startServer();
await startBrowser();
try {
  /* ---------- cribbage ---------- */
  const pg = await hiDpi();
  await open(pg, '/cribbage/');
  await pg.evaluate(() => { setupNames = ['Ann', 'Bob', '']; setupN = 2; beginGame(); });
  await wait(600);

  // the play, Simple then Detailed: one player's column, shown side by side
  await pg.evaluate(() => { playMode = 'simple'; render(); });
  await wait(200);
  await shot(pg, 'cribbage', 'play-simple.webp', ['#players > :first-child']);
  await pg.evaluate(() => { playMode = 'detailed'; render(); });
  await wait(200);
  await shot(pg, 'cribbage', 'play-detailed.webp', ['#players > :first-child']);

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
  await shot(pg, 'cribbage', 'hand-cards.webp', ['#handCard']);
  // the same hand by buttons, part counted: three fifteens and three of a kind so far
  await pg.evaluate(() => { handMode = 'buttons'; render(); });
  for (let k = 0; k < 3; k++) { await pg.click('#handPad [data-id="15"]'); await wait(80); }
  await pg.click('#handPad [data-id="three"]');
  await wait(200);
  await shot(pg, 'cribbage', 'hand-buttons.webp', ['#handCard']);
  if (pg.errors.length) throw new Error(pg.errors.join('\n'));

  /* ---------- the Builder: three players, a few rounds in ---------- */
  // both as a phone shows them, top of the screen down: the sheet fills the
  // screen height by design, so a short screen keeps it to its rounds
  const bd = await hiDpi();
  await bd.setViewport({ width: 390, height: 560, deviceScaleFactor: 2 });
  await open(bd, '/builder/');
  await bd.evaluate(() => {
    Object.assign(cfg, { name: 'Game night', mode: 'up', start: 0, win: 'target', target: 100, turns: true, useRounds: false,
      quick: '1, 5, 10', typed: true, names: ['Ann', 'Bob', 'Cy'], players: 3, theme: 'workshop' });
    saveCfg();
    beginGame('board');
  });
  await wait(600);
  await bd.evaluate(() => { for (const v of [12, 7, 15, 9, 20, 11, 14, 5]) { S.pend = v; S.parts = [{ label: '', d: v }]; commit(v); } });
  await wait(400);
  await bd.screenshot({ path: new URL('../public/builder/previews/view-board.webp', import.meta.url), type: 'webp', quality: 82 });
  await bd.evaluate(() => { S.view = 'sheet'; applyView(); render(); });
  await wait(400);
  await bd.screenshot({ path: new URL('../public/builder/previews/view-sheet.webp', import.meta.url), type: 'webp', quality: 82 });
  if (bd.errors.length) throw new Error(bd.errors.join('\n'));

  console.log('previews written to public/cribbage/previews/ and public/builder/previews/');
} finally {
  await stopBrowser();
  await stopServer();
}
