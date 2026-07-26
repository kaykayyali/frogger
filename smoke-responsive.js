// smoke-responsive.js — verifies the responsive layout, HiDPI, and the
// in-canvas RESTART button at two viewport sizes.

const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = __dirname;
const PORT = 8768;

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

async function runOne(label, viewport, dpr) {
  const browser = await chromium.launch();
  let result = null;
  try {
    const ctx = await browser.newContext({
      viewport,
      deviceScaleFactor: dpr,
      hasTouch: true,
      isMobile: viewport.width < 700,
    });
    const page = await ctx.newPage();
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('http://localhost:' + PORT + '/index.html');
    await page.waitForFunction(() => globalThis.State && globalThis.State.phase === 'title', null, { timeout: 5000 });

    const css = await page.evaluate(() => {
      const c = document.getElementById('game');
      const r = c.getBoundingClientRect();
      return {
        cssW: r.width, cssH: r.height,
        backingW: c.width, backingH: c.height,
        devicePixelRatio: window.devicePixelRatio,
        dpadVisible: getComputedStyle(document.getElementById('touch-controls')).display !== 'none',
      };
    });

    await page.keyboard.press('Space');
    await page.waitForTimeout(1700);
    await page.evaluate(() => {
      globalThis.State.lives = 1;
      globalThis.Game.killFrog('hit');
    });
    await page.waitForFunction(() => globalThis.State.phase === 'gameover', null, { timeout: 4000 });

    const btn = await page.evaluate(() => globalThis.State._restartBtn);
    if (!btn) throw new Error(label + ' FAIL: no restart button rect on game over');

    const rect = await page.evaluate(() => {
      const c = document.getElementById('game');
      const r = c.getBoundingClientRect();
      const b = globalThis.State._restartBtn;
      return {
        x: r.left + (b.x + b.w / 2) * (r.width / globalThis.W),
        y: r.top + (b.y + b.h / 2) * (r.height / globalThis.H),
      };
    });
    await page.mouse.click(rect.x, rect.y);
    await page.waitForTimeout(300);
    const after = await page.evaluate(() => ({
      phase: globalThis.State.phase,
      lives: globalThis.State.lives,
      score: globalThis.State.score,
    }));
    if (after.phase !== 'title' || after.lives !== 5 || after.score !== 0) {
      throw new Error(label + ' FAIL: restart button did not reset state: ' + JSON.stringify(after));
    }

    await page.setViewportSize({ width: Math.floor(viewport.width * 0.7), height: Math.floor(viewport.height * 0.7) });
    await page.waitForTimeout(250);
    const css2 = await page.evaluate(() => {
      const c = document.getElementById('game');
      const r = c.getBoundingClientRect();
      return { cssW: r.width, cssH: r.height };
    });
    if (css2.cssW <= 0 || css2.cssH <= 0) {
      throw new Error(label + ' FAIL: canvas shrunk to 0 after resize: ' + JSON.stringify(css2));
    }

    const tap = await page.evaluate(() => {
      const c = document.getElementById('game');
      const r = c.getBoundingClientRect();
      return globalThis.Layout.clientToGame(r.left + 4, r.top + 4);
    });
    if (!tap || tap.x > 20 || tap.y > 20) {
      throw new Error(label + ' FAIL: tap coords mapping wrong: ' + JSON.stringify(tap));
    }

    await page.evaluate(() => globalThis.Game.restart());
    await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(ROOT, 'smoke-' + label + '.png') });

    if (errors.length) throw new Error(label + ' FAIL: console errors: ' + JSON.stringify(errors));
    result = { css, after, css2 };
  } finally {
    await browser.close();
  }
  return result;
}

async function main() {
  const server = await startServer();
  try {
    console.log('mobile 390x844 @2x:', await runOne('mobile', { width: 390, height: 844 }, 2));
    console.log('desktop 1280x800 @1x:', await runOne('desktop', { width: 1280, height: 800 }, 1));
    console.log('RESPONSIVE SMOKE OK');
  } finally {
    server.close();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });