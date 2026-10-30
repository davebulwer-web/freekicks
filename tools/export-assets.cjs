#!/usr/bin/env node
/**
 * Renders every procedural placeholder in a headless browser and writes the PNGs into
 * public/assets (plus manifest.json). Run: npm run export-assets
 * Pass --out <dir> to export somewhere else (e.g. a folder to hand to an artist).
 */
const fs = require('node:fs');
const path = require('node:path');

async function main() {
  const root = path.resolve(__dirname, '..');
  const outIdx = process.argv.indexOf('--out');
  const outDir = outIdx > 0 ? path.resolve(process.argv[outIdx + 1]) : path.join(root, 'public', 'assets');
  const force = process.argv.includes('--force');
  let chromium;
  try {
    ({ chromium } = require('playwright'));
  } catch {
    console.error('Playwright is required: npm i -D playwright && npx playwright install chromium');
    process.exit(1);
  }
  const { createServer } = await import('vite');
  const server = await createServer({ root, logLevel: 'error', server: { port: 5199, strictPort: false } });
  await server.listen();
  const url = server.resolvedUrls.local[0] + 'tools/export.html';
  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.error('page error:', e));
  await page.goto(url, { timeout: 180000 });
  await page.waitForFunction(() => window.__assets, null, { timeout: 120000 });
  const assets = await page.evaluate(() => window.__assets);
  let written = 0, skipped = 0;
  for (const [rel, dataUrl] of Object.entries(assets)) {
    const file = path.join(outDir, rel);
    if (fs.existsSync(file) && !force && outDir === path.join(root, 'public', 'assets') && !process.argv.includes('--overwrite')) {
      // Never clobber an artist's replacement unless asked.
      const marker = path.join(outDir, '.placeholders.json');
      const known = fs.existsSync(marker) ? JSON.parse(fs.readFileSync(marker, 'utf8')) : {};
      if (!known[rel] || known[rel] !== fs.statSync(file).size) { skipped++; continue; }
    }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, Buffer.from(dataUrl.split(',')[1], 'base64'));
    written++;
  }
  // Remember which files are untouched placeholders so re-exports can update them safely.
  const sizes = {};
  for (const rel of Object.keys(assets)) {
    const file = path.join(outDir, rel);
    if (fs.existsSync(file)) sizes[rel] = fs.statSync(file).size;
  }
  fs.writeFileSync(path.join(outDir, '.placeholders.json'), JSON.stringify(sizes, null, 2));
  const manifestModule = await server.ssrLoadModule('/src/assets/manifest.ts');
  const manifestFile = path.join(outDir, 'manifest.json');
  if (!fs.existsSync(manifestFile) || force) fs.writeFileSync(manifestFile, JSON.stringify(manifestModule.DEFAULT_MANIFEST, null, 2) + '\n');
  console.log(`Wrote ${written} files to ${outDir}${skipped ? ` (kept ${skipped} replaced files; use --overwrite to replace)` : ''}`);
  await browser.close();
  await server.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
