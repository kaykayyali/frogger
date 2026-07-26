// smoke.js — headless smoke test using Playwright. Boots a local HTTP
// server, opens the page, checks for console errors, and verifies the game
// state by driving a few keys.
//
// Run: node smoke.js
// Requires: playwright installed and chromium downloaded.

const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = __dirname;
const PORT = 8765;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
};

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const url = req.url === '/' ? '/index.html' : req.url;
      const filePath = path.join(ROOT, url);
      if (!filePath.startsWith(ROOT) || !fs.existsSync(filePath)) {
        res.writeHead(404); res.end('not found'); return;
      }
      const ext = path.extname(filePath);
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
      fs.createReadStream(filePath).pipe(res);
    });
    server.listen(PORT, () => resolve(server));
  });
}

async function main() {
  const server = await startServer();
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 600, height: 800 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push('CONSOLE: ' + msg.text()); });
  page.on('pageerror', (err) => errors.push('PAGEERROR: ' + err.message));
  await page.goto('http://localhost:' + PORT + '/index.html');
  // Wait for game state to be exposed and title to be visible.
  await page.waitForFunction(() => globalThis.State && globalThis.State.phase === 'title', null, { timeout: 5000 });
  // Start the game.
  await page.keyboard.press('Space');
  await page.waitForFunction(() => globalThis.State.phase === 'play', null, { timeout: 2000 });
  // Wait past the ready-countdown before sending moves.
  await page.waitForTimeout(1600);
  // Move a few times — drive into traffic to exercise the road.
  for (const k of ['ArrowUp', 'ArrowUp', 'ArrowLeft', 'ArrowRight']) {
    await page.keyboard.press(k);
    await page.waitForTimeout(300);
  }
  const state = await page.evaluate(() => ({
    phase: globalThis.State.phase,
    score: globalThis.State.score,
    row: globalThis.Frog.row,
    col: globalThis.Frog.col,
    lives: globalThis.State.lives,
  }));
  // Test the restart path too.
  await page.keyboard.press('r');
  await page.waitForTimeout(200);
  const afterRestart = await page.evaluate(() => ({
    phase: globalThis.State.phase,
    score: globalThis.State.score,
    lives: globalThis.State.lives,
    lastTimestamp: globalThis.State.lastTimestamp,
  }));
  // Test pause/resume.
  await page.keyboard.press('Space');
  await page.waitForTimeout(100);
  await page.keyboard.press('p');
  await page.waitForTimeout(100);
  const paused = await page.evaluate(() => globalThis.State.phase);
  await page.keyboard.press('p');
  await page.waitForTimeout(100);
  const resumed = await page.evaluate(() => globalThis.State.phase);
  // Capture title screen for visual review.
  await page.keyboard.press('r');
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(ROOT, 'smoke-title.png') });
  // Then play snapshot.
  await page.keyboard.press('Space');
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(ROOT, 'smoke.png') });
  await browser.close();
  server.close();
  if (errors.length) { console.error('FAIL: console errors:', errors); process.exit(1); }
  if (state.score < 20) { console.error('FAIL: expected >=20 score, got', state); process.exit(1); }
  if (afterRestart.score !== 0 || afterRestart.lives !== 5) {
    console.error('FAIL: restart did not reset:', afterRestart); process.exit(1);
  }
  if (paused !== 'paused') { console.error('FAIL: pause did not work:', paused); process.exit(1); }
  if (resumed !== 'play') { console.error('FAIL: resume did not work:', resumed); process.exit(1); }
  console.log('SMOKE OK', state, afterRestart, 'paused=' + paused, 'resumed=' + resumed);
}
main().catch((e) => { console.error(e); process.exit(1); });