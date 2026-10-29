import type { AssetManager } from '../assets/AssetManager';
import type { Kit } from '../config/types';
import { PATTERN_IDS } from '../render/KitMaterial';

/** CPU version of the kit shader for menu previews. Keep in sync with PATTERN_GLSL. */
export function kitPattern(u: number, v: number, pattern: number, count: number): number {
  const fract = (x: number) => x - Math.floor(x);
  if (pattern === 0) return 0;
  if (pattern === 1) return fract(u * count * 2) >= 0.5 ? 1 : 0;
  if (pattern === 2) return fract(v * count * 0.5) >= 0.5 ? 1 : 0;
  if (pattern === 3) return u >= 0.5 ? 1 : 0;
  const xf = Math.sin(u * Math.PI * 2);
  return Math.abs(xf - (1 - 2 * v)) <= 0.38 ? 1 : 0;
}

const hex = (h: string): [number, number, number] => {
  const n = parseInt(h.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

const cache = new Map<string, ImageData>();
function frameData(assets: AssetManager, path: string, x: number, y: number, w: number, h: number): ImageData | null {
  const key = `${path}:${x}:${y}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const img = assets.images.get(path);
  if (!img) return null;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(img, x, y, w, h, 0, 0, w, h);
  const d = g.getImageData(0, 0, w, h);
  cache.set(key, d);
  return d;
}

/** Draw the idle frame of a player in a kit, facing direction row `row`. */
export function drawKitPreview(canvas: HTMLCanvasElement, assets: AssetManager, kit: Kit, row = 1) {
  const set = assets.manifest.characters.people;
  const def = set.anims.idle;
  const sh = set.sheets[def.sheet];
  const x = def.start * sh.frameW, y = row * sh.frameH;
  const base = frameData(assets, sh.base, x, y, sh.frameW, sh.frameH);
  const mask = sh.mask ? frameData(assets, sh.mask, x, y, sh.frameW, sh.frameH) : null;
  const uv = sh.uv ? frameData(assets, sh.uv, x, y, sh.frameW, sh.frameH) : null;
  if (!base) return;
  const out = new ImageData(sh.frameW, sh.frameH);
  const s1 = hex(kit.shirt1), s2 = hex(kit.shirt2), so = hex(kit.shorts), sk = hex(kit.socks);
  const pat = PATTERN_IDS[kit.pattern] ?? 0;
  const count = kit.patternCount ?? 6;
  for (let i = 0; i < out.data.length; i += 4) {
    const a = base.data[i + 3];
    let r = base.data[i], g = base.data[i + 1], b = base.data[i + 2];
    if (mask && a > 127) {
      const lum = base.data[i] / 204;
      let col: [number, number, number] | null = null;
      if (mask.data[i] > 127) {
        const p = uv ? kitPattern(uv.data[i] / 255, uv.data[i + 1] / 255, pat, count) : 0;
        col = p ? s2 : s1;
      } else if (mask.data[i + 1] > 127) col = so;
      else if (mask.data[i + 2] > 127) col = sk;
      if (col) [r, g, b] = [col[0] * lum, col[1] * lum, col[2] * lum];
    }
    out.data[i] = r; out.data[i + 1] = g; out.data[i + 2] = b; out.data[i + 3] = a > 127 ? 255 : 0;
  }
  canvas.width = sh.frameW;
  canvas.height = sh.frameH;
  canvas.getContext('2d')!.putImageData(out, 0, 0);
}
