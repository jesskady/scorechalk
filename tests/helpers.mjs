/* What the tests share: a server of their own, a browser, and phones.

   The server is `wrangler dev` on a spare port, with a database of its own
   in a temporary folder — every migration applied, nothing from the real
   dev database — and test-only secrets. The per-visitor limits on shared
   games are switched off for it (LIMITS=off): one run makes more shares
   than any visitor would. The live site never has that variable.

   The browser is Chrome or Edge, found where it is usually installed, or
   wherever BROWSER_PATH says. A "phone" is a page in a browser context of
   its own, so each has its own storage, like a separate device. */

import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as path, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const ROOT = path(dirname(fileURLToPath(import.meta.url)), '..');
const WRANGLER = path(ROOT, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
export const PORT = Number(process.env.TEST_PORT) || 8799;
export const U = `http://localhost:${PORT}`;

export const wait = (ms = 500) => new Promise((r) => setTimeout(r, ms));

/* ---------------- the server ---------------- */

let server = null, dataDir = null;

export async function startServer() {
  dataDir = mkdtempSync(path(tmpdir(), 'scorechalk-test-'));
  const env = { ...process.env, CI: 'true', WRANGLER_SEND_METRICS: 'false' };
  const migrate = spawnSync(process.execPath, [WRANGLER, 'd1', 'migrations', 'apply', 'scorechalk', '--local', '--persist-to', dataDir],
    { cwd: ROOT, env, encoding: 'utf8' });
  if (migrate.status !== 0) throw new Error('migrations failed:\n' + migrate.stdout + migrate.stderr);

  server = spawn(process.execPath, [WRANGLER, 'dev', '--port', String(PORT), '--persist-to', dataDir, '--test-scheduled',
    '--var', 'GOOGLE_CLIENT_SECRET:test-only', '--var', 'SESSION_SECRET:test-only-secret', '--var', 'LIMITS:off'],
    { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  server.stdout.on('data', (d) => { log += d; });
  server.stderr.on('data', (d) => { log += d; });

  for (let k = 0; k < 120; k++) {
    try { if ((await fetch(U + '/')).ok) return; } catch (e) { /* not up yet */ }
    if (server.exitCode !== null) break;
    await wait(500);
  }
  throw new Error('the test server did not start:\n' + log.slice(-3000));
}

export async function stopServer() {
  if (server && server.exitCode === null) {
    // wrangler starts workerd beneath it; on Windows only a tree kill stops both
    if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(server.pid), '/T', '/F']);
    else server.kill('SIGTERM');
  }
  await wait(500);
  try { rmSync(dataDir, { recursive: true, force: true }); } catch (e) { /* still held: the temp folder clears itself */ }
}

/* ---------------- the browser ---------------- */

function browserPath() {
  if (process.env.BROWSER_PATH) return process.env.BROWSER_PATH;
  const tries = [
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  ];
  const found = tries.find((p) => existsSync(p));
  if (!found) throw new Error('No Chrome or Edge found: set BROWSER_PATH to one.');
  return found;
}

let browser = null;
export async function startBrowser() {
  browser = await puppeteer.launch({ executablePath: browserPath(), headless: 'new' });
}
export async function stopBrowser() {
  if (browser) await browser.close();
}

/* A phone: its own storage, a phone-sized screen, and any error on its
   pages collected — a test fails if a page threw. */
export async function phone(width = 390, height = 844) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width, height });
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  page.on('dialog', (d) => d.accept());
  page.close = async () => ctx.close();
  return page;
}

export const open = (page, path) => page.goto(U + path, { waitUntil: 'domcontentloaded', timeout: 60000 }).then(() => wait(900));

// Start a new game from a setup screen, saying yes to any question on the way.
export async function startGame(page) {
  await page.click('#startBtn');
  await wait(600);
  const yes = await page.$('#confirmYes');
  if (yes && await yes.isVisible()) { await yes.click(); await wait(500); }
}

// Press a button in the share sheet, or the seat picker, by its words.
export const press = (page, text) => page.evaluate((t) => {
  const b = [...document.querySelectorAll('.sc-share-ui button')].find((x) => x.textContent === t);
  if (!b) throw new Error('no button: ' + t);
  b.click();
}, text);

// The share sheet open, with its links made: they come from the server.
export const linksReady = (page) => page.waitForFunction(
  () => [...document.querySelectorAll('.sc-share-ui button')].some((b) => b.textContent === 'Copy link'),
  { timeout: 20000 });

// Share the game on screen; resolves its links' tokens, sheet closed.
export async function share(page, opener = (p) => p.click('#shareBtn')) {
  await opener(page);
  await linksReady(page);
  await wait(300);
  const sh = await page.evaluate(() => SCStore.get(S.id).share);
  await press(page, 'Done');
  await wait(300);
  return sh;
}

// Join a shared game by its join link, as the named player.
export async function join(page, type, joinToken, name) {
  await open(page, `/${type}/?s=${joinToken}`);
  await page.waitForFunction(() => !!document.querySelector('.sc-share-ui button'), { timeout: 20000 });
  await press(page, name);
  await wait(1200);
}

export const api = (path, method = 'GET', body) =>
  fetch(U + path, { method, headers: { 'content-type': 'application/json' }, body: body && JSON.stringify(body) })
    .then(async (r) => ({ status: r.status, data: await r.json().catch(() => null) }));

// Long enough for a change to reach the other phones: they look every 1–3s.
export const settle = () => wait(4500);
