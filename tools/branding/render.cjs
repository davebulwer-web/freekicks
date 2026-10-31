#!/usr/bin/env node
/**
 * Renders the Dip & Drive branding (logo, title key art, app icons, Android splash screens)
 * from tools/branding/branding.html and writes the PNGs into the repo. Run: npm run branding
 */
const fs = require('node:fs');
const path = require('node:path');

async function main() {
  const root = path.resolve(__dirname, '..', '..');
  const { chromium } = require('playwright');
  const { createServer } = await import('vite');
  const server = await createServer({ root, logLevel: 'error', server: { port: 5188, strictPort: false } });
  await server.listen();
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.error('page error:', e));
  page.on('console', (m) => m.type() === 'error' && console.error(m.text()));
  await page.goto(server.resolvedUrls.local[0] + 'tools/branding/branding.html', { timeout: 180000 });
  await page.waitForFunction(() => window.__branding, null, { timeout: 300000 });
  const files = await page.evaluate(() => window.__branding);
  for (const [rel, url] of Object.entries(files)) {
    const file = path.join(root, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, Buffer.from(url.split(',')[1], 'base64'));
  }
  console.log(`Wrote ${Object.keys(files).length} branding files`);
  await browser.close();
  await server.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
