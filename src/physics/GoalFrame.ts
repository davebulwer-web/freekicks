import { Vector3 } from 'three';
import { HALF_GOAL, PITCH } from '../config/rules';
import { closestPointOnSegment } from '../core/math';
import { BALL_RADIUS, Ball } from './Ball';

/** Goal at z = 0 (centre x = 0). Posts sit on the goal line, which runs from z = 0 to z = -lineWidth. */
const R = PITCH.postRadius;
const LINE = PITCH.lineWidth;
export const POST_X = HALF_GOAL + R;
export const POST_Z = -LINE / 2;
export const BAR_Y = PITCH.goalHeight + R;
export const NET_BACK_Z = -PITCH.goalDepth;
/** Ball is fully over the line once its centre passes this z. */
export const GOAL_LINE_CROSSED_Z = -LINE - BALL_RADIUS;

export type FrameHit = 'post' | 'bar' | null;

const segs: { a: Vector3; b: Vector3; kind: 'post' | 'bar' }[] = [
  { a: new Vector3(-POST_X, 0, POST_Z), b: new Vector3(-POST_X, BAR_Y, POST_Z), kind: 'post' },
  { a: new Vector3(POST_X, 0, POST_Z), b: new Vector3(POST_X, BAR_Y, POST_Z), kind: 'post' },
  { a: new Vector3(-POST_X, BAR_Y, POST_Z), b: new Vector3(POST_X, BAR_Y, POST_Z), kind: 'bar' },
];

const cp = new Vector3();
const n = new Vector3();

/** Resolve ball against posts and crossbar. */
export function collideFrame(ball: Ball): FrameHit {
  for (const s of segs) {
    closestPointOnSegment(ball.pos, s.a, s.b, cp);
    n.subVectors(ball.pos, cp);
    const d = n.length();
    const minD = BALL_RADIUS + R;
    if (d < minD && d > 1e-6) {
      n.divideScalar(d);
      ball.pos.copy(cp).addScaledVector(n, minD + 1e-3);
      const vn = ball.vel.dot(n);
      if (vn < 0) {
        ball.vel.addScaledVector(n, -(1 + 0.62) * vn);
        ball.vel.multiplyScalar(0.92);
        ball.spin.multiplyScalar(0.4);
        return s.kind;
      }
    }
  }
  return null;
}

/** True if (x, y) lies inside the goal mouth (ball fully between the posts and under the bar). */
export function inMouth(x: number, y: number, margin = 0): boolean {
  return Math.abs(x) < HALF_GOAL - margin && y < PITCH.goalHeight - margin;
}

/**
 * Keep a ball that has entered the goal inside the net, damping it like netting does.
 * Returns the impact point when the ball hits the netting this step (for ripples/sfx).
 */
export function confineToNet(ball: Ball): Vector3 | null {
  const { pos, vel } = ball;
  let hit = false;
  const maxX = HALF_GOAL - BALL_RADIUS;
  const maxY = PITCH.goalHeight - BALL_RADIUS;
  const minZ = NET_BACK_Z + BALL_RADIUS;
  if (pos.z < minZ) {
    pos.z = minZ;
    if (vel.z < 0) { vel.z = -vel.z * 0.12; hit = true; }
  }
  if (Math.abs(pos.x) > maxX) {
    pos.x = Math.sign(pos.x) * maxX;
    if (Math.sign(vel.x) === Math.sign(pos.x)) { vel.x = -vel.x * 0.12; hit = true; }
  }
  if (pos.y > maxY) {
    pos.y = maxY;
    if (vel.y > 0) { vel.y = -vel.y * 0.1; hit = true; }
  }
  if (pos.z > -LINE - BALL_RADIUS && vel.z > 0) {
    // Can't come back out through the mouth once it's in (it would be a goal anyway).
    pos.z = -LINE - BALL_RADIUS;
    vel.z *= -0.2;
  }
  if (hit) {
    vel.multiplyScalar(0.45);
    ball.spin.multiplyScalar(0.2);
    return pos.clone();
  }
  return null;
}

/** Ball striking the outside of the net (side netting / roof) from outside the goal. */
export function collideOuterNet(ball: Ball): boolean {
  const { pos, vel } = ball;
  if (pos.z > 0 || pos.z < NET_BACK_Z - BALL_RADIUS) return false;
  const outerX = POST_X + BALL_RADIUS;
  const topY = BAR_Y + BALL_RADIUS;
  if (Math.abs(pos.x) < outerX && pos.y < topY) {
    // Inside the volume from outside: push out through the nearest face.
    const dx = outerX - Math.abs(pos.x);
    const dy = topY - pos.y;
    const dz = pos.z - (NET_BACK_Z - BALL_RADIUS);
    const m = Math.min(dx, dy, dz);
    if (m === dx) { pos.x = Math.sign(pos.x || 1) * outerX; vel.x *= -0.15; }
    else if (m === dy) { pos.y = topY; vel.y = Math.abs(vel.y) * 0.15; }
    else { pos.z = NET_BACK_Z - BALL_RADIUS; vel.z *= -0.15; }
    vel.multiplyScalar(0.5);
    return true;
  }
  return false;
}
