/* The pictures the web app manifest points to: screenshots of real games,
   which Chrome shows in its larger install dialog and app stores and PWA
   directories ask for, and a small icon for each shortcut (the list a long
   press on the installed app's icon shows). Run `npm run store-shots` after
   a game's look changes, and commit public/screenshots/ and
   public/icons/shortcuts/.

   Screenshots are PNG because some app stores take nothing else. Each form
   factor keeps one shape: narrow is a 390×844 phone at twice the pixels,
   wide is a 1280×800 laptop at one and a half.

   Uses the test server and browser (tests/helpers.mjs), as scripts/previews.mjs does. */

import { mkdirSync } from 'node:fs';
import { startServer, stopServer, startBrowser, stopBrowser, phone, open, wait } from '../tests/helpers.mjs';

const out = (p) => new URL(`../public/${p}`, import.meta.url);
mkdirSync(out('screenshots'), { recursive: true });
mkdirSync(out('icons/shortcuts'), { recursive: true });

async function screen(form) {
  const [w, h, dpr] = form === 'narrow' ? [390, 844, 2] : [1280, 800, 1.5];
  const pg = await phone(w, h);
  await pg.setViewport({ width: w, height: h, deviceScaleFactor: dpr });
  return pg;
}
const snap = (pg, name) => pg.screenshot({ path: out(`screenshots/${name}.png`), type: 'png' });
const check = (pg) => { if (pg.errors.length) throw new Error(pg.errors.join('\n')); };

/* Each game, a few turns in, as a table of friends would have it. */
const GAMES = {
  async home(pg) {
    await open(pg, '/');
  },
  async darts(pg) {
    await open(pg, '/darts/');
    await pg.evaluate(async () => {
      openGame(newGame(['Ann', 'Bob'], 501, { doubleOut: true }));
      const turn = (...ds) => { for (const [n, m] of ds) { S.mult = m; addDart(n); } submitTurn(); };
      turn([20, 3], [20, 3], [20, 1]);   // Ann 140
      turn([19, 3], [19, 1], [5, 1]);    // Bob 81
      turn([20, 3], [19, 3], [18, 1]);   // Ann 135
      turn([20, 1], [20, 3], [1, 1]);    // Bob 81
      turn([20, 3], [20, 1], [6, 1]);    // Ann 86, leaving 140
      turn([20, 1], [20, 1], [20, 1]);   // Bob 60: Ann is up on 140
      S.mult = 3; addDart(20);           // her first dart, and the checkout follows it
    });
  },
  async cribbage(pg) {
    await open(pg, '/cribbage/');
    await pg.evaluate(() => { setupNames = ['Ann', 'Bob', '']; setupN = 2; beginGame(); });
    await wait(600);
    // four hands in, counted as they would be (the count begun, then the
    // hand left of the dealer, the dealer's, the crib): pegs part way round,
    // the back peg behind each, Ann dealing the fifth
    await pg.evaluate(() => {
      const hands = [[8, 12, 4], [9, 10, 6], [14, 16, 2], [0, 3, 0]];   // the other hand, the dealer's, the crib
      hands.forEach(([other, own, crib], k) => {
        const d = k % 2;
        S.log.push({ kind: 'count' });
        score(1 - d, other, 'hand', 'Hand'); score(d, own, 'hand', 'Hand'); score(d, crib, 'crib', 'Crib');
      });
      score(0, 1, 'play', 'Go');        // the fifth hand's play under way
      playMode = 'simple'; save(); render();
    });
  },
  async yahtzee(pg) {
    await open(pg, '/yahtzee/');
    await pg.evaluate(() => {
      S = newGame(['Ann', 'Bob', 'Cy']);
      openGame(S);
      const rounds = [
        ['threes', 9, 'fours', 12, 'ones', 3],
        ['full', 25, 'small', 30, 'sixes', 18],
        ['fives', 15, 'three', 22, 'large', 40],
        ['chance', 23, 'twos', 6, 'full', 25],
      ];
      for (const r of rounds) for (let p = 0; p < 3; p++) setBox(p, r[p * 2], r[p * 2 + 1]);
      save(); render();
    });
  },
  async magic(pg) {
    await open(pg, '/magic/');
    await pg.evaluate(() => {
      S = newGame('commander', ['Ann', 'Bob', 'Cy', 'Dee'], 40);
      for (const [p, what, d, q] of [[0, 'life', -7], [1, 'cmdr', 9, 2], [2, 'life', 4], [3, 'poison', 3], [3, 'life', -12], [0, 'cmdr', 5, 1]]) change(p, what, d, q);
      save();
      SCStore.show(S.id, '#play');
      route();
    });
  },
};

const SHOTS = {
  narrow: ['home', 'darts', 'cribbage', 'yahtzee', 'magic'],
  wide: ['home', 'darts', 'yahtzee'],
};

/* Shortcut icons: each game's drawing from its home-page card, on its
   room's paper, so the list reads at a glance. The Builder has no card
   drawing, so it gets a score sheet drawn here in the Workshop's ink. */
const BUILDER_SVG = `<svg viewBox="0 0 70 70"><g style="--ink:#1e2b2a">
  <rect class="pen-line" x="14" y="10" width="36" height="50" rx="3"/>
  <path class="pen-line" d="M14 22h36M14 32h36M14 42h36M30 10v50"/>
  <path class="pen-red" d="M44 56 60 30m-16 26-1 6 5-3"/></g></svg>`;

async function icons() {
  const pg = await phone(400, 400);
  await pg.setViewport({ width: 400, height: 400, deviceScaleFactor: 2 });
  await open(pg, '/');
  const tiles = { darts: ['/darts/', '#24312c'], cribbage: ['/cribbage/', '#fffdf2'], yahtzee: ['/yahtzee/', '#fffdf2'], magic: ['/magic/', '#fffdf2'], builder: [null, '#f3f5f1'] };
  for (const [name, [href, bg]] of Object.entries(tiles)) {
    await pg.evaluate((href, bg, builder) => {
      document.getElementById('shortcutTile')?.remove();
      const t = document.createElement('div');
      t.id = 'shortcutTile';
      t.style.cssText = `position:fixed;left:0;top:0;z-index:99;width:96px;height:96px;display:grid;place-items:center;background:${bg}`;
      t.innerHTML = href ? document.querySelector(`.shelf a[href="${href}"] svg`).outerHTML : builder;
      t.firstElementChild.style.cssText = 'width:72px;height:72px';
      document.body.append(t);
    }, href, bg, BUILDER_SVG);
    await wait(100);
    const el = await pg.$('#shortcutTile');
    await el.screenshot({ path: out(`icons/shortcuts/${name}.png`), type: 'png' });
  }
  check(pg);
  await pg.close();
}

await startServer();
await startBrowser();
try {
  for (const [form, names] of Object.entries(SHOTS)) {
    for (const name of names) {
      const pg = await screen(form);
      await GAMES[name](pg);
      await wait(800);
      await snap(pg, `${name}-${form}`);
      check(pg);
      await pg.close();
    }
  }
  await icons();
  console.log('written to public/screenshots/ and public/icons/shortcuts/');
} finally {
  await stopBrowser();
  await stopServer();
}
