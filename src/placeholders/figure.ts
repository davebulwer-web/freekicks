/**
 * Placeholder character renderer: a tiny orthographic ray-caster that draws a capsule-built
 * footballer from any facing angle. It writes three layers that match the sprite contract
 * documented in ASSETS.md:
 *   base - colour image; kit areas are greyscale lighting (0.8 grey = full kit colour)
 *   mask - R = shirt, G = shorts, B = socks (opaque black elsewhere)
 *   uv   - shirt surface coordinates: R = around-the-body u (0 = chest centre, 0.25 = body left,
 *          0.5 = back centre), G = v from collar (0) to hem (1). Used to draw stripes/hoops/etc.
 */

export type Region = 'skin' | 'hair' | 'shirt' | 'shorts' | 'socks' | 'boots' | 'dark' | 'metal' | 'glove';
type V3 = [number, number, number];

interface Prim {
  a: V3;
  b: V3;
  r: number;
  region: Region;
}

export interface Limb {
  swing: number;
  spread?: number;
  bend: number;
}

export interface Pose {
  lean?: number;
  roll?: number;
  rootX?: number;
  rootY?: number;
  armL: Limb;
  armR: Limb;
  legL: Limb;
  legR: Limb;
  /** Extra primitives in body space (e.g. a TV camera). */
  extras?: Prim[];
}

export interface Palette {
  skin: [number, number, number];
  hair: [number, number, number];
  /** Optional baked kit colours (crowd); otherwise kit regions are greyscale. */
  shirt?: [number, number, number];
  shorts?: [number, number, number];
}

export const DEFAULT_PALETTE: Palette = { skin: [217, 162, 122], hair: [59, 36, 20] };

const COLORS: Record<Region, [number, number, number]> = {
  skin: [217, 162, 122],
  hair: [59, 36, 20],
  shirt: [255, 255, 255],
  shorts: [255, 255, 255],
  socks: [255, 255, 255],
  boots: [24, 24, 24],
  dark: [40, 42, 46],
  metal: [150, 150, 155],
  glove: [235, 235, 235],
};

// ------------------------------------------------------------------ skeleton

function limbDir(side: number, swing: number, spread: number): V3 {
  return [side * Math.sin(spread), -Math.cos(swing) * Math.cos(spread), Math.sin(swing) * Math.cos(spread)];
}
const add = (a: V3, b: V3, s = 1): V3 => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];

export function buildBody(pose: Pose): Prim[] {
  const P: Prim[] = [];
  const cap = (a: V3, b: V3, r: number, region: Region) => P.push({ a, b, r, region });

  // Torso (shirt): three vertical capsules give a wide, shallow chest.
  cap([0, 1.0, 0], [0, 1.37, 0], 0.13, 'shirt');
  cap([0.075, 1.0, 0], [0.08, 1.36, -0.005], 0.115, 'shirt');
  cap([-0.075, 1.0, 0], [-0.08, 1.36, -0.005], 0.115, 'shirt');
  cap([-0.1, 0.93, 0], [0.1, 0.93, 0], 0.125, 'shorts');
  // Neck & head
  cap([0, 1.42, 0], [0, 1.57, 0.005], 0.05, 'skin');
  cap([0, 1.665, 0.012], [0, 1.665, 0.012], 0.105, 'skin');
  cap([0, 1.695, -0.014], [0, 1.695, -0.014], 0.108, 'hair');
  cap([0, 1.65, 0.112], [0, 1.65, 0.112], 0.022, 'skin');

  for (const side of [1, -1]) {
    const arm = side > 0 ? pose.armL : pose.armR;
    const sh: V3 = [side * 0.205, 1.43, 0];
    const ud = limbDir(side, arm.swing, arm.spread ?? 0.08);
    const elbow = add(sh, ud, 0.29);
    const fd = limbDir(side, arm.swing + arm.bend, arm.spread ?? 0.08);
    const hand = add(elbow, fd, 0.26);
    cap(sh, add(sh, ud, 0.15), 0.068, 'shirt');
    cap(add(sh, ud, 0.15), elbow, 0.05, 'skin');
    cap(elbow, hand, 0.045, 'skin');
    cap(hand, hand, 0.056, 'skin');

    const leg = side > 0 ? pose.legL : pose.legR;
    const hip: V3 = [side * 0.1, 0.92, 0];
    const td = limbDir(side, leg.swing, leg.spread ?? 0.03);
    const knee = add(hip, td, 0.46);
    const phi = leg.swing - leg.bend;
    const sd = limbDir(side, phi, leg.spread ?? 0.03);
    const ankle = add(knee, sd, 0.44);
    const footDir: V3 = [0, Math.sin(phi), Math.cos(phi)];
    cap(hip, add(hip, td, 0.22), 0.092, 'shorts');
    cap(add(hip, td, 0.22), knee, 0.07, 'skin');
    cap(knee, ankle, 0.062, 'socks');
    cap(add(ankle, footDir, -0.03), add(ankle, footDir, 0.17), 0.05, 'boots');
  }
  if (pose.extras) P.push(...pose.extras);
  return P;
}

// ------------------------------------------------------------------ transforms

interface ViewXf {
  roll: number;
  lean: number;
  rootX: number;
  rootY: number;
  facing: number;
}

function toView(p: V3, xf: ViewXf): V3 {
  let [x, y, z] = p;
  // roll about forward axis, pivot at the hips
  const py = 0.95;
  let yy = y - py;
  const cr = Math.cos(xf.roll), sr = Math.sin(xf.roll);
  [x, yy] = [x * cr + yy * sr, -x * sr + yy * cr];
  // lean forward about the lateral axis
  const cl = Math.cos(xf.lean), sl = Math.sin(xf.lean);
  [yy, z] = [yy * cl - z * sl, yy * sl + z * cl];
  y = yy + py + xf.rootY;
  x += xf.rootX;
  const ca = Math.cos(xf.facing), sa = Math.sin(xf.facing);
  return [x * ca + z * sa, y, -x * sa + z * ca];
}

// ------------------------------------------------------------------ ray casting

function intersectCapsule(ox: number, oy: number, a: V3, b: V3, r: number): number | null {
  // Ray: origin (ox, oy, +inf) heading -z. Returns hit z (largest z = nearest viewer) or null.
  const OZ = 50;
  const rd: V3 = [0, 0, -1];
  const ba: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const oa: V3 = [ox - a[0], oy - a[1], OZ - a[2]];
  const baba = ba[0] * ba[0] + ba[1] * ba[1] + ba[2] * ba[2];
  if (baba < 1e-9) {
    const bq = oa[2] * rd[2];
    const c = oa[0] * oa[0] + oa[1] * oa[1] + oa[2] * oa[2] - r * r;
    const h = bq * bq - c;
    if (h < 0) return null;
    return OZ - (-bq - Math.sqrt(h));
  }
  const bard = ba[2] * rd[2];
  const baoa = ba[0] * oa[0] + ba[1] * oa[1] + ba[2] * oa[2];
  const rdoa = rd[2] * oa[2];
  const oaoa = oa[0] * oa[0] + oa[1] * oa[1] + oa[2] * oa[2];
  const A = baba - bard * bard;
  const B = baba * rdoa - baoa * bard;
  const C = baba * oaoa - baoa * baoa - r * r * baba;
  const h = B * B - A * C;
  if (h >= 0 && A > 1e-12) {
    const t = (-B - Math.sqrt(h)) / A;
    const y = baoa + t * bard;
    if (y > 0 && y < baba) return OZ - t;
  }
  // caps
  let best: number | null = null;
  for (const p of [a, b]) {
    const oc: V3 = [ox - p[0], oy - p[1], OZ - p[2]];
    const bq = oc[2] * rd[2];
    const c = oc[0] * oc[0] + oc[1] * oc[1] + oc[2] * oc[2] - r * r;
    const hh = bq * bq - c;
    if (hh > 0) {
      const z = OZ - (-bq - Math.sqrt(hh));
      if (best === null || z > best) best = z;
    }
  }
  return best;
}

function capsuleNormal(p: V3, a: V3, b: V3, r: number): V3 {
  const ba: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const pa: V3 = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
  const baba = ba[0] * ba[0] + ba[1] * ba[1] + ba[2] * ba[2];
  const h = baba > 0 ? Math.max(0, Math.min(1, (pa[0] * ba[0] + pa[1] * ba[1] + pa[2] * ba[2]) / baba)) : 0;
  return [(pa[0] - ba[0] * h) / r, (pa[1] - ba[1] * h) / r, (pa[2] - ba[2] * h) / r];
}

export interface FrameTarget {
  base: ImageData;
  mask: ImageData;
  uv: ImageData;
  /** Top-left of this frame inside the sheets. */
  x0: number;
  y0: number;
  w: number;
  h: number;
  /** Pixels per metre and ground line (px from frame top). */
  ppm: number;
  groundY: number;
}

const LIGHT: V3 = (() => {
  const v: V3 = [-0.45, 0.75, 0.55];
  const l = Math.hypot(...v);
  return [v[0] / l, v[1] / l, v[2] / l];
})();

/** Render one pose at one facing angle into the frame cell. facing: 0 = facing viewer, +PI/2 = facing screen-right. */
export function renderFrame(t: FrameTarget, pose: Pose, facing: number, palette: Palette = DEFAULT_PALETTE) {
  const xf: ViewXf = { roll: pose.roll ?? 0, lean: pose.lean ?? 0, rootX: pose.rootX ?? 0, rootY: pose.rootY ?? 0, facing };
  const prims = buildBody(pose).map((p) => ({ ...p, a: toView(p.a, xf), b: toView(p.b, xf) }));
  // Torso frame for shirt UVs
  const tO = toView([0, 0.94, 0], xf);
  const tTop = toView([0, 1.52, 0], xf);
  const tF = sub(toView([0, 0.94, 1], xf), tO);
  const tL = sub(toView([1, 0.94, 0], xf), tO);
  const tU = sub(tTop, tO);
  const tLen = Math.hypot(...tU);

  const { w, h, ppm, groundY } = t;
  const depth = new Float32Array(w * h).fill(-1e9);
  const hitPrim = new Int16Array(w * h).fill(-1);

  prims.forEach((p, idx) => {
    const minX = Math.floor(w / 2 + (Math.min(p.a[0], p.b[0]) - p.r) * ppm) - 1;
    const maxX = Math.ceil(w / 2 + (Math.max(p.a[0], p.b[0]) + p.r) * ppm) + 1;
    const minY = Math.floor(groundY - (Math.max(p.a[1], p.b[1]) + p.r) * ppm) - 1;
    const maxY = Math.ceil(groundY - (Math.min(p.a[1], p.b[1]) - p.r) * ppm) + 1;
    for (let py = Math.max(0, minY); py < Math.min(h, maxY); py++) {
      for (let px = Math.max(0, minX); px < Math.min(w, maxX); px++) {
        const vx = (px + 0.5 - w / 2) / ppm;
        const vy = (groundY - (py + 0.5)) / ppm;
        const z = intersectCapsule(vx, vy, p.a, p.b, p.r);
        if (z !== null && z > depth[py * w + px]) {
          depth[py * w + px] = z;
          hitPrim[py * w + px] = idx;
        }
      }
    }
  });

  const put = (img: ImageData, px: number, py: number, r: number, g: number, b: number, a: number) => {
    const i = ((t.y0 + py) * img.width + (t.x0 + px)) * 4;
    img.data[i] = r;
    img.data[i + 1] = g;
    img.data[i + 2] = b;
    img.data[i + 3] = a;
  };

  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      const k = py * w + px;
      const pi = hitPrim[k];
      put(t.mask, px, py, 0, 0, 0, 255);
      put(t.uv, px, py, 0, 0, 0, 255);
      if (pi < 0) {
        // 1px outline around the figure for readability on grass.
        let edge = false;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = px + dx, ny = py + dy;
          if (nx >= 0 && ny >= 0 && nx < w && ny < h && hitPrim[ny * w + nx] >= 0) edge = true;
        }
        put(t.base, px, py, 20, 22, 20, edge ? 255 : 0);
        continue;
      }
      const p = prims[pi];
      const vx = (px + 0.5 - w / 2) / ppm;
      const vy = (groundY - (py + 0.5)) / ppm;
      const hit: V3 = [vx, vy, depth[k]];
      const n = capsuleNormal(hit, p.a, p.b, p.r);
      const lambert = Math.max(0, n[0] * LIGHT[0] + n[1] * LIGHT[1] + n[2] * LIGHT[2]);
      const shade = 0.42 + 0.58 * lambert;
      const kit = p.region === 'shirt' || p.region === 'shorts' || p.region === 'socks';
      if (kit) {
        const baked = p.region === 'shirt' ? palette.shirt : p.region === 'shorts' ? palette.shorts : undefined;
        if (baked) put(t.base, px, py, baked[0] * shade, baked[1] * shade, baked[2] * shade, 255);
        else {
          const g = Math.round(255 * 0.8 * shade * 1.05);
          put(t.base, px, py, g, g, g, 255);
        }
        put(t.mask, px, py, p.region === 'shirt' ? 255 : 0, p.region === 'shorts' ? 255 : 0, p.region === 'socks' ? 255 : 0, 255);
        if (p.region === 'shirt') {
          const d = sub(hit, tO);
          const theta = Math.atan2(dot(d, tL), dot(d, tF));
          const u = (((theta / (Math.PI * 2)) % 1) + 1) % 1;
          const v = Math.max(0, Math.min(1, 1 - dot(d, tU) / (tLen * tLen)));
          put(t.uv, px, py, Math.round(u * 255), Math.round(v * 255), 0, 255);
        }
      } else {
        const c = p.region === 'skin' ? palette.skin : p.region === 'hair' ? palette.hair : COLORS[p.region];
        put(t.base, px, py, c[0] * shade, c[1] * shade, c[2] * shade, 255);
      }
    }
  }
}

function sub(a: V3, b: V3): V3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
function dot(a: V3, b: V3) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

// ------------------------------------------------------------------ poses

const L = (swing: number, bend: number, spread?: number): Limb => ({ swing, bend, spread });

export function poseFor(anim: string, frame: number, count: number): Pose {
  const ph = (frame / count) * Math.PI * 2;
  switch (anim) {
    case 'idle': {
      const b = frame === 1 ? 0.02 : 0;
      return { lean: 0.04, rootY: -0.01 - b, armL: L(0.15, 0.35, 0.18), armR: L(0.1, 0.3, 0.18), legL: L(0.06, 0.12, 0.08), legR: L(-0.02, 0.1, 0.08) };
    }
    case 'run': {
      const s = Math.sin(ph);
      return {
        lean: 0.2,
        rootY: -0.03 + 0.035 * Math.abs(Math.cos(ph)),
        armL: L(-0.75 * s, 1.5),
        armR: L(0.75 * s, 1.5),
        legL: L(0.75 * s, 0.25 + 1.1 * Math.max(0, -Math.cos(ph + 0.5))),
        legR: L(-0.75 * s, 0.25 + 1.1 * Math.max(0, Math.cos(ph + 0.5))),
      };
    }
    case 'kick': {
      const frames: Pose[] = [
        { lean: 0.15, armL: L(0.5, 0.6, 0.6), armR: L(-0.3, 0.5, 0.4), legL: L(0.15, 0.25), legR: L(-0.9, 1.6) },
        { lean: 0.05, armL: L(0.7, 0.4, 0.8), armR: L(-0.6, 0.4, 0.5), legL: L(0.05, 0.25), legR: L(0.25, 0.3) },
        { lean: -0.12, armL: L(0.4, 0.4, 0.9), armR: L(-0.5, 0.3, 0.6), legL: L(-0.05, 0.15), legR: L(1.25, 0.15) },
        { lean: 0.05, armL: L(0.2, 0.4, 0.4), armR: L(-0.1, 0.4, 0.3), legL: L(0.0, 0.2), legR: L(0.6, 0.6) },
      ];
      return frames[Math.min(frame, frames.length - 1)];
    }
    case 'jump':
      return frame === 0
        ? { lean: 0.1, rootY: -0.12, armL: L(-0.3, 0.4, 0.15), armR: L(-0.3, 0.4, 0.15), legL: L(0.4, 0.9), legR: L(0.4, 0.9) }
        : { lean: 0, armL: L(0.3, 1.2, 0.1), armR: L(0.3, 1.2, 0.1), legL: L(0.1, 0.4), legR: L(0.05, 0.5) };
    case 'celebrate':
      return {
        lean: -0.08,
        armL: L(2.7 + (frame ? 0.25 : 0), 0.2, 0.45),
        armR: L(2.7 + (frame ? 0 : 0.25), 0.2, 0.45),
        legL: L(0.1, 0.1),
        legR: L(-0.1, 0.15),
      };
    case 'hold':
      return { lean: 0.05, armL: L(1.0, 1.0, -0.05), armR: L(1.0, 1.0, -0.05), legL: L(0.05, 0.1), legR: L(-0.02, 0.1) };
    case 'dive_left':
    case 'dive_right': {
      const dir = anim === 'dive_left' ? 1 : -1;
      const frames = [
        { roll: 0.35, rootY: -0.12, lean: 0.1, up: L(1.6, 0.3, 0.6), legs: [L(0.3, 1.0), L(0.4, 0.9)] },
        { roll: 1.3, rootY: 0.05, lean: 0.05, up: L(2.95, 0.05, 0.12), legs: [L(0.15, 0.2), L(-0.1, 0.3)] },
        { roll: 1.52, rootY: -0.58, lean: 0, up: L(2.95, 0.1, 0.1), legs: [L(0.2, 0.4), L(0.4, 0.8)] },
      ];
      const f = frames[Math.min(frame, 2)];
      return {
        roll: dir * f.roll,
        rootY: f.rootY,
        rootX: dir * 0.3,
        lean: f.lean,
        armL: f.up,
        armR: f.up,
        legL: dir > 0 ? f.legs[0] : f.legs[1],
        legR: dir > 0 ? f.legs[1] : f.legs[0],
      };
    }
    default:
      return poseFor('idle', 0, 1);
  }
}
