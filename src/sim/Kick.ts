import { Vector3 } from 'three';
import { DEG, lerp } from '../core/math';

/** Player's four ring settings. */
export interface ShotInput {
  /** 0 = along the ground, 1 = maximum loft. */
  height: number;
  /** 0 = far left of the goal, 1 = far right (from the kicker's view). */
  direction: number;
  /** -1 = curl hard left, 0 = straight, +1 = curl hard right. */
  swerve: number;
  /** -1 = backspin (floats and carries), 0 = no spin, +1 = heavy topspin (dips sharply). */
  dip: number;
}

export const KICK = {
  minElevation: 2 * DEG,
  maxElevation: 30 * DEG,
  aimHalfWidth: 6.8,
  maxSpin: 48,
  /** Topspin at full dip: the ball dives down over the wall like a real free kick. */
  maxTopspin: 44,
  /** Backspin at full float (weaker: a ball can't float as much as it can dip). */
  maxBackspin: 26,
} as const;

/**
 * Turn ring values into launch velocity and spin. The aim point is on the goal line, so
 * a centred direction value always points at the middle of the goal whatever the angle.
 */
export function computeKick(ballPos: Vector3, shot: ShotInput): { vel: Vector3; spin: Vector3 } {
  const dist = Math.hypot(ballPos.x, ballPos.z);
  // Kicker faces the goal; "right" is perpendicular to that line.
  const fwd = new Vector3(-ballPos.x, 0, -ballPos.z).normalize();
  const right = new Vector3(-fwd.z, 0, fwd.x);
  const offset = lerp(-KICK.aimHalfWidth, KICK.aimHalfWidth, shot.direction);
  const target = new Vector3(0, 0, 0).addScaledVector(right, offset);
  const aim = target.sub(ballPos).setY(0).normalize();

  const elev = lerp(KICK.minElevation, KICK.maxElevation, shot.height);
  const speed = 23 + 0.22 * Math.max(0, dist - 18);
  const vel = aim.multiplyScalar(Math.cos(elev) * speed).setY(Math.sin(elev) * speed);
  // spin about +y curls the ball towards -right; so negate for "positive = right".
  const spin = new Vector3(0, -shot.swerve * KICK.maxSpin, 0);
  // Topspin axis is the kicker's right; negative gives a downward Magnus force.
  const top = shot.dip >= 0 ? shot.dip * KICK.maxTopspin : shot.dip * KICK.maxBackspin;
  spin.addScaledVector(right, -top);
  return { vel, spin };
}
