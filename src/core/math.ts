import { Vector3 } from 'three';

export const DEG = Math.PI / 180;

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const smoothstep = (t: number) => t * t * (3 - 2 * t);

/** Wrap an angle to [-PI, PI]. */
export function wrapAngle(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

/** Heading convention: facing vector = (sin h, 0, cos h). */
export function headingTo(from: Vector3, to: Vector3): number {
  return Math.atan2(to.x - from.x, to.z - from.z);
}

export function turnTowards(current: number, target: number, maxStep: number): number {
  const d = wrapAngle(target - current);
  return current + clamp(d, -maxStep, maxStep);
}

/** Closest point on segment ab to p, written into out. */
export function closestPointOnSegment(p: Vector3, a: Vector3, b: Vector3, out: Vector3): Vector3 {
  const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z;
  const len2 = abx * abx + aby * aby + abz * abz;
  let t = len2 > 0 ? ((p.x - a.x) * abx + (p.y - a.y) * aby + (p.z - a.z) * abz) / len2 : 0;
  t = clamp(t, 0, 1);
  return out.set(a.x + abx * t, a.y + aby * t, a.z + abz * t);
}
