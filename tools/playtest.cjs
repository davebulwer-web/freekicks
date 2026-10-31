#!/usr/bin/env node
/**
 * Automated play-through in headless Chromium: menus, aiming, kicking, replay and game over.
 * Saves screenshots to playtest-output/ and fails on console errors. Run: npm run playtest
 */
const fs = require('node:fs');
const path = require('node:path');

async function main() {
  const root = path.resolve(__dirname, '..');
  const out = path.join(root, 'playtest-output');
  fs.mkdirSync(out, { recursive: true });
  const { chromium } = require('playwright');
  // Test the production build (no hot reload while editing).
  const { build, preview } = await import('vite');
  await build({ root, logLevel: 'error' });
  const server = await preview({ root, logLevel: 'error', preview: { port: 5198 } });
  const url = server.resolvedUrls.local[0];
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 960, height: 450 }, deviceScaleFactor: 1, hasTouch: false });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  const shot = (name) => page.screenshot({ path: path.join(out, name + '.png') });
  const wait = (ms) => page.waitForTimeout(ms);

  await page.goto(url);
  await page.waitForSelector('.title-splash', { timeout: 60000 });
  await wait(1000);
  await shot('00-title');
  await page.click('.title-splash');
  await page.waitForSelector('.mode-card', { timeout: 60000 });
  await wait(2500);
  await shot('01-menu');
  await page.click('text=HOW TO PLAY');
  for (let i = 0; i < 8; i++) {
    await wait(200);
    await shot(`01-howto-${i + 1}`);
    await page.click('.htp-nav .btn >> nth=1');
  }
  await page.waitForSelector('.mode-card', { timeout: 10000 });
  await page.click('text=TEAMS & KITS');
  await wait(300);
  await page.click('text=EDIT KIT >> nth=0');
  await wait(300);
  await shot('02-kit-editor');
  await page.click('text=CANCEL');
  await page.click('text=BACK');
  const mode = process.argv.includes('--weather') ? 'Weather Challenge' : 'Arcade';
  await page.click(`text=${mode}`);
  await wait(800);
  await shot('03-aim');

  const tapAt = async (frac) => {
    // Wait for the sweeping marker on the active ring segment to reach roughly the wanted value, then tap.
    for (let i = 0; i < 400; i++) {
      const v = await page.evaluate(() => {
        const a = window.game.aim;
        return a.active < 4 ? a.values[a.active] : null;
      });
      if (v !== null && Math.abs(v - frac) < 0.04) break;
      await wait(10);
    }
    await page.mouse.click(480, 200);
  };

  const plan = [[0.72, 0.62, 0.35, 0.95], [0.7, 0.3, 0.75, 0.9], [0.2, 0.05, 0.5, 0.5], [0.95, 0.5, 0.5, 0.1], [0.1, 0.95, 0.1, 0.5], [0.5, 0.5, 0.5, 0.5]];
  for (let k = 0; k < 8; k++) {
    const p = plan[k % plan.length];
    if (await page.$('text=GAME OVER')) break;
    await tapAt(p[0]); await tapAt(p[1]); await tapAt(p[2]); await tapAt(p[3]);
    await wait(900);
    await shot(`1${k}-a-flight`);
    const res = await page.waitForFunction(() => {
      const b = document.querySelector('.banner.show');
      return b && `${b.textContent} | ${document.querySelector('.banner-sub').textContent}`;
    }, null, { timeout: 15000 }).catch(async (e) => {
      console.log('state dump:', await page.evaluate(() => {
        const g = window.game;
        const m = g.match;
        return JSON.stringify({ state: g.state, phase: m.phase, ball: m.ballState, outcome: m.outcome, t: m.time, kick: m.kickTime, kicker: m.kicker.pos });
      }));
      console.log('errors so far:', errors.join('\n'));
      throw e;
    });
    console.log(`kick ${k + 1}:`, await res.jsonValue());
    await wait(400);
    await shot(`1${k}-b-result`);
    await page.waitForFunction(() => !document.querySelector('.banner.show'), null, { timeout: 15000 });
    await wait(300);
    if (await page.$('.replay-ui:not([style*="none"])')) {
      await wait(700);
      await shot(`1${k}-c-replay`);
      await page.mouse.move(480, 200); await page.mouse.down(); await page.mouse.move(600, 230, { steps: 8 }); await page.mouse.up();
      await wait(300);
      await shot(`1${k}-d-replay-orbit`);
      await page.click('text=SKIP');
    }
    await wait(700);
    if (await page.$('text=GAME OVER')) { await shot('90-gameover'); console.log('game over'); break; }
  }
  await browser.close();
  await new Promise((r) => server.httpServer.close(r));
  if (errors.length) {
    console.error('Console errors:\n' + errors.join('\n'));
    process.exit(1);
  }
  console.log('Playtest OK, screenshots in', out);
}
main().catch((e) => { console.error(e); process.exit(1); });
