import type { CharacterSet, Manifest } from '../assets/manifest';
import { Rng } from '../core/Rng';
import { DEFAULT_PALETTE, poseFor, renderFrame, type Palette, type Pose } from './figure';

/**
 * Procedural placeholder art. Each generator returns a canvas for one manifest path.
 * Used at runtime when a file is missing, and by tools/export-assets to write the PNGs.
 */

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d', { willReadFrequently: true })!];
}

function fromImageData(img: ImageData): HTMLCanvasElement {
  const [c, g] = canvas(img.width, img.height);
  g.putImageData(img, 0, 0);
  return c;
}

/** Render every frame of a character set into base/mask/uv sheets. */
export function generateCharacterSheets(set: CharacterSet, kind: 'people' | 'cameraman'): Record<string, HTMLCanvasElement> {
  const out: Record<string, HTMLCanvasElement> = {};
  for (const [sheetName, sheet] of Object.entries(set.sheets)) {
    const W = sheet.frameW * sheet.columns;
    const H = sheet.frameH * sheet.rows;
    const base = new ImageData(W, H);
    const mask = new ImageData(W, H);
    const uv = new ImageData(W, H);
    for (const [anim, def] of Object.entries(set.anims)) {
      if (def.sheet !== sheetName) continue;
      for (let f = 0; f < def.count; f++) {
        const pose = kind === 'cameraman' ? cameramanPose(f) : poseFor(anim, f, def.count);
        for (let row = 0; row < sheet.rows; row++) {
          renderFrame(
            {
              base, mask, uv,
              x0: (def.start + f) * sheet.frameW,
              y0: row * sheet.frameH,
              w: sheet.frameW,
              h: sheet.frameH,
              ppm: set.pixelsPerMetre,
              groundY: sheet.frameH - set.footY,
            },
            pose,
            (row * Math.PI * 2) / set.directions,
          );
        }
      }
    }
    out[sheet.base] = fromImageData(base);
    if (sheet.mask) out[sheet.mask] = fromImageData(mask);
    if (sheet.uv) out[sheet.uv] = fromImageData(uv);
  }
  return out;
}

function cameramanPose(frame: number): Pose {
  const pan = frame ? 0.04 : 0;
  return {
    lean: 0.12,
    armL: { swing: 1.2, bend: 0.9, spread: -0.1 },
    armR: { swing: 1.45, bend: 0.5, spread: 0.05 },
    legL: { swing: 0.15, bend: 0.1, spread: 0.12 },
    legR: { swing: -0.1, bend: 0.1, spread: 0.12 },
    extras: [
      { a: [-0.08 + pan, 1.6, 0.12], b: [-0.08 + pan, 1.62, 0.5], r: 0.1, region: 'dark' },
      { a: [-0.08 + pan, 1.62, 0.5], b: [-0.08 + pan, 1.62, 0.62], r: 0.06, region: 'metal' },
      { a: [-0.08, 1.45, 0.3], b: [-0.08, 1.45, 0.3], r: 0.04, region: 'metal' },
      { a: [-0.08, 1.45, 0.3], b: [-0.3, 0, 0.45], r: 0.015, region: 'metal' },
      { a: [-0.08, 1.45, 0.3], b: [0.15, 0, 0.45], r: 0.015, region: 'metal' },
      { a: [-0.08, 1.45, 0.3], b: [-0.08, 0, 0.05], r: 0.015, region: 'metal' },
    ],
  };
}

export function generateCrowd(m: Manifest['crowd']): HTMLCanvasElement {
  const W = m.frameW * m.variants;
  const H = m.frameH * m.frames;
  const base = new ImageData(W, H);
  const mask = new ImageData(W, H);
  const uv = new ImageData(W, H);
  const rng = new Rng(77);
  const shirts: [number, number, number][] = [
    [200, 30, 40], [40, 70, 190], [235, 235, 235], [30, 30, 30], [240, 190, 30], [40, 150, 70], [120, 60, 150], [230, 110, 40],
  ];
  const skins: [number, number, number][] = [[230, 185, 150], [200, 150, 110], [150, 100, 70], [100, 65, 45]];
  const hairs: [number, number, number][] = [[40, 25, 15], [90, 60, 30], [200, 170, 110], [20, 20, 20], [140, 140, 140]];
  const ppm = m.frameH / m.worldHeight;
  for (let v = 0; v < m.variants; v++) {
    const pal: Palette = { skin: rng.pick(skins), hair: rng.pick(hairs), shirt: rng.pick(shirts), shorts: [50, 50, 60] };
    for (let f = 0; f < m.frames; f++) {
      const up = f === 1;
      const pose: Pose = {
        lean: up ? -0.05 : 0.05,
        armL: up ? { swing: 2.8, bend: 0.2, spread: 0.4 } : { swing: 0.4, bend: 0.9, spread: 0.1 },
        armR: up ? { swing: 2.6, bend: 0.3, spread: 0.4 } : { swing: 0.3, bend: 1.0, spread: 0.1 },
        legL: { swing: 0, bend: 0 },
        legR: { swing: 0, bend: 0 },
      };
      renderFrame(
        { base, mask, uv, x0: v * m.frameW, y0: f * m.frameH, w: m.frameW, h: m.frameH, ppm, groundY: m.frameH + 0.82 * ppm },
        pose,
        rng.range(-0.3, 0.3),
        pal,
      );
    }
  }
  return fromImageData(base);
}

export function generateGrass(): HTMLCanvasElement {
  const [c, g] = canvas(512, 512);
  // Two mowing stripes per tile (tile = 10.5 m).
  g.fillStyle = '#3f8f3a';
  g.fillRect(0, 0, 512, 256);
  g.fillStyle = '#367f32';
  g.fillRect(0, 256, 512, 256);
  const rng = new Rng(3);
  for (let i = 0; i < 14000; i++) {
    const x = rng.range(0, 512), y = rng.range(0, 512);
    const l = rng.range(-18, 18);
    g.fillStyle = `rgba(${l > 0 ? 255 : 0},${l > 0 ? 255 : 0},${l > 0 ? 200 : 0},${Math.abs(l) / 255})`;
    g.fillRect(x, y, 1.5, 3);
  }
  return c;
}

export function generateNet(): HTMLCanvasElement {
  const [c, g] = canvas(128, 128);
  g.clearRect(0, 0, 128, 128);
  g.strokeStyle = 'rgba(255,255,255,1)';
  g.lineWidth = 3;
  for (let i = 0; i <= 4; i++) {
    g.beginPath(); g.moveTo(i * 32, 0); g.lineTo(i * 32, 128); g.stroke();
    g.beginPath(); g.moveTo(0, i * 32); g.lineTo(128, i * 32); g.stroke();
  }
  return c;
}

export function generateBall(): HTMLCanvasElement {
  const W = 512, H = 256;
  const [c, g] = canvas(W, H);
  const img = g.createImageData(W, H);
  // Pentagons at icosahedron vertices (classic 32-panel look).
  const t = (1 + Math.sqrt(5)) / 2;
  const verts = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]].map((v) => {
    const l = Math.hypot(v[0], v[1], v[2]);
    return [v[0] / l, v[1] / l, v[2] / l];
  });
  for (let y = 0; y < H; y++) {
    const lat = (0.5 - (y + 0.5) / H) * Math.PI;
    for (let x = 0; x < W; x++) {
      const lon = ((x + 0.5) / W) * Math.PI * 2;
      const d = [Math.cos(lat) * Math.cos(lon), Math.sin(lat), Math.cos(lat) * Math.sin(lon)];
      let best = -1;
      for (const v of verts) best = Math.max(best, d[0] * v[0] + d[1] * v[1] + d[2] * v[2]);
      const ang = Math.acos(Math.min(1, best));
      const dark = ang < 0.3;
      const seam = Math.abs(ang - 0.55) < 0.015;
      const i = (y * W + x) * 4;
      const v = dark ? 25 : seam ? 160 : 245;
      img.data[i] = v; img.data[i + 1] = v; img.data[i + 2] = v; img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

export function generateShadow(): HTMLCanvasElement {
  const [c, g] = canvas(64, 64);
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(0,0,0,0.55)');
  grd.addColorStop(0.6, 'rgba(0,0,0,0.3)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  return c;
}

export function generateStand(): HTMLCanvasElement {
  // One tile = one seating row (front riser + seat), tiled along the stand.
  const [c, g] = canvas(256, 64);
  g.fillStyle = '#5b6470';
  g.fillRect(0, 0, 256, 64);
  g.fillStyle = '#48505a';
  g.fillRect(0, 40, 256, 24);
  for (let i = 0; i < 8; i++) {
    g.fillStyle = '#1f3f8a';
    g.fillRect(i * 32 + 3, 12, 26, 26);
    g.fillStyle = '#2a52b0';
    g.fillRect(i * 32 + 3, 12, 26, 6);
  }
  return c;
}

export function generateDugout(): HTMLCanvasElement {
  const [c, g] = canvas(512, 256);
  g.fillStyle = '#20262e';
  g.fillRect(0, 0, 512, 256);
  g.fillStyle = 'rgba(160,200,230,0.55)';
  g.fillRect(12, 12, 488, 150);
  g.fillStyle = '#c83030';
  for (let i = 0; i < 8; i++) g.fillRect(24 + i * 60, 150, 48, 60);
  g.fillStyle = '#fff';
  g.font = 'bold 28px sans-serif';
  g.fillText('DUGOUT', 196, 240);
  return c;
}

export function generateSky(): HTMLCanvasElement {
  const [c, g] = canvas(512, 256);
  const grd = g.createLinearGradient(0, 0, 0, 256);
  grd.addColorStop(0, '#3b6fb6');
  grd.addColorStop(0.6, '#9cc3e8');
  grd.addColorStop(1, '#dfeaf2');
  g.fillStyle = grd;
  g.fillRect(0, 0, 512, 256);
  const rng = new Rng(11);
  for (let i = 0; i < 40; i++) {
    g.fillStyle = `rgba(255,255,255,${rng.range(0.15, 0.4)})`;
    g.beginPath();
    g.ellipse(rng.range(0, 512), rng.range(20, 150), rng.range(20, 60), rng.range(6, 14), 0, 0, Math.PI * 2);
    g.fill();
  }
  return c;
}

export function generateSurround(): HTMLCanvasElement {
  // Running track / concrete apron between pitch and stands.
  const [c, g] = canvas(256, 256);
  g.fillStyle = '#5d6a4d';
  g.fillRect(0, 0, 256, 256);
  const rng = new Rng(5);
  for (let i = 0; i < 3000; i++) {
    g.fillStyle = `rgba(0,0,0,${rng.range(0, 0.12)})`;
    g.fillRect(rng.range(0, 256), rng.range(0, 256), 2, 2);
  }
  return c;
}

const ADS: [string, string, string][] = [
  ['YOUR AD HERE', '#d01f2e', '#ffffff'],
  ['FREE KICKS', '#0d2b6b', '#ffd200'],
  ['SPONSOR', '#ffd200', '#111111'],
  ['BEND IT!', '#111111', '#3fe05a'],
  ['TOP BINS', '#ffffff', '#d01f2e'],
  ['MAGIC BOOTS', '#1a8f4a', '#ffffff'],
];

export function generateHoarding(i: number): HTMLCanvasElement {
  const [c, g] = canvas(1024, 128);
  const [text, bg, fg] = ADS[i % ADS.length];
  g.fillStyle = bg;
  g.fillRect(0, 0, 1024, 128);
  g.fillStyle = fg;
  g.font = 'bold 84px Impact, Arial Black, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 512, 68);
  g.strokeStyle = 'rgba(0,0,0,0.35)';
  g.lineWidth = 6;
  g.strokeRect(3, 3, 1018, 122);
  return c;
}

/** Generate a single manifest path (used as runtime fallback). */
export function generatePlaceholder(path: string, m: Manifest): HTMLCanvasElement | null {
  for (const kind of ['people', 'cameraman'] as const) {
    const set = m.characters[kind];
    const paths = Object.values(set.sheets).flatMap((s) => [s.base, s.mask, s.uv]);
    if (paths.includes(path)) return (cachedSheets[kind] ??= generateCharacterSheets(set, kind))[path] ?? null;
  }
  if (path === m.crowd.atlas) return generateCrowd(m.crowd);
  const t = m.textures;
  const table: Record<string, () => HTMLCanvasElement> = {
    [t.grass]: generateGrass,
    [t.net]: generateNet,
    [t.ball]: generateBall,
    [t.shadow]: generateShadow,
    [t.stand]: generateStand,
    [t.dugout]: generateDugout,
    [t.sky]: generateSky,
    [t.surround]: generateSurround,
  };
  if (table[path]) return table[path]();
  const hi = m.hoardings.indexOf(path);
  if (hi >= 0) return generateHoarding(hi);
  return null;
}

const cachedSheets: Partial<Record<'people' | 'cameraman', Record<string, HTMLCanvasElement>>> = {};

/** Every placeholder keyed by manifest path, for the exporter. */
export function generateAll(m: Manifest): Record<string, HTMLCanvasElement> {
  const out: Record<string, HTMLCanvasElement> = {
    ...generateCharacterSheets(m.characters.people, 'people'),
    ...generateCharacterSheets(m.characters.cameraman, 'cameraman'),
  };
  out[m.crowd.atlas] = generateCrowd(m.crowd);
  for (const p of Object.values(m.textures)) {
    const c = generatePlaceholder(p, m);
    if (c) out[p] = c;
  }
  m.hoardings.forEach((p, i) => (out[p] = generateHoarding(i)));
  return out;
}

export { DEFAULT_PALETTE };
