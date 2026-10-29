import { Vector3 } from 'three';
import { DEG, lerp } from '../core/math';

/** Player's three bar settings. */
export interface ShotInput {
  /** 0 = along the ground, 1 = maximum loft. */
  height: number;
  /** 0 = far left of the goal, 1 = far right (from the kicker's view). */
  direction: number;
  /** -1 = curl hard left, 0 = straight, +1 = curl hard right. */
  swerve: number;
}

export const KICK = {
  minElevation: 2 * DEG,
  maxElevation: 30 * DEG,
  aimHalfWidth: 6.8,
  maxSpin: 48,
  /** Topspin added with loft so lofted shots dip over the wall like a real free kick. */
  maxTopspin: 34,
} as const;

/**
 * Turn bar values into launch velocity and spin. The aim point is on the goal line, so
 * a centred direction bar always points at the middle of the goal whatever the angle.
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
  spin.addScaledVector(right, -KICK.maxTopspin * shot.height);
  return { vel, spin };
}
