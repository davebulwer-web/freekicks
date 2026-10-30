import { PITCH } from './rules';

/**
 * Pitch surface field for wet and snowy weather. The placeholder overlay textures
 * (textures/pitch_wet.png, textures/pitch_snow.png) are generated from these functions and
 * cover SURFACE_EXTENT exactly. In-game physics reads puddle depth from the loaded texture's
 * alpha, so replacement art drives the physics too. These functions are the fallback.
 */
export const SURFACE_EXTENT = {
  x0: -PITCH.width / 2 - 6,
  x1: PITCH.width / 2 + 6,
  z0: -6,
  z1: PITCH.length + 6,
} as const;

/** Water deeper than this (texture alpha 0..1) is a puddle that slows the ball. */
export const PUDDLE_THRESHOLD = 0.25;

function hash(ix: number, iz: number, seed: number): number {
  let h = (ix * 374761393 + iz * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function valueNoise(x: number, z: number, seed: number): number {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = x - ix, fz = z - iz;
  const sx = fx * fx * (3 - 2 * fx), sz = fz * fz * (3 - 2 * fz);
  const a = hash(ix, iz, seed), b = hash(ix + 1, iz, seed);
  const c = hash(ix, iz + 1, seed), d = hash(ix + 1, iz + 1, seed);
  return a + (b - a) * sx + (c - a) * sz + (a - b - c + d) * sx * sz;
}

export function fbm(x: number, z: number, seed: number, octaves = 4): number {
  let v = 0, amp = 0.5, f = 1, norm = 0;
  for (let i = 0; i < octaves; i++) {
    v += valueNoise(x * f, z * f, seed + i * 17) * amp;
    norm += amp;
    amp *= 0.5;
    f *= 2.03;
  }
  return v / norm;
}

const g = (x: number, z: number, cx: number, cz: number, rx: number, rz: number) =>
  Math.exp(-(((x - cx) / rx) ** 2 + ((z - cz) / rz) ** 2));

/** 0..1: how worn/trampled the turf is (goalmouths, penalty spots, centre circle). */
export function wear(x: number, z: number): number {
  const L = PITCH.length;
  let w = 0;
  for (const end of [0, L]) {
    const zz = end === 0 ? z : L - z;
    w = Math.max(w, g(x, zz, 0, 2.5, 6, 3.5), g(x, zz, 0, PITCH.penaltySpot, 3, 2.5) * 0.8, g(x, zz, 0, 13, 12, 5) * 0.45);
  }
  w = Math.max(w, g(x, z, 0, L / 2, 9, 9) * 0.6);
  return Math.min(1, w);
}

/** Standing water depth 0..1 at a point on the pitch (rain). */
export function puddleDepth(x: number, z: number): number {
  const n = fbm(x / 5.5, z / 5.5, 11);
  const fine = fbm(x / 1.4, z / 1.4, 23);
  const v = n * 0.75 + fine * 0.25 + wear(x, z) * 0.32 - 0.66;
  return Math.max(0, Math.min(1, v * 4.2));
}

/** Snow cover 0..1 (thin layer: always well below 1 so the turf shows through). */
export function snowCover(x: number, z: number): number {
  const n = fbm(x / 7, z / 7, 31);
  const fine = fbm(x / 0.9, z / 0.9, 37);
  const v = 0.66 + (n - 0.5) * 0.35 + (fine - 0.5) * 0.18 - wear(x, z) * 0.38;
  return Math.max(0.18, Math.min(0.82, v));
}

/** Build a puddle sampler from an RGBA overlay's alpha channel covering SURFACE_EXTENT. */
export function puddleSampler(alpha: Uint8ClampedArray | Uint8Array, w: number, h: number, stride = 4): (x: number, z: number) => number {
  const E = SURFACE_EXTENT;
  return (x, z) => {
    const u = (x - E.x0) / (E.x1 - E.x0);
    const v = (z - E.z0) / (E.z1 - E.z0);
    if (u < 0 || u >= 1 || v < 0 || v >= 1) return 0;
    const i = (Math.floor(v * h) * w + Math.floor(u * w)) * stride + (stride - 1);
    return alpha[i] / 255;
  };
}
