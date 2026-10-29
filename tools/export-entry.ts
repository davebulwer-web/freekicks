import { DEFAULT_MANIFEST } from '../src/assets/manifest';
import { generateAll } from '../src/placeholders';

declare global {
  interface Window {
    __assets?: Record<string, string>;
  }
}

const t0 = performance.now();
const all = generateAll(DEFAULT_MANIFEST);
const out: Record<string, string> = {};
const gallery = document.getElementById('gallery')!;
for (const [path, c] of Object.entries(all)) {
  out[path] = c.toDataURL('image/png');
  const fig = document.createElement('figure');
  fig.innerHTML = `<img src="${out[path]}" alt="${path}"><figcaption>${path} (${c.width}x${c.height})</figcaption>`;
  gallery.appendChild(fig);
}
window.__assets = out;
document.getElementById('status')!.textContent = `Generated ${Object.keys(out).length} files in ${Math.round(performance.now() - t0)} ms. Run "npm run export-assets" to write them to public/assets.`;
