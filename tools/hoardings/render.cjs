#!/usr/bin/env node
/**
 * Renders tools/hoardings/hoardings.html into the hoarding texture sheet and the per-board slices.
 * Run: node tools/hoardings/render.cjs
 *
 * Writes:
 *   art/hoardings/hoardings_sheet.png      1024 x 1370 (ten 1024 x 128 boards, 10 px separators)
 *   art/hoardings/hoardings_sheet@2x.png   2048 x 2740 (same layout at double resolution)
 *   public/assets/hoardings/hoarding_NN.png  each board cropped at 1024 x 128
 */
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

async function render(scale) {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1024, height: 1400 }, deviceScaleFactor: scale });
  await page.goto('file://' + path.join(__dirname, 'hoardings.html'));
  await page.waitForFunction(() => window.__ready, null, { timeout: 30000 });
  return { browser, page };
}

async function main() {
  const root = path.resolve(__dirname, '..', '..');
  const artDir = path.join(root, 'art', 'hoardings');
  const sliceDir = path.join(root, 'public', 'assets', 'hoardings');
  fs.mkdirSync(artDir, { recursive: true });

  for (const scale of [1, 2]) {
    const { browser, page } = await render(scale);
    const name = scale === 1 ? 'hoardings_sheet.png' : `hoardings_sheet@${scale}x.png`;
    await page.locator('#sheet').screenshot({ path: path.join(artDir, name) });
    if (scale === 1) {
      const boards = page.locator('#sheet svg');
      const n = await boards.count();
      for (let i = 0; i < n; i++) {
        const file = path.join(sliceDir, `hoarding_${String(i + 1).padStart(2, '0')}.png`);
        await boards.nth(i).screenshot({ path: file });
      }
      console.log(`wrote ${n} slices to ${path.relative(root, sliceDir)}`);
    }
    console.log(`wrote ${path.relative(root, path.join(artDir, name))}`);
    await browser.close();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
