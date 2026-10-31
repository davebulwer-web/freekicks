// Headless browser smoke test: starts Vite, plays a little, saves screenshots.
//   npm run smoke            (screenshots go to smoke-output/)
// Uses the Playwright + Chromium already installed on the machine.
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require(path.join(require('child_process').execSync('npm root -g').toString().trim(), 'playwright'))); }

const OUT = process.argv[2] || path.join(__dirname, '..', 'smoke-output');
const PORT = 5199;

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const vite = spawn(process.execPath, [path.join(__dirname, '..', 'node_modules', 'vite', 'bin', 'vite.js'), '--port', String(PORT), '--strictPort'], { cwd: path.join(__dirname, '..'), stdio: 'pipe' });
  await new Promise((res, rej) => {
    vite.stdout.on('data', (d) => d.toString().includes('Local') && res());
    vite.on('exit', () => rej(new Error('vite exited')));
    setTimeout(() => rej(new Error('vite did not start')), 20000);
  });
  const browser = await chromium.launch();
  const errors = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 680 } });
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => m.type() === 'error' && !/fonts\.(googleapis|gstatic)/.test(m.text()) && errors.push(m.text()));
    await page.goto(`http://localhost:${PORT}/?seed=4`);
    await page.waitForFunction(() => window.__andy, null, { timeout: 15000 });
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(OUT, '1-title.png') });

    await page.keyboard.press('Space');
    await page.waitForTimeout(1500);
    // walk Andy up out of the IT office
    await page.keyboard.down('ArrowLeft');
    await page.waitForTimeout(500);
    await page.keyboard.up('ArrowLeft');
    await page.keyboard.down('ArrowUp');
    await page.waitForTimeout(900);
    await page.keyboard.up('ArrowUp');
    await page.screenshot({ path: path.join(OUT, '2-start.png') });

    // jump the clock forward so a few tasks are on the go
    await page.evaluate(() => { const g = window.__andy.game; g.clock = 120; g.spawn('car'); g.spawn('fun'); g.spawn('rant'); g.spawn('toilet'); g.meters.anger = 55; });
    await page.waitForTimeout(6000);
    await page.screenshot({ path: path.join(OUT, '3-busy.png') });

    // teleport next to a parked car, check its permit
    const ok = await page.evaluate(() => {
      const g = window.__andy.game;
      const t = g.tasks.find((k) => k.type === 'car' && k.target());
      if (!t) return false;
      const p = t.target(); g.andy.x = p.x; g.andy.y = p.y + 4; return true;
    });
    if (ok) {
      await page.keyboard.down('e');
      await page.waitForTimeout(1300);
      await page.keyboard.up('e');
      await page.screenshot({ path: path.join(OUT, '4-car-check.png') });
      await page.keyboard.press('a');
    }
    // darts with Big Toe Dave, Amber outside and an invoice on the way
    await page.evaluate(() => { const g = window.__andy.game; g.tasks = g.tasks.filter((t) => t.type !== 'fun'); g.npc('dave').goHome(g.map); g.spawn('darts'); g.spawn('amber'); g.spawn('invoice'); });
    await page.waitForTimeout(7000);
    await page.evaluate(() => { const g = window.__andy.game; const d = g.npc('dave'); g.andy.x = d.x; g.andy.y = d.y + 8; });
    await page.keyboard.down('e');
    await page.waitForTimeout(900);
    await page.keyboard.up('e');
    await page.waitForTimeout(3500);
    await page.screenshot({ path: path.join(OUT, '5a-darts.png') });
    const dartsOk = await page.evaluate(() => window.__andy.game.modal?.kind === 'darts');
    if (!dartsOk) errors.push('darts game did not start');
    await page.waitForTimeout(3500);
    await page.evaluate(() => { const g = window.__andy.game; g.spawn('boss'); const p = g.map.point('stairs'); g.andy.x = p.x; g.andy.y = p.y; });
    await page.keyboard.down('e');
    await page.waitForTimeout(800);
    await page.keyboard.up('e');
    await page.screenshot({ path: path.join(OUT, '5-boss.png') });
    await page.evaluate(() => { window.__andy.game.meters.anger = 100; });
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(OUT, '6-meltdown.png') });
    const screen = await page.evaluate(() => window.__andy.game.screen);
    if (screen !== 'gameover') errors.push(`expected gameover, got ${screen}`);
  } finally {
    await browser.close();
    vite.kill();
  }
  if (errors.length) {
    console.error('Errors:\n' + errors.join('\n'));
    process.exit(1);
  }
  console.log(`Smoke test passed. Screenshots in ${OUT}`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
