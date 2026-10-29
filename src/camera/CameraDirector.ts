import { PerspectiveCamera, Vector3 } from 'three';
import { clamp, DEG, lerp } from '../core/math';

export type ReplayAngle = 'behind-goal' | 'side' | 'keeper' | 'kicker' | 'aerial' | 'tv';
export const REPLAY_ANGLES: ReplayAngle[] = ['behind-goal', 'side', 'keeper', 'kicker', 'aerial', 'tv'];
export const ANGLE_NAMES: Record<ReplayAngle, string> = {
  'behind-goal': 'Behind goal',
  side: 'Side on',
  keeper: "Keeper's view",
  kicker: "Kicker's view",
  aerial: 'Aerial',
  tv: 'TV camera',
};

const GOAL = new Vector3(0, 1, 0);

/**
 * Camera control. 'broadcast' is the gameplay view (high, behind and to the side of the
 * kicker), 'preset' plays scripted replay angles, and both accept user orbit (drag) and zoom (pinch).
 */
export class CameraDirector {
  readonly camera: PerspectiveCamera;
  mode: 'broadcast' | 'preset' | 'free' = 'broadcast';
  angle: ReplayAngle = 'behind-goal';
  /** User orbit offsets applied on top of the current mode. */
  yawOffset = 0;
  pitchOffset = 0;
  zoom = 1;

  private ballStart = new Vector3(0, 0, 20);
  private target = new Vector3();
  private pos = new Vector3();
  private smoothTarget = new Vector3();
  private smoothPos = new Vector3();
  private snap = true;

  constructor(aspect: number) {
    this.camera = new PerspectiveCamera(42, aspect, 0.1, 900);
  }

  setFreeKick(ballStart: Vector3) {
    this.ballStart.copy(ballStart);
    this.mode = 'broadcast';
    this.resetOrbit();
    this.snap = true;
  }

  resetOrbit() {
    this.yawOffset = 0;
    this.pitchOffset = 0;
    this.zoom = 1;
  }

  orbit(dx: number, dy: number) {
    this.yawOffset -= dx * 0.008;
    this.pitchOffset = clamp(this.pitchOffset + dy * 0.006, -0.5, 0.9);
  }

  pinch(scale: number) {
    this.zoom = clamp(this.zoom / scale, 0.35, 2.2);
  }

  setPreset(angle: ReplayAngle) {
    this.mode = 'preset';
    this.angle = angle;
    this.resetOrbit();
    this.snap = true;
  }

  /** Base camera for the free kick, before user orbit. */
  private broadcast(ball: Vector3, live: boolean) {
    const b = this.ballStart;
    const back = new Vector3(b.x, 0, b.z).normalize();
    const dist = Math.hypot(b.x, b.z);
    // Look at a point between ball and goal; follow the ball loosely once it is in play.
    const focus = new Vector3().lerpVectors(new Vector3(b.x, 0, b.z), GOAL, 0.5);
    if (live) focus.lerp(ball, 0.3);
    this.target.copy(focus);
    // High and to the right of the kicker, so the goal sits top-right like the classic arcade view.
    const yaw = Math.atan2(back.x, back.z) + 30 * DEG;
    const horiz = 11 + dist * 0.22;
    this.pos.set(b.x + Math.sin(yaw) * horiz, 9.5 + dist * 0.15, b.z + Math.cos(yaw) * horiz);
  }

  private preset(ball: Vector3, keeper: Vector3) {
    const b = this.ballStart;
    switch (this.angle) {
      case 'behind-goal':
        this.pos.set(clamp(-b.x * 0.15, -3, 3), 2.6, -3.9);
        this.target.copy(ball).lerp(GOAL, 0.15);
        break;
      case 'side': {
        const sx = b.x > 0 ? -1 : 1;
        this.pos.set(sx * 30, 6, b.z * 0.45);
        this.target.set(ball.x * 0.6, 1, ball.z * 0.8 + b.z * 0.1);
        break;
      }
      case 'keeper':
        this.pos.set(keeper.x * 0.7, 1.75, -1.6);
        this.target.copy(ball);
        break;
      case 'kicker': {
        const back = new Vector3(b.x, 0, b.z).normalize();
        this.pos.copy(b).addScaledVector(back, 4.5).setY(1.7);
        this.target.copy(ball).lerp(GOAL, 0.3);
        break;
      }
      case 'aerial':
        this.pos.set(ball.x * 0.5, 34, ball.z * 0.5 + 14);
        this.target.set(ball.x * 0.7, 0, ball.z * 0.7);
        break;
      case 'tv':
        this.broadcast(ball, true);
        break;
    }
  }

  update(dt: number, ball: Vector3, keeper: Vector3, live: boolean) {
    if (this.mode === 'broadcast') this.broadcast(ball, live);
    else this.preset(ball, keeper);

    // Apply orbit + zoom around the target.
    const off = this.pos.clone().sub(this.target);
    const r = off.length() * this.zoom;
    let yaw = Math.atan2(off.x, off.z) + this.yawOffset;
    const pitch = clamp(Math.asin(clamp(off.y / off.length(), -1, 1)) + this.pitchOffset, 0.03, 1.45);
    if (!Number.isFinite(yaw)) yaw = 0;
    const p = new Vector3(Math.sin(yaw) * Math.cos(pitch) * r, Math.sin(pitch) * r, Math.cos(yaw) * Math.cos(pitch) * r).add(this.target);
    p.y = Math.max(p.y, 0.4);

    if (this.snap) {
      this.smoothPos.copy(p);
      this.smoothTarget.copy(this.target);
      this.snap = false;
    } else {
      const k = 1 - Math.exp(-dt * (this.mode === 'preset' ? 9 : 4));
      this.smoothPos.lerp(p, k);
      this.smoothTarget.lerp(this.target, 1 - Math.exp(-dt * 7));
    }
    this.camera.position.copy(this.smoothPos);
    this.camera.lookAt(this.smoothTarget);
  }

  /** Camera yaw (for rotating the wind gauge relative to the view). */
  get viewYaw(): number {
    const d = new Vector3();
    this.camera.getWorldDirection(d);
    return Math.atan2(d.x, d.z);
  }

  resize(aspect: number) {
    this.camera.aspect = aspect;
    // Keep a similar horizontal field of view on narrow screens.
    this.camera.fov = aspect < 1.5 ? lerp(52, 42, clamp((aspect - 1) / 0.5, 0, 1)) : 42;
    this.camera.updateProjectionMatrix();
  }
}
