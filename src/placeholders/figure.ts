/**
 * Procedural character renderer. A footballer is modelled as a smooth union of signed distance
 * primitives (tapered capsules and ellipsoids) and sphere-traced orthographically from any facing
 * angle. It writes three layers that match the sprite contract in ASSETS.md:
 *   base - colour image; kit areas are greyscale lighting (0.8 grey = full kit colour). Fabric
 *          folds, seams, collar, cuffs and sock ribbing live here as grey shading only.
 *   mask - R = shirt, G = shorts, B = socks (opaque black elsewhere)
 *   uv   - shirt surface coordinates: R = around-the-body u (0 = chest centre, 0.25 = body left,
 *          0.5 = back centre), G = v from collar (0) to hem (1). Used to draw stripes/hoops/etc.
 */

export type Region = 'skin' | 'hair' | 'shirt' | 'shorts' | 'socks' | 'boots' | 'dark' | 'metal' | 'glove' | 'ball';
type V3 = [number, number, number];

type Tag =
  | 'torso' | 'sleeve' | 'pelvis' | 'shortsLeg' | 'sockTop' | 'sock' | 'boot' | 'sole'
  | 'skin' | 'hair' | 'ball' | 'plain';

/** Extra primitive for props (e.g. a TV camera), in body space. */
export interface ExtraPrim {
  a: V3;
  b: V3;
  r: number;
  region: Region;
}

export interface Limb {
  swing: number;
  spread?: number;
  bend: number;
  /** Ankle flex for legs (+ = toes up). */
  foot?: number;
}

export interface Pose {
  /** Upper-body lean at the spine (+ = forward). */
  lean?: number;
  roll?: number;
  rootX?: number;
  rootY?: number;
  /** Upper-body rotation about the spine (+ = shoulders turn to body-left). */
  twist?: number;
  /** Upper-body lean sideways (+ = towards body-left). */
  sideBend?: number;
  /** Head pitch (+ = looking down) and yaw. */
  headTilt?: number;
  headTurn?: number;
  armL: Limb;
  armR: Limb;
  legL: Limb;
  legR: Limb;
  /** Keep the lowest point of the body on the ground line (default true). */
  ground?: boolean;
  /** Extra lift after grounding (hops). */
  lift?: number;
  /** Cradle a ball at the chest. */
  ball?: boolean;
  /** Varies fabric folds between frames. */
  foldSeed?: number;
  extras?: ExtraPrim[];
}

export interface Palette {
  skin: [number, number, number];
  hair: [number, number, number];
  /** Optional baked kit colours (crowd); otherwise kit regions are greyscale. */
  shirt?: [number, number, number];
  shorts?: [number, number, number];
}

export const DEFAULT_PALETTE: Palette = { skin: [205, 150, 112], hair: [46, 31, 22] };

const FIXED: Partial<Record<Region, V3>> = {
  boots: [28, 28, 31],
  dark: [40, 42, 46],
  metal: [150, 150, 155],
  glove: [235, 235, 235],
};

// ------------------------------------------------------------------ primitives

interface Cone {
  k: 0;
  a: V3;
  b: V3;
  r1: number;
  r2: number;
  region: Region;
  tag: Tag;
}
interface Ell {
  k: 1;
  c: V3;
  ax: [V3, V3, V3];
  rad: V3;
  region: Region;
  tag: Tag;
}
type Prim = Cone | Ell;

const add = (a: V3, b: V3, s = 1): V3 => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
const norm = (a: V3): V3 => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (e0: number, e1: number, x: number) => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};

function sdRoundCone(p: V3, a: V3, b: V3, r1: number, r2: number): number {
  const ba = sub(b, a);
  const l2 = dot(ba, ba);
  if (l2 < 1e-10) return len(sub(p, a)) - Math.max(r1, r2);
  const rr = r1 - r2;
  const a2 = l2 - rr * rr;
  const il2 = 1 / l2;
  const pa = sub(p, a);
  const y = dot(pa, ba);
  const z = y - l2;
  const xv: V3 = [pa[0] * l2 - ba[0] * y, pa[1] * l2 - ba[1] * y, pa[2] * l2 - ba[2] * y];
  const x2 = dot(xv, xv);
  const y2 = y * y * l2;
  const z2 = z * z * l2;
  const k = Math.sign(rr) * rr * rr * x2;
  if (Math.sign(z) * a2 * z2 > k) return Math.sqrt(x2 + z2) * il2 - r2;
  if (Math.sign(y) * a2 * y2 < k) return Math.sqrt(x2 + y2) * il2 - r1;
  return (Math.sqrt(x2 * a2 * il2) + y * rr) * il2 - r1;
}

function sdEll(p: V3, e: Ell): number {
  const d = sub(p, e.c);
  const qx = dot(d, e.ax[0]), qy = dot(d, e.ax[1]), qz = dot(d, e.ax[2]);
  const k0 = Math.hypot(qx / e.rad[0], qy / e.rad[1], qz / e.rad[2]);
  const k1 = Math.hypot(qx / (e.rad[0] * e.rad[0]), qy / (e.rad[1] * e.rad[1]), qz / (e.rad[2] * e.rad[2]));
  return k1 > 1e-9 ? (k0 * (k0 - 1)) / k1 : -Math.min(...e.rad);
}

const sdPrim = (p: V3, q: Prim) => (q.k === 0 ? sdRoundCone(p, q.a, q.b, q.r1, q.r2) : sdEll(p, q));

const BLEND = 0.022;
function smin(a: number, b: number) {
  const h = Math.max(BLEND - Math.abs(a - b), 0) / BLEND;
  return Math.min(a, b) - h * h * BLEND * 0.25;
}

// ------------------------------------------------------------------ skeleton

function limbDir(side: number, swing: number, spread: number): V3 {
  return [side * Math.sin(spread), -Math.cos(swing) * Math.cos(spread), Math.sin(swing) * Math.cos(spread)];
}

function rotY(p: V3, pivot: V3, a: number): V3 {
  const c = Math.cos(a), s = Math.sin(a);
  const x = p[0] - pivot[0], z = p[2] - pivot[2];
  return [pivot[0] + x * c + z * s, p[1], pivot[2] - x * s + z * c];
}
function rotX(p: V3, pivot: V3, a: number): V3 {
  // + tips the top forward (+z)
  const c = Math.cos(a), s = Math.sin(a);
  const y = p[1] - pivot[1], z = p[2] - pivot[2];
  return [p[0], pivot[1] + y * c - z * s, pivot[2] + y * s + z * c];
}
function rotZ(p: V3, pivot: V3, a: number): V3 {
  // + tips the top towards +x (body-left)
  const c = Math.cos(a), s = Math.sin(a);
  const x = p[0] - pivot[0], y = p[1] - pivot[1];
  return [pivot[0] + x * c + y * s, pivot[1] - x * s + y * c, p[2]];
}

const SPINE: V3 = [0, 1.02, 0];
const NECK: V3 = [0, 1.57, 0];

type Part = 'lower' | 'upper' | 'head';

interface Builder {
  prims: Prim[];
  xf: (p: V3, part: Part) => V3;
}

function cone(B: Builder, part: Part, a: V3, b: V3, r1: number, r2: number, region: Region, tag: Tag) {
  B.prims.push({ k: 0, a: B.xf(a, part), b: B.xf(b, part), r1, r2, region, tag });
}

/** Ellipsoid with axes along x/y/z of a frame given by `fwd` (z) and `up` (y) in body space. */
function ell(B: Builder, part: Part, c: V3, rad: V3, region: Region, tag: Tag, up: V3 = [0, 1, 0], fwd: V3 = [0, 0, 1]) {
  const y = norm(up);
  const x = norm(cross(y, fwd));
  const z = cross(x, y);
  const C = B.xf(c, part);
  const axes = [x, y, z].map((v) => norm(sub(B.xf(add(c, v), part), C))) as [V3, V3, V3];
  B.prims.push({ k: 1, c: C, ax: axes, rad, region, tag });
}

interface Built {
  prims: Prim[];
  torso: { o: V3; f: V3; l: V3; u: V3; len: number };
  bodyLeft: V3;
  bodyFwd: V3;
  up: V3;
}

function build(pose: Pose, facing: number): Built {
  const roll = pose.roll ?? 0, lean = pose.lean ?? 0;
  const twist = pose.twist ?? 0, bend = pose.sideBend ?? 0;
  const tilt = pose.headTilt ?? 0, turn = pose.headTurn ?? 0;
  const pivot: V3 = [0, 0.95, 0];
  let rootY = pose.rootY ?? 0;
  const rootX = pose.rootX ?? 0;

  const local = (p: V3, part: Part): V3 => {
    let q = p;
    if (part === 'head') {
      q = rotX(q, NECK, tilt);
      q = rotY(q, NECK, turn);
    }
    if (part !== 'lower') {
      q = rotZ(q, SPINE, bend);
      q = rotY(q, SPINE, twist);
      q = rotX(q, SPINE, lean);
    }
    return q;
  };
  const toView = (p: V3): V3 => {
    let q = rotZ(p, pivot, roll);
    q = [q[0] + rootX, q[1] + rootY, q[2]];
    const ca = Math.cos(facing), sa = Math.sin(facing);
    return [q[0] * ca + q[2] * sa, q[1], -q[0] * sa + q[2] * ca];
  };
  const B: Builder = { prims: [], xf: (p, part) => toView(local(p, part)) };

  // ---- torso (shirt): chest, abdomen, yoke over the shoulders
  ell(B, 'upper', [0, 1.31, 0.005], [0.178, 0.17, 0.118], 'shirt', 'torso');
  ell(B, 'upper', [0, 1.12, 0], [0.158, 0.15, 0.108], 'shirt', 'torso');
  ell(B, 'upper', [0, 1.425, -0.012], [0.15, 0.06, 0.095], 'shirt', 'torso');
  ell(B, 'upper', [0, 1.02, 0], [0.165, 0.07, 0.113], 'shirt', 'torso');
  // ---- shorts
  ell(B, 'lower', [0, 0.95, 0], [0.163, 0.1, 0.115], 'shorts', 'pelvis');
  for (const s of [1, -1]) ell(B, 'lower', [s * 0.075, 0.9, -0.045], [0.085, 0.085, 0.08], 'shorts', 'pelvis');
  // ---- neck & head
  cone(B, 'upper', [0, 1.46, -0.005], [0, 1.6, 0.012], 0.058, 0.05, 'skin', 'skin');
  ell(B, 'head', [0, 1.69, 0], [0.083, 0.108, 0.098], 'skin', 'skin');
  ell(B, 'head', [0, 1.635, 0.028], [0.068, 0.07, 0.078], 'skin', 'skin');
  ell(B, 'head', [0, 1.664, 0.104], [0.014, 0.026, 0.02], 'skin', 'skin', [0, 1, 0.25]);
  for (const s of [1, -1]) ell(B, 'head', [s * 0.084, 1.672, -0.004], [0.014, 0.03, 0.022], 'skin', 'skin');
  for (const s of [1, -1]) {
    ell(B, 'head', [s * 0.031, 1.688, 0.084], [0.012, 0.007, 0.01], 'dark', 'plain');
    ell(B, 'head', [s * 0.032, 1.705, 0.086], [0.021, 0.006, 0.012], 'hair', 'hair');
  }
  ell(B, 'head', [0, 1.722, -0.016], [0.091, 0.09, 0.104], 'hair', 'hair');
  ell(B, 'head', [0, 1.762, 0.045], [0.08, 0.035, 0.055], 'hair', 'hair', [0, 1, -0.3]);

  // ---- arms
  for (const side of [1, -1]) {
    const arm = side > 0 ? pose.armL : pose.armR;
    const sh: V3 = [side * 0.2, 1.44, -0.005];
    const ud = limbDir(side, arm.swing, arm.spread ?? 0.1);
    const elbow = add(sh, ud, 0.29);
    const fd = limbDir(side, arm.swing + arm.bend, arm.spread ?? 0.1);
    const wrist = add(elbow, fd, 0.25);
    const shIn: V3 = [side * 0.17, 1.43, -0.005];
    cone(B, 'upper', shIn, add(sh, ud, 0.165), 0.06, 0.062, 'shirt', 'sleeve');
    cone(B, 'upper', add(sh, ud, 0.13), elbow, 0.053, 0.04, 'skin', 'skin');
    ell(B, 'upper', add(sh, ud, 0.19), [0.05, 0.065, 0.054], 'skin', 'skin', ud);
    cone(B, 'upper', elbow, wrist, 0.041, 0.028, 'skin', 'skin');
    ell(B, 'upper', add(elbow, fd, 0.07), [0.042, 0.06, 0.042], 'skin', 'skin', fd);
    ell(B, 'upper', add(wrist, fd, 0.055), [0.032, 0.062, 0.045], 'skin', 'skin', fd);

    // ---- legs
    const leg = side > 0 ? pose.legL : pose.legR;
    const hip: V3 = [side * 0.093, 0.92, 0];
    const td = limbDir(side, leg.swing, leg.spread ?? 0.04);
    const knee = add(hip, td, 0.44);
    const phi = leg.swing - leg.bend;
    const sd = limbDir(side, phi, leg.spread ?? 0.04);
    const ankle = add(knee, sd, 0.42);
    const fa = phi + (leg.foot ?? 0);
    const footDir: V3 = [0, Math.sin(fa), Math.cos(fa)];
    const sole: V3 = [0, -Math.cos(fa), Math.sin(fa)];
    cone(B, 'lower', hip, add(hip, td, 0.21), 0.097, 0.09, 'shorts', 'shortsLeg');
    cone(B, 'lower', add(hip, td, 0.16), knee, 0.08, 0.05, 'skin', 'skin');
    ell(B, 'lower', add(hip, td, 0.28), [0.072, 0.11, 0.076], 'skin', 'skin', td);
    ell(B, 'lower', knee, [0.05, 0.05, 0.052], 'skin', 'skin', td);
    cone(B, 'lower', add(knee, sd, 0.05), add(knee, sd, 0.15), 0.053, 0.058, 'socks', 'sockTop');
    cone(B, 'lower', add(knee, sd, 0.13), add(knee, sd, 0.26), 0.059, 0.05, 'socks', 'sock');
    cone(B, 'lower', add(knee, sd, 0.24), ankle, 0.05, 0.036, 'socks', 'sock');
    // boot: upper, toe and sole
    const heel = add(add(ankle, footDir, -0.045), sole, 0.035);
    const toe = add(add(ankle, footDir, 0.175), sole, 0.045);
    cone(B, 'lower', ankle, add(ankle, sole, 0.01), 0.043, 0.043, 'boots', 'boot');
    cone(B, 'lower', heel, toe, 0.045, 0.034, 'boots', 'boot');
    cone(B, 'lower', add(heel, sole, 0.03), add(toe, sole, 0.022), 0.03, 0.022, 'boots', 'sole');
  }

  if (pose.ball) ell(B, 'upper', [0, 1.2, 0.27], [0.11, 0.11, 0.11], 'ball', 'ball');
  for (const e of pose.extras ?? []) cone(B, 'lower', e.a, e.b, e.r, e.r, e.region, e.region === 'dark' || e.region === 'metal' ? 'plain' : 'skin');

  // Shirt surface frame (for UVs and fold detail) follows the upper body.
  const o = B.xf([0, 0.94, 0], 'upper');
  const torso = {
    o,
    f: sub(B.xf([0, 0.94, 1], 'upper'), o),
    l: sub(B.xf([1, 0.94, 0], 'upper'), o),
    u: sub(B.xf([0, 1.52, 0], 'upper'), o),
    len: 0.58,
  };
  const lo = B.xf([0, 0, 0], 'lower');
  const built: Built = {
    prims: B.prims,
    torso,
    bodyLeft: sub(B.xf([1, 0, 0], 'lower'), lo),
    bodyFwd: sub(B.xf([0, 0, 1], 'lower'), lo),
    up: sub(B.xf([0, 1, 0], 'lower'), lo),
  };

  // Ground the lowest point of the body on the ground line.
  if (pose.ground !== false) {
    let minY = Infinity;
    for (const q of built.prims) {
      if (q.k === 0) minY = Math.min(minY, q.a[1] - q.r1, q.b[1] - q.r2);
      else {
        const ext = Math.hypot(q.ax[0][1] * q.rad[0], q.ax[1][1] * q.rad[1], q.ax[2][1] * q.rad[2]);
        minY = Math.min(minY, q.c[1] - ext);
      }
    }
    const dy = -minY + (pose.lift ?? 0);
    rootY += dy;
    for (const q of built.prims) {
      if (q.k === 0) {
        q.a[1] += dy;
        q.b[1] += dy;
      } else q.c[1] += dy;
    }
    torso.o[1] += dy;
  }
  return built;
}

/** Horizontal half-extent (m) and top (m above ground) of a pose seen from `facing`. */
export function extents(pose: Pose, facing: number): { half: number; top: number } {
  const b = build(pose, facing);
  let half = 0, top = 0;
  for (const q of b.prims) {
    if (q.k === 0) {
      half = Math.max(half, Math.abs(q.a[0]) + q.r1, Math.abs(q.b[0]) + q.r2);
      top = Math.max(top, q.a[1] + q.r1, q.b[1] + q.r2);
    } else {
      const ex = (k: number) => Math.hypot(q.ax[0][k] * q.rad[0], q.ax[1][k] * q.rad[1], q.ax[2][k] * q.rad[2]);
      half = Math.max(half, Math.abs(q.c[0]) + ex(0));
      top = Math.max(top, q.c[1] + ex(1));
    }
  }
  return { half, top };
}

function scalePose(p: Pose, k: number): Pose {
  const limb = (l: Limb, rest: Limb): Limb => ({
    swing: rest.swing + (l.swing - rest.swing) * k,
    bend: rest.bend + (l.bend - rest.bend) * k,
    spread: (rest.spread ?? 0) + ((l.spread ?? rest.spread ?? 0) - (rest.spread ?? 0)) * k,
    foot: (l.foot ?? 0) * k,
  });
  const arm = { swing: 0.05, bend: 0.3, spread: 0.12 };
  const leg = { swing: 0, bend: 0.15, spread: 0.06 };
  return {
    ...p,
    lean: (p.lean ?? 0) * k,
    twist: (p.twist ?? 0) * k,
    armL: limb(p.armL, arm),
    armR: limb(p.armR, arm),
    legL: limb(p.legL, leg),
    legR: limb(p.legR, leg),
  };
}

/**
 * Scale a pose's limb motion (identically for every direction) until it fits inside the frame,
 * so sheets keep a fixed frame size and a fixed character centre.
 */
export function fitPose(pose: Pose, halfWidth: number, maxTop: number, directions = 8): Pose {
  const fits = (p: Pose) => {
    for (let r = 0; r < directions; r++) {
      const e = extents(p, (r * Math.PI * 2) / directions);
      if (e.half > halfWidth || e.top > maxTop) return false;
    }
    return true;
  };
  if (fits(pose)) return pose;
  let lo = 0, hi = 1;
  for (let i = 0; i < 12; i++) {
    const mid = (lo + hi) / 2;
    if (fits(scalePose(pose, mid))) lo = mid;
    else hi = mid;
  }
  return scalePose(pose, lo);
}

// ------------------------------------------------------------------ rendering

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

const L_KEY = norm([-0.45, 0.75, 0.55]);
const L_FILL = norm([0.7, 0.15, 0.45]);
const TILE = 8;

interface Sample {
  hit: boolean;
  /** RGB in 0..255 */
  col: V3;
  region: Region;
  /** Shirt uv (0..1) when region is shirt. */
  u: number;
  v: number;
  z: number;
}

/** Render one pose at one facing angle into the frame cell. facing: 0 = facing viewer, +PI/2 = facing screen-right. */
export function renderFrame(t: FrameTarget, pose: Pose, facing: number, palette: Palette = DEFAULT_PALETTE) {
  const B = build(pose, facing);
  const { w, h, ppm, groundY } = t;

  // Screen-space bounds per primitive, bucketed into tiles.
  const tilesX = Math.ceil(w / TILE), tilesY = Math.ceil(h / TILE);
  const tiles: number[][] = Array.from({ length: tilesX * tilesY }, () => []);
  const zMax: number[] = [];
  B.prims.forEach((q, i) => {
    let x0, x1, y0, y1, z1;
    if (q.k === 0) {
      const r = Math.max(q.r1, q.r2) + BLEND;
      x0 = Math.min(q.a[0], q.b[0]) - r; x1 = Math.max(q.a[0], q.b[0]) + r;
      y0 = Math.min(q.a[1], q.b[1]) - r; y1 = Math.max(q.a[1], q.b[1]) + r;
      z1 = Math.max(q.a[2], q.b[2]) + r;
    } else {
      const ex = (k: number) => Math.hypot(q.ax[0][k] * q.rad[0], q.ax[1][k] * q.rad[1], q.ax[2][k] * q.rad[2]) + BLEND;
      x0 = q.c[0] - ex(0); x1 = q.c[0] + ex(0);
      y0 = q.c[1] - ex(1); y1 = q.c[1] + ex(1);
      z1 = q.c[2] + ex(2);
    }
    zMax[i] = z1;
    const px0 = Math.floor((w / 2 + x0 * ppm) / TILE), px1 = Math.floor((w / 2 + x1 * ppm) / TILE);
    const py0 = Math.floor((groundY - y1 * ppm) / TILE), py1 = Math.floor((groundY - y0 * ppm) / TILE);
    for (let ty = Math.max(0, py0); ty <= Math.min(tilesY - 1, py1); ty++)
      for (let tx = Math.max(0, px0); tx <= Math.min(tilesX - 1, px1); tx++) tiles[ty * tilesX + tx].push(i);
  });

  const field = (p: V3, cand: number[]) => {
    let d = 1e9;
    for (const i of cand) d = smin(d, sdPrim(p, B.prims[i]));
    return d;
  };

  const sample = (sx: number, sy: number): Sample => {
    const tx = Math.floor(sx / TILE), ty = Math.floor(sy / TILE);
    const miss: Sample = { hit: false, col: [0, 0, 0], region: 'skin', u: 0, v: 0, z: -1e9 };
    if (tx < 0 || ty < 0 || tx >= tilesX || ty >= tilesY) return miss;
    const cand = tiles[ty * tilesX + tx];
    if (!cand.length) return miss;
    const x = (sx - w / 2) / ppm;
    const y = (groundY - sy) / ppm;
    let z = -1e9;
    for (const i of cand) z = Math.max(z, zMax[i]);
    const zEnd = z - 1.6;
    let hitP: V3 | null = null;
    for (let k = 0; k < 64 && z > zEnd; k++) {
      const p: V3 = [x, y, z];
      const d = field(p, cand);
      if (d < 0.0006) {
        hitP = p;
        break;
      }
      z -= Math.max(d, 0.0008);
    }
    if (!hitP) return miss;
    return shade(hitP, cand);
  };

  const shade = (p: V3, cand: number[]): Sample => {
    // Nearest primitive decides the material.
    let best = 0, bd = 1e9;
    for (const i of cand) {
      const d = sdPrim(p, B.prims[i]);
      if (d < bd) { bd = d; best = i; }
    }
    const q = B.prims[best];
    const e = 0.0015;
    const n = norm([
      field([p[0] + e, p[1], p[2]], cand) - field([p[0] - e, p[1], p[2]], cand),
      field([p[0], p[1] + e, p[2]], cand) - field([p[0], p[1] - e, p[2]], cand),
      field([p[0], p[1], p[2] + e], cand) - field([p[0], p[1], p[2] - e], cand),
    ]);
    let ao = 1;
    for (let k = 1; k <= 3; k++) {
      const hh = 0.018 * k;
      ao -= (hh - field(add(p, n, hh), cand)) * (1.6 / k);
    }
    ao = 0.45 + 0.55 * clamp01(ao);
    const key = Math.max(0, dot(n, L_KEY));
    const fill = Math.max(0, dot(n, L_FILL));
    const rim = Math.pow(1 - Math.max(0, n[2]), 3);
    let light = (0.3 * ao + 0.68 * key * (0.6 + 0.4 * ao) + 0.16 * fill + 0.22 * rim);

    let region = q.region;
    let u = 0, v = 0;
    let detail = 1;
    const T = B.torso;

    // Shirt surface coordinates from the torso frame (used for sleeves too).
    if (region === 'shirt') {
      const d = sub(p, T.o);
      const theta = Math.atan2(dot(d, T.l), dot(d, T.f));
      u = (((theta / (Math.PI * 2)) % 1) + 1) % 1;
      v = clamp01(1 - dot(d, T.u) / (T.len * T.len));
    }

    const coneT = (c: Cone) => {
      const ba = sub(c.b, c.a);
      return clamp01(dot(sub(p, c.a), ba) / dot(ba, ba));
    };
    const aroundLimb = (c: Cone) => {
      const ax = norm(sub(c.b, c.a));
      const rad = norm(sub(sub(p, c.a), [ax[0] * dot(sub(p, c.a), ax), ax[1] * dot(sub(p, c.a), ax), ax[2] * dot(sub(p, c.a), ax)]));
      return Math.atan2(dot(rad, B.bodyFwd), dot(rad, B.bodyLeft));
    };
    const seed = pose.foldSeed ?? 0;

    switch (q.tag) {
      case 'torso': {
        const a = u * Math.PI * 2;
        const side = Math.abs(Math.sin(a));
        const front = Math.cos(a);
        // Diagonal drag folds from the armpits towards the waist, horizontal folds at the waist.
        const diag = Math.sin(v * 21 + Math.sin(a) * 9 + seed) * smooth(0.25, 0.7, side) * smooth(0.12, 0.35, v) * (1 - smooth(0.82, 0.96, v));
        const waist = Math.sin(v * 38 + Math.sin(a * 2) * 2 + seed * 0.7) * smooth(0.72, 0.9, v) * 0.6;
        const chest = Math.sin(u * 23 + v * 5 + seed * 1.3) * 0.18 * smooth(0.45, 0.8, v) * (1 - side);
        const f = diag + waist + chest;
        detail *= 1 + 0.07 * f - 0.16 * Math.pow(Math.max(0, -f), 3);
        // Side seams
        const seam = Math.min(Math.abs(u - 0.25), Math.abs(u - 0.75)) * 6.3 * 0.19;
        if (seam < 0.0045) detail *= 0.72;
        else if (seam < 0.009) detail *= 1.06;
        // Hem band and stitching line
        if (v > 0.935 && v < 0.95) detail *= 0.72;
        else if (v >= 0.95) detail *= 0.93;
        // Collar: V-neck at the front, ribbed band all round.
        const xf = Math.abs(Math.sin(a));
        const vDepth = (0.13 - v) * 2.3;
        if (front > 0 && v < 0.13 && xf < vDepth - 0.035) region = 'skin';
        else if (front > 0 && v < 0.13 && xf < vDepth) detail *= 0.78 + 0.05 * Math.sin(v * 400);
        else if (v < 0.045) detail *= 0.8 + 0.06 * Math.sin(u * 900);
        break;
      }
      case 'sleeve': {
        const tt = q.k === 0 ? coneT(q) : 0;
        if (q.k === 0 && tt > 0.84 && tt < 0.88) detail *= 0.72;
        else if (q.k === 0 && tt >= 0.88) detail *= 0.92;
        if (q.k === 1) detail *= 1 + 0.05 * Math.sin(v * 40 + u * 20 + seed);
        else detail *= 1 + 0.05 * Math.sin(tt * 17 + seed);
        break;
      }
      case 'pelvis': {
        if (q.k === 1) {
          const ly = dot(sub(p, q.c), q.ax[1]) / q.rad[1];
          if (ly > 0.5 && ly < 0.58) detail *= 0.74;
          else if (ly >= 0.58) detail *= 0.92;
          detail *= 1 + 0.05 * Math.sin(ly * 14 + dot(sub(p, q.c), q.ax[0]) * 60 + seed);
        }
        break;
      }
      case 'shortsLeg': {
        const c = q as Cone;
        const tt = coneT(c);
        const ang = aroundLimb(c);
        if (tt > 0.86 && tt < 0.9) detail *= 0.74;
        detail *= 1 + 0.07 * Math.sin(tt * 14 + ang * 3 + seed) * (0.5 + 0.5 * Math.abs(Math.cos(ang)));
        if (Math.abs(Math.cos(ang)) > 0.985) detail *= 0.78;
        break;
      }
      case 'sockTop': {
        const c = q as Cone;
        const tt = coneT(c);
        const ang = aroundLimb(c);
        detail *= tt < 0.55 ? 1.05 + 0.04 * Math.sin(ang * 30) : 1 + 0.05 * Math.sin(ang * 26);
        if (tt > 0.55 && tt < 0.63) detail *= 0.74;
        break;
      }
      case 'sock': {
        const ang = aroundLimb(q as Cone);
        detail *= 1 + 0.05 * Math.sin(ang * 26);
        break;
      }
      case 'boot': {
        const c = q as Cone;
        const tt = coneT(c);
        const ax = norm(sub(c.b, c.a));
        const rel = sub(p, c.a);
        const rad = norm(sub(rel, [ax[0] * dot(rel, ax), ax[1] * dot(rel, ax), ax[2] * dot(rel, ax)]));
        const upness = dot(rad, norm(B.up));
        const sideness = Math.abs(dot(rad, norm(B.bodyLeft)));
        const isFoot = len(sub(c.b, c.a)) > 0.1;
        let col: V3 = FIXED.boots!;
        if (isFoot && upness > 0.82 && tt > 0.32 && tt < 0.8) col = Math.sin(tt * 90) > 0 ? [205, 205, 210] : [60, 60, 64];
        else if (isFoot && sideness > 0.72 && Math.abs(upness + 0.1 - (tt - 0.45) * 0.8) < 0.12 && tt > 0.2 && tt < 0.85) col = [235, 235, 238];
        return finish(col, light * (0.9 + 0.5 * Math.pow(Math.max(0, dot(n, L_KEY)), 12)), region, u, v, p[2]);
      }
      case 'sole':
        return finish([118, 118, 122], light, region, u, v, p[2]);
      case 'ball': {
        const dd = norm(sub(p, (q as Ell).c));
        const spots = [[0, 1, 0], [0.89, 0.45, 0], [-0.45, 0.45, 0.78], [-0.45, 0.45, -0.78], [0.28, -0.45, 0.85], [0.28, -0.45, -0.85], [-0.89, -0.45, 0], [0, -1, 0]] as V3[];
        const dark = spots.some((s) => dot(dd, s) > 0.93);
        return finish(dark ? [30, 30, 30] : [240, 240, 240], light, region, u, v, p[2]);
      }
      case 'hair': {
        const strands = 1 + 0.12 * Math.sin(p[0] * 900 + p[1] * 300) * Math.sin(p[2] * 700);
        return finish(palette.hair, light * strands, region, u, v, p[2]);
      }
      default:
        break;
    }

    if (region === 'skin') {
      const c = palette.skin;
      // A touch of warm subsurface in the shadows.
      const l = light * 0.95;
      return finish([c[0] * l + 22 * (1 - l), c[1] * l + 6 * (1 - l), c[2] * l], 1, region, u, v, p[2]);
    }
    const kit = region === 'shirt' || region === 'shorts' || region === 'socks';
    if (kit) {
      const baked = region === 'shirt' ? palette.shirt : region === 'shorts' ? palette.shorts : undefined;
      // Fine fabric grain
      const grain = 1 + 0.015 * Math.sin(p[0] * 2400 + p[1] * 1700) * Math.sin(p[1] * 2100 - p[2] * 1900);
      const g = light * detail * grain;
      if (baked) return finish(baked, g, region, u, v, p[2]);
      const grey = Math.min(255, Math.round(255 * 0.8 * g * 1.02));
      return { hit: true, col: [grey, grey, grey], region, u, v, z: p[2] };
    }
    return finish(FIXED[region] ?? [128, 128, 128], light, region, u, v, p[2]);
  };

  const finish = (c: V3, l: number, region: Region, u: number, v: number, z: number): Sample => ({
    hit: true,
    col: [Math.min(255, c[0] * l), Math.min(255, c[1] * l), Math.min(255, c[2] * l)],
    region,
    u,
    v,
    z,
  });

  // Pass 1: one sample per pixel centre.
  const S: Sample[] = new Array(w * h);
  for (let py = 0; py < h; py++) for (let px = 0; px < w; px++) S[py * w + px] = sample(px + 0.5, py + 0.5);

  const put = (img: ImageData, px: number, py: number, r: number, g: number, b: number, a: number) => {
    const i = ((t.y0 + py) * img.width + (t.x0 + px)) * 4;
    img.data[i] = r;
    img.data[i + 1] = g;
    img.data[i + 2] = b;
    img.data[i + 3] = a;
  };
  const isKit = (r: Region) => r === 'shirt' || r === 'shorts' || r === 'socks';

  // Pass 2: 3x3 supersampling on the silhouette for alpha and edge colour.
  const final: Sample[] = new Array(w * h);
  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      const k = py * w + px;
      const s = S[k];
      let edge = false;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = px + dx, ny = py + dy;
        const o = nx >= 0 && ny >= 0 && nx < w && ny < h ? S[ny * w + nx] : null;
        if (!o || o.hit !== s.hit) edge = true;
      }
      if (!edge) {
        final[k] = s;
        continue;
      }
      const subs: Sample[] = [];
      for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) subs.push(i === 1 && j === 1 ? s : sample(px + (i + 0.5) / 3, py + (j + 0.5) / 3));
      const hits = subs.filter((x) => x.hit);
      if (hits.length < 5) {
        final[k] = { ...s, hit: false };
        continue;
      }
      const ref = s.hit ? s : hits[0];
      const same = hits.filter((x) => x.region === ref.region);
      const col: V3 = [0, 0, 0];
      for (const x of same) for (let c = 0; c < 3; c++) col[c] += x.col[c] / same.length;
      if (isKit(ref.region) && !(ref.region === 'shirt' ? palette.shirt : ref.region === 'shorts' ? palette.shorts : undefined)) col[1] = col[2] = col[0];
      final[k] = { ...ref, col };
    }
  }

  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      const s = final[py * w + px];
      put(t.mask, px, py, 0, 0, 0, 255);
      put(t.uv, px, py, 0, 0, 0, 255);
      if (!s.hit) {
        // 1px outline around the figure for readability on grass.
        let near = false;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = px + dx, ny = py + dy;
          if (nx >= 0 && ny >= 0 && nx < w && ny < h && final[ny * w + nx].hit) near = true;
        }
        put(t.base, px, py, 18, 20, 18, near ? 255 : 0);
        continue;
      }
      put(t.base, px, py, Math.round(s.col[0]), Math.round(s.col[1]), Math.round(s.col[2]), 255);
      if (isKit(s.region)) {
        put(t.mask, px, py, s.region === 'shirt' ? 255 : 0, s.region === 'shorts' ? 255 : 0, s.region === 'socks' ? 255 : 0, 255);
        if (s.region === 'shirt') put(t.uv, px, py, Math.round(s.u * 255), Math.round(s.v * 255), 0, 255);
      }
    }
  }
}

// ------------------------------------------------------------------ poses

const L = (swing: number, bend: number, spread?: number, foot?: number): Limb => ({ swing, bend, spread, foot });

/** Sprint cycle keyframes for one leg: contact, support, toe-off, heel recovery, knee drive, reach. */
const RUN_LEG: Limb[] = [
  L(0.42, 0.32, 0.05, 0.1),
  L(0.02, 0.5, 0.05, 0),
  L(-0.38, 0.4, 0.05, -0.6),
  L(-0.08, 1.8, 0.05, -0.35),
  L(0.72, 1.85, 0.05, -0.2),
  L(0.78, 0.85, 0.05, 0.05),
];
export function poseFor(anim: string, frame: number, _count?: number): Pose {
  switch (anim) {
    case 'idle':
      return frame === 0
        ? { lean: 0.05, headTilt: 0.05, twist: 0.02, armL: L(0.12, 0.35, 0.17), armR: L(0.06, 0.42, 0.16), legL: L(0.1, 0.2, 0.1), legR: L(-0.04, 0.16, 0.1), foldSeed: 0 }
        : { lean: 0.07, headTilt: 0.08, twist: -0.02, sideBend: 0.02, armL: L(0.06, 0.45, 0.16), armR: L(0.12, 0.35, 0.17), legL: L(0.06, 0.24, 0.1), legR: L(-0.02, 0.2, 0.1), foldSeed: 1.3 };
    case 'run': {
      const l = RUN_LEG[frame % 6];
      const r = RUN_LEG[(frame + 3) % 6];
      // Arms drive opposite to the legs with tight ~90 degree elbows.
      return {
        lean: 0.2,
        headTilt: -0.12,
        twist: 0.16 * (r.swing - l.swing),
        armL: L(-0.95 * r.swing + 0.1, 1.6, 0.12),
        armR: L(-0.95 * l.swing + 0.1, 1.6, 0.12),
        legL: r,
        legR: l,
        foldSeed: frame * 0.9,
      };
    }
    case 'kick': {
      const frames: Pose[] = [
        { lean: -0.04, twist: -0.18, headTilt: 0.3, armL: L(0.2, 0.75, 0.3), armR: L(-0.2, 0.8, 0.22), legL: L(0.2, 0.4, 0.06, 0.1), legR: L(-0.3, 2.3, 0.02, -0.5), foldSeed: 2 },
        { lean: 0.14, twist: -0.08, headTilt: 0.4, armL: L(0.15, 0.6, 0.5), armR: L(-0.2, 0.5, 0.35), legL: L(0.12, 0.42, 0.06, 0.05), legR: L(0.28, 0.1, -0.04, -0.75), foldSeed: 2.7 },
        { lean: -0.2, twist: 0.38, headTilt: 0.12, armL: L(-0.2, 1.3, 0.32), armR: L(0.5, 1.3, 0.3), legL: L(-0.1, 0.22, 0.06, -0.45), legR: L(0.95, 1.05, -0.12, -0.5), lift: 0.05, foldSeed: 3.4 },
        { lean: 0.06, twist: 0.12, headTilt: 0.1, armL: L(0.2, 0.5, 0.45), armR: L(0.1, 0.5, 0.4), legL: L(0.0, 0.28, 0.08), legR: L(0.55, 0.95, 0.04, 0), foldSeed: 4.1 },
      ];
      return frames[Math.min(frame, frames.length - 1)];
    }
    case 'jump':
      return frame === 0
        ? { lean: 0.32, headTilt: -0.15, armL: L(-0.75, 0.45, 0.16), armR: L(-0.75, 0.45, 0.16), legL: L(0.65, 1.3, 0.08, -0.25), legR: L(0.6, 1.25, 0.08, -0.25), foldSeed: 5 }
        : { lean: 0.02, headTilt: -0.05, ground: false, armL: L(1.05, 1.85, 0.28), armR: L(1.05, 1.85, 0.28), legL: L(0.35, 0.9, 0.06, -0.6), legR: L(0.22, 1.05, 0.06, -0.6), foldSeed: 5.6 };
    case 'celebrate':
      return frame === 0
        ? { lean: -0.16, headTilt: -0.35, armL: L(2.78, 0.25, 0.5), armR: L(2.78, 0.25, 0.5), legL: L(0.08, 0.12, 0.12), legR: L(-0.08, 0.14, 0.12), foldSeed: 6 }
        : { lean: -0.06, headTilt: -0.2, twist: 0.2, armL: L(2.95, 0.12, 0.32), armR: L(0.85, 2.1, 0.3), legL: L(0.75, 1.35, 0.06, -0.3), legR: L(-0.05, 0.15, 0.08), foldSeed: 6.8 };
    case 'hold':
      return { lean: 0.08, headTilt: 0.18, ball: true, armL: L(0.72, 1.5, -0.28), armR: L(0.72, 1.5, -0.28), legL: L(0.06, 0.16, 0.1), legR: L(-0.03, 0.14, 0.1), foldSeed: 7 };
    case 'dive_left':
    case 'dive_right': {
      const dir = anim === 'dive_left' ? 1 : -1;
      const frames = [
        { roll: 0.42, rootY: -0.12, lean: 0.1, ground: true, up: L(1.7, 0.3, 0.55), legs: [L(0.35, 1.1, 0.05, -0.3), L(0.45, 0.8, 0.1)] },
        { roll: 1.3, rootY: 0.05, lean: 0.05, ground: false, up: L(2.98, 0.04, 0.1), legs: [L(0.12, 0.15, 0.04, -0.6), L(-0.1, 0.25, 0.04, -0.6)] },
        { roll: 1.53, rootY: 0, lean: 0, ground: true, up: L(2.95, 0.1, 0.1), legs: [L(0.2, 0.45, 0.04, -0.4), L(0.4, 0.85, 0.04, -0.4)] },
      ];
      const f = frames[Math.min(frame, 2)];
      return {
        roll: dir * f.roll,
        rootY: f.rootY,
        rootX: dir * 0.2,
        lean: f.lean,
        ground: f.ground,
        headTilt: -0.1,
        armL: f.up,
        armR: f.up,
        legL: dir > 0 ? f.legs[0] : f.legs[1],
        legR: dir > 0 ? f.legs[1] : f.legs[0],
        foldSeed: 8 + frame,
      };
    }
    default:
      return poseFor('idle', 0, 1);
  }
}
