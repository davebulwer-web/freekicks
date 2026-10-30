import { Quaternion, Vector3 } from 'three';
import { PUDDLE_THRESHOLD } from '../config/surface';
import type { WeatherKind } from '../config/types';

export const BALL_RADIUS = 0.11;
export const GRAVITY = 9.81;

/** Air drag per metre: 0.5 * rho * Cd * A / m  (rho 1.2, Cd 0.25, A 0.038 m^2, m 0.43 kg). */
export const DRAG_K = 0.0133;
/** Magnus acceleration factor applied to (spin x velocity). Tuned for arcade-strength curl. */
export const MAGNUS_K = 0.0042;
/** Wind is exaggerated relative to reality so it is a meaningful gameplay factor. */
export const WIND_FACTOR = 1.6;

export interface Surface {
  restitution: number;
  /** Horizontal speed retained on each bounce. */
  bounceFriction: number;
  /** Rolling resistance coefficient (deceleration = mu * g). */
  rollMu: number;
}

export const SURFACES: Record<WeatherKind, Surface> = {
  clear: { restitution: 0.58, bounceFriction: 0.82, rollMu: 0.06 },
  rain: { restitution: 0.45, bounceFriction: 0.93, rollMu: 0.035 },
  snow: { restitution: 0.3, bounceFriction: 0.6, rollMu: 0.16 },
};

export interface BallEnv {
  wind: Vector3;
  surface: Surface;
  /** Standing water depth 0..1 at a pitch position (wet weather only). */
  puddleAt?: (x: number, z: number) => number;
}

/** Extra deceleration (m/s^2) per unit of water depth while rolling through a puddle. */
const PUDDLE_DRAG = 7;

const tmpRel = new Vector3();
const tmpMag = new Vector3();
const tmpAxis = new Vector3();
const tmpQ = new Quaternion();
const UP = new Vector3(0, 1, 0);

export class Ball {
  pos = new Vector3(0, BALL_RADIUS, 0);
  vel = new Vector3();
  /** Angular velocity, rad/s (world axes). */
  spin = new Vector3();
  /** Visual orientation. */
  rot = new Quaternion();
  onGround = true;

  copyFrom(b: Ball): this {
    this.pos.copy(b.pos);
    this.vel.copy(b.vel);
    this.spin.copy(b.spin);
    this.rot.copy(b.rot);
    this.onGround = b.onGround;
    return this;
  }

  /** Integrate one step of flight/bounce/roll. Returns true if the ball bounced on the ground this step. */
  step(dt: number, env: BallEnv): boolean {
    const { vel, spin, pos } = this;
    let bounced = false;

    // Aerodynamics relative to the moving air.
    tmpRel.copy(vel).addScaledVector(env.wind, -WIND_FACTOR);
    const speed = tmpRel.length();
    const airborne = pos.y > BALL_RADIUS + 0.01;
    vel.addScaledVector(tmpRel, -DRAG_K * speed * dt);
    tmpMag.crossVectors(spin, vel).multiplyScalar(MAGNUS_K * (airborne ? 1 : 0.15));
    vel.addScaledVector(tmpMag, dt);
    if (airborne || vel.y > 0) vel.y -= GRAVITY * dt;

    pos.addScaledVector(vel, dt);
    spin.multiplyScalar(Math.exp(-(airborne ? 0.12 : 1.5) * dt));

    const water = env.puddleAt && pos.y < BALL_RADIUS + 0.05 ? env.puddleAt(pos.x, pos.z) : 0;
    const wet = water > PUDDLE_THRESHOLD ? water : 0;
    if (pos.y < BALL_RADIUS) {
      pos.y = BALL_RADIUS;
      if (vel.y < -0.6) {
        // A puddle soaks up the bounce and grabs the ball.
        vel.y = -vel.y * env.surface.restitution * (1 - 0.55 * wet);
        vel.x *= env.surface.bounceFriction * (1 - 0.3 * wet);
        vel.z *= env.surface.bounceFriction * (1 - 0.3 * wet);
        spin.multiplyScalar(0.6);
        bounced = true;
      } else {
        vel.y = 0;
      }
    }

    this.onGround = pos.y <= BALL_RADIUS + 0.005 && Math.abs(vel.y) < 0.01;
    if (this.onGround) {
      const h = Math.hypot(vel.x, vel.z);
      if (h > 0) {
        const dec = (env.surface.rollMu * GRAVITY + PUDDLE_DRAG * wet) * dt;
        const k = Math.max(0, h - dec) / h;
        vel.x *= k;
        vel.z *= k;
      }
      // Rolling rotation: omega = up x v / r
      tmpAxis.crossVectors(UP, vel).divideScalar(BALL_RADIUS);
      this.integrateRotation(tmpAxis, dt);
    } else {
      this.integrateRotation(spin, dt);
    }
    return bounced;
  }

  private integrateRotation(omega: Vector3, dt: number) {
    const w = omega.length();
    if (w < 1e-4) return;
    tmpQ.setFromAxisAngle(tmpAxis.copy(omega).divideScalar(w), w * dt);
    this.rot.premultiply(tmpQ).normalize();
  }

  get speed(): number {
    return this.vel.length();
  }
}
