import { Vector3 } from 'three';
import { HALF_GOAL, PITCH, RULES } from '../config/rules';
import { PUDDLE_THRESHOLD, puddleDepth } from '../config/surface';
import { targetAt } from '../config/stages';
import type { StageSetup } from '../config/types';
import { EventBus } from '../core/EventBus';
import { Rng } from '../core/Rng';
import { DEG, clamp, closestPointOnSegment, headingTo, lerp, turnTowards } from '../core/math';
import { BALL_RADIUS, Ball, GRAVITY, SURFACES, type BallEnv } from '../physics/Ball';
import { GOAL_LINE_CROSSED_Z, collideFrame, collideOuterNet, confineToNet, inMouth } from '../physics/GoalFrame';
import { computeKick, type ShotInput } from './Kick';
import { Person, type Role } from './Person';

export type OutcomeKind = 'goal' | 'saved' | 'wide' | 'over' | 'post' | 'bar' | 'blocked' | 'cleared' | 'out' | 'timeout' | 'nobend';

export interface Outcome {
  kind: OutcomeKind;
  goal: boolean;
  /** Goal scored by the AI follow-up shot rather than the free kick itself. */
  rebound: boolean;
  /** Where the ball crossed the goal line (x across goal, y height). */
  crossing?: { x: number; y: number };
  message: string;
  time: number;
}

export interface MatchEvents {
  kick: { pos: Vector3; speed: number; by: Role };
  bounce: { pos: Vector3; speed: number };
  frame: { kind: 'post' | 'bar'; pos: Vector3; speed: number };
  net: { pos: Vector3; speed: number };
  touch: { role: Role; pos: Vector3; kind: 'block' | 'save' | 'catch' | 'clear' | 'shot' };
  outcome: Outcome;
  splash: { pos: Vector3; speed: number };
}

type BallState = 'dead' | 'flight' | 'loose' | 'held' | 'net' | 'cleared';
type TouchKind = 'none' | 'wall' | 'defender' | 'attacker' | 'keeper' | 'post' | 'bar';

export const SIM_DT = 1 / 120;

/** Seconds for a diving keeper to drop from full stretch to lying on the ground. */
const KEEPER_FALL_TIME = 0.12;
/** Hands below this height mean the keeper is (visually and physically) on the ground. */
const KEEPER_LOW = 0.65;
/** Body capsule radius while lying on the ground. */
const KEEPER_LYING_RADIUS = 0.22;

const tmpA = new Vector3();
const tmpB = new Vector3();
const tmpC = new Vector3();
const tmpN = new Vector3();

/**
 * Renderer-independent simulation of one free kick, from run-up to the end of live play.
 * All positions are metres, goal line at z = 0 with the pitch towards +z.
 */
export class Match {
  readonly events = new EventBus<MatchEvents>();
  readonly rng: Rng;
  readonly ball = new Ball();
  readonly people: Person[] = [];
  readonly env: BallEnv;
  readonly ballStart = new Vector3();
  readonly toGoal = new Vector3();
  readonly right = new Vector3();

  time = 0;
  phase: 'ready' | 'runup' | 'live' | 'done' = 'ready';
  ballState: BallState = 'dead';
  outcome: Outcome | null = null;
  kickTime = 0;
  shot: ShotInput | null = null;
  /** Last ball crossing of the goal-line plane. */
  crossing: { x: number; y: number; inMouth: boolean } | null = null;
  lastTouch: TouchKind = 'none';
  /** Target Challenge: board the ball went through, and when. */
  targetHit: { index: number; time: number } | null = null;
  attackerShotUsed = false;
  keeper!: Person;
  kicker!: Person;
  /** Latest net impact (for ripple rendering), cleared by the renderer. */
  netImpact: { pos: Vector3; strength: number; time: number } | null = null;

  private contactPoint = new Vector3();
  private wallSide = 1;

  private inPuddle = false;

  constructor(
    readonly setup: StageSetup,
    opts: { puddleAt?: (x: number, z: number) => number } = {},
  ) {
    this.rng = new Rng(setup.seed ^ 0x9e3779b9);
    this.env = {
      wind: new Vector3(setup.wind.x, 0, setup.wind.z),
      surface: SURFACES[setup.weather],
      puddleAt: setup.weather === 'rain' ? (opts.puddleAt ?? puddleDepth) : undefined,
    };
    this.ballStart.set(setup.ballPos.x, BALL_RADIUS, setup.ballPos.z);
    this.ball.pos.copy(this.ballStart);
    this.toGoal.set(-setup.ballPos.x, 0, -setup.ballPos.z).normalize();
    this.right.set(-this.toGoal.z, 0, this.toGoal.x);
    this.placePeople();
  }

  // ---------------------------------------------------------------- setup

  private add(role: Role, pos: Vector3): Person {
    const side = role === 'referee' ? 'ref' : role === 'kicker' || role === 'attacker' ? 'attack' : 'defence';
    const p = new Person(this.people.length, role, side);
    p.pos.copy(pos).setY(0);
    p.home.copy(p.pos);
    p.heading = headingTo(p.pos, this.ball.pos);
    this.people.push(p);
    return p;
  }

  private placePeople() {
    const { ball, toGoal, right, setup, rng } = this;
    const b = ball.pos;

    this.kicker = this.add('kicker', b.clone().addScaledVector(toGoal, -2.8).addScaledVector(right, -1.5));
    this.contactPoint.copy(b).addScaledVector(toGoal, -0.32).addScaledVector(right, -0.16).setY(0);
    // Dummy runner next to the ball, like a real set piece.
    this.add('attacker', b.clone().addScaledVector(toGoal, -1.2).addScaledVector(right, -3.6));

    // Wall: first man on the line to the near post, the rest stepping towards the middle.
    this.wallSide = Math.abs(b.x) > 1 ? Math.sign(b.x) : rng.chance(0.5) ? 1 : -1;
    const nearPost = new Vector3(this.wallSide * (HALF_GOAL + 0.35), 0, 0);
    const first = b.clone().setY(0).add(nearPost.sub(b.clone().setY(0)).setY(0).normalize().multiplyScalar(RULES.wallDistance));
    const inward = right.clone().multiplyScalar(right.x * -this.wallSide >= 0 ? 1 : -1);
    for (let i = 0; i < setup.wallSize; i++) {
      const w = this.add('wall', first.clone().addScaledVector(inward, i * 0.56));
      w.radius = 0.26;
    }

    // Players in the box: attackers looking for rebounds, defenders marking them goal-side.
    const slots = [
      new Vector3(-3.2, 0, 8.5),
      new Vector3(3.4, 0, 9.5),
      new Vector3(0.4, 0, 12.5),
      new Vector3(-6.5, 0, 11),
    ];
    for (let i = 0; i < setup.attackers; i++) {
      const s = slots[i].clone();
      s.x += rng.range(-0.8, 0.8);
      this.add('attacker', s);
    }
    for (let i = 0; i < setup.markers; i++) {
      const s = slots[i % slots.length].clone();
      s.x += rng.range(-0.6, 0.6) + 0.5;
      s.z -= 1.4;
      this.add('defender', s);
    }

    // Keeper: on the ball-to-centre line, shaded towards the side the wall doesn't cover.
    const kz = 0.7;
    const kx = clamp((b.x * kz) / b.z - this.wallSide * 0.55, -2, 2);
    this.keeper = this.add('keeper', new Vector3(kx, 0, kz));
    this.keeper.radius = 0.32;
    this.keeper.ai.mode = 'set';

    const refPos = b.clone().addScaledVector(toGoal, 4).addScaledVector(right, -this.wallSide * 7 * Math.sign(right.x || 1));
    refPos.x = clamp(refPos.x, -PITCH.width / 2 + 1, PITCH.width / 2 - 1);
    refPos.z = Math.max(refPos.z, PITCH.penaltyAreaDepth + 2);
    this.add('referee', refPos);
  }

  // ---------------------------------------------------------------- control

  /** Begin the run-up with the locked ring values. */
  takeKick(shot: ShotInput) {
    if (this.phase !== 'ready') return;
    this.shot = shot;
    this.phase = 'runup';
    this.kicker.setAnim('run');
  }

  get finished(): boolean {
    return this.phase === 'done';
  }

  // ---------------------------------------------------------------- simulation

  step(dt = SIM_DT) {
    if (this.phase === 'done') return;
    this.time += dt;

    if (this.phase === 'runup') this.updateRunUp(dt);
    if (this.phase === 'live') {
      this.updateBall(dt);
      this.updateKeeper(dt);
      this.syncKeeperPose(this.keeper);
      this.updateOutfield(dt);
      if (!this.outcome && this.time - this.kickTime > RULES.playTimeout) {
        this.setOutcome('timeout', 'NO GOAL');
      }
      if (this.outcome && this.time - this.outcome.time > RULES.postOutcomeTime) this.phase = 'done';
    } else {
      this.idleBehaviour(dt);
    }
    for (const p of this.people) this.integratePerson(p, dt);
  }

  private updateRunUp(dt: number) {
    const k = this.kicker;
    tmpA.subVectors(this.contactPoint, k.pos).setY(0);
    const d = tmpA.length();
    const step = 4.4 * dt;
    if (d <= step) {
      k.pos.copy(this.contactPoint);
      k.vel.set(0, 0, 0);
      this.strike();
    } else {
      k.vel.copy(tmpA).multiplyScalar(4.4 / d);
      k.heading = turnTowards(k.heading, headingTo(k.pos, this.ball.pos), 6 * dt);
    }
  }

  private strike() {
    const shot = this.shot!;
    const { vel, spin } = computeKick(this.ball.pos, shot);
    this.ball.vel.copy(vel);
    this.ball.spin.copy(spin);
    this.kicker.setAnim('kick');
    this.kicker.touchCooldown = 0.6;
    this.kicker.heading = Math.atan2(vel.x, vel.z);
    this.phase = 'live';
    this.ballState = 'flight';
    this.kickTime = this.time;
    this.events.emit('kick', { pos: this.ball.pos.clone(), speed: vel.length(), by: 'kicker' });

    // Wall jumps if the ball looks like it'll be at head height when it arrives.
    for (const p of this.people) {
      if (p.role === 'wall' && this.rng.chance(0.85)) p.ai.jumpAt = this.time + this.rng.range(0.08, 0.2);
      if (p.role === 'attacker' || p.role === 'defender') p.ai.followAt = this.time + this.rng.range(0.1, 0.4);
    }
    this.scheduleKeeperReaction(0.08);
  }

  private scheduleKeeperReaction(extra: number) {
    const skill = this.setup.keeperSkill;
    this.keeper.ai.reactAt = this.time + lerp(0.32, 0.14, skill) + extra;
  }

  // ---------------------------------------------------------------- ball

  private updateBall(dt: number) {
    const ball = this.ball;
    if (this.ballState === 'held') {
      this.keeperHands(this.keeper, ball.pos);
      ball.vel.set(0, 0, 0);
      return;
    }

    const prevZ = ball.pos.z;
    const prevY = ball.pos.y;
    const prevX = ball.pos.x;
    const bounced = ball.step(dt, this.env);
    if (bounced && ball.speed > 2) this.events.emit('bounce', { pos: ball.pos.clone(), speed: ball.speed });
    if (this.env.puddleAt) {
      const wet = ball.pos.y < BALL_RADIUS + 0.03 && this.env.puddleAt(ball.pos.x, ball.pos.z) > PUDDLE_THRESHOLD;
      if (wet && !this.inPuddle && ball.speed > 1.5) this.events.emit('splash', { pos: ball.pos.clone(), speed: ball.speed });
      this.inPuddle = wet;
    }

    if (this.ballState === 'net') {
      const hit = confineToNet(ball);
      if (hit) this.netHit(hit);
      return;
    }

    const frame = collideFrame(ball);
    if (frame) {
      this.lastTouch = frame;
      if (this.ballState === 'flight') this.ballState = 'loose';
      this.events.emit('frame', { kind: frame, pos: ball.pos.clone(), speed: ball.speed });
    }

    // Goal-line plane crossing.
    if (prevZ >= 0 && ball.pos.z < 0) {
      const t = prevZ / (prevZ - ball.pos.z);
      const x = lerp(prevX, ball.pos.x, t);
      const y = lerp(prevY, ball.pos.y, t);
      this.crossing = { x, y, inMouth: inMouth(x, y) };
      const ti = targetAt(this.setup.targets, x, y);
      if (ti >= 0 && !this.targetHit) this.targetHit = { index: ti, time: this.time };
    }

    if (ball.pos.z < GOAL_LINE_CROSSED_Z && !this.outcome) {
      if (this.crossing?.inMouth && inMouth(ball.pos.x, ball.pos.y)) {
        this.ballState = 'net';
        const rebound = this.attackerShotUsed;
        this.setOutcome('goal', rebound ? 'REBOUND GOAL!' : 'GOAL!', true, rebound);
        const hit = confineToNet(ball);
        if (hit) this.netHit(hit);
        return;
      }
      this.missOutOfPlay();
    }
    // Outer netting only applies to balls that didn't come in through the mouth.
    if (!(this.crossing?.inMouth && inMouth(ball.pos.x, ball.pos.y))) collideOuterNet(ball);

    if (!this.outcome) {
      if (Math.abs(ball.pos.x) > PITCH.width / 2 + BALL_RADIUS) this.setOutcome('out', 'OUT OF PLAY');
      else if (ball.pos.z > PITCH.penaltyAreaDepth + 22) this.setOutcome('cleared', 'CLEARED!');
    }

    if (this.ballState === 'flight' && ball.onGround && ball.speed < 7) this.ballState = 'loose';

    if (this.ballState === 'flight' || this.ballState === 'loose' || this.ballState === 'cleared') this.collidePeople();
  }

  private netHit(pos: Vector3) {
    const speed = this.ball.speed;
    this.netImpact = { pos, strength: clamp(speed / 6, 0.3, 1.5), time: this.time };
    this.events.emit('net', { pos, speed });
  }

  private missOutOfPlay() {
    const c = this.crossing;
    switch (this.lastTouch) {
      case 'keeper':
        return this.setOutcome('saved', 'SAVED!');
      case 'post':
        return this.setOutcome('post', 'OFF THE POST!');
      case 'bar':
        return this.setOutcome('bar', 'OFF THE BAR!');
      case 'wall':
        return this.setOutcome('blocked', 'BLOCKED!');
      default:
        if (c && c.y > PITCH.goalHeight && Math.abs(c.x) < HALF_GOAL + 1.5) return this.setOutcome('over', 'OVER THE BAR!');
        return this.setOutcome('wide', 'WIDE!');
    }
  }

  private setOutcome(kind: OutcomeKind, message: string, goal = false, rebound = false) {
    if (this.outcome) return;
    this.outcome = {
      kind,
      goal,
      rebound,
      message,
      time: this.time,
      crossing: this.crossing ? { x: this.crossing.x, y: this.crossing.y } : undefined,
    };
    this.events.emit('outcome', this.outcome);
    for (const p of this.people) {
      if (goal && p.side === 'attack') p.ai.celebrate = true;
    }
  }

  private collidePeople() {
    const ball = this.ball;
    for (const p of this.people) {
      if (p.role === 'referee' || p.touchCooldown > 0) continue;
      if (p.role === 'keeper') {
        this.keeperContact(p);
        continue;
      }
      tmpA.set(p.pos.x, p.jumpY + 0.12, p.pos.z);
      tmpB.set(p.pos.x, p.jumpY + p.height - 0.1, p.pos.z);
      closestPointOnSegment(ball.pos, tmpA, tmpB, tmpC);
      tmpN.subVectors(ball.pos, tmpC);
      const d = tmpN.length();
      const minD = p.radius + BALL_RADIUS;
      if (d >= minD || d < 1e-6) continue;
      tmpN.divideScalar(d);
      ball.pos.copy(tmpC).addScaledVector(tmpN, minD + 1e-3);
      const vn = ball.vel.dot(tmpN);
      if (vn < 0) ball.vel.addScaledVector(tmpN, -1.35 * vn);
      ball.vel.multiplyScalar(0.7);
      ball.spin.multiplyScalar(0.3);
      p.touchCooldown = 0.3;
      if (this.ballState === 'flight') this.ballState = 'loose';
      this.lastTouch = p.role === 'wall' ? 'wall' : p.side === 'attack' ? 'attacker' : 'defender';
      this.events.emit('touch', { role: p.role, pos: ball.pos.clone(), kind: 'block' });
    }
  }

  // ---------------------------------------------------------------- keeper

  /** World-space position of the keeper's hands. */
  keeperHands(k: Person, out: Vector3): Vector3 {
    const mode = k.ai.mode as string;
    if (mode === 'dive' || mode === 'down') {
      const dir = k.ai.diveDir as number;
      const prog = mode === 'dive' ? (k.ai.diveProg as number) : 1;
      // Once the dive is over he falls to the ground quickly (same moment the sprite shows him lying).
      const handsY = mode === 'down' ? lerp(k.ai.handsY as number, 0.3, clamp((k.ai.downT as number) / KEEPER_FALL_TIME, 0, 1)) : lerp(1.2, k.ai.handsY as number, prog);
      return out.set(k.pos.x + dir * (0.35 + 0.95 * prog), handsY + k.jumpY, k.pos.z + 0.15);
    }
    if (mode === 'reach' && k.ai.hx !== undefined) {
      return out.set(k.ai.hx as number, (k.ai.hy as number) + k.jumpY, k.pos.z + 0.25);
    }
    return out.set(k.pos.x, 1.15 + k.jumpY, k.pos.z + 0.3);
  }

  /** Predict where the ball crosses the plane z = planeZ (ignores players). */
  predictPlane(planeZ: number, maxT = 3): { x: number; y: number; t: number } | null {
    const sim = new Ball().copyFrom(this.ball);
    for (let t = 0; t < maxT; t += SIM_DT * 2) {
      const pz = sim.pos.z;
      sim.step(SIM_DT * 2, this.env);
      if (pz >= planeZ && sim.pos.z < planeZ) return { x: sim.pos.x, y: sim.pos.y, t };
      if (sim.vel.z > 0.5 && sim.pos.z > planeZ + 2) return null;
    }
    return null;
  }

  private updateKeeper(dt: number) {
    const k = this.keeper;
    const skill = this.setup.keeperSkill;
    const ball = this.ball;
    const mode = k.ai.mode as string;

    if (this.ballState === 'held') {
      k.vel.set(0, 0, 0);
      if (mode === 'dive') this.advanceDive(k, dt);
      else if (mode === 'down') {
        k.ai.downT = (k.ai.downT as number) + dt;
        if ((k.ai.downT as number) > 1.3) { k.ai.mode = 'hold'; k.setAnim('hold'); }
      } else if (mode !== 'hold') { k.ai.mode = 'hold'; k.setAnim('hold'); }
      return;
    }

    if (k.ai.reactAt !== undefined && this.time >= (k.ai.reactAt as number) && (mode === 'set' || mode === 'track' || mode === 'reach')) {
      k.ai.reactAt = undefined;
      this.keeperDecide(k, skill);
    }

    switch (k.ai.mode) {
      case 'reach': {
        // Shuffle across and move the hands to the predicted point.
        const tx = k.ai.tx as number;
        const dx = tx - k.pos.x;
        k.vel.set(clamp(dx * 6, -3.5, 3.5), 0, 0);
        const hx = (k.ai.hx as number) ?? k.pos.x;
        k.ai.hx = hx + clamp((k.ai.targetHx as number) - hx, -7 * dt, 7 * dt);
        k.ai.hy = (k.ai.hy as number) + clamp((k.ai.targetHy as number) - (k.ai.hy as number), -7 * dt, 7 * dt);
        if (this.time > (k.ai.until as number)) k.ai.mode = 'track';
        break;
      }
      case 'dive':
        this.advanceDive(k, dt);
        break;
      case 'down':
        k.vel.set(0, 0, 0);
        k.ai.downT = (k.ai.downT as number) + dt;
        if ((k.ai.downT as number) > 1.0) { k.ai.mode = 'track'; k.setAnim('idle'); if (this.ballState === 'flight') this.scheduleKeeperReaction(0); }
        break;
      case 'chase': {
        tmpA.subVectors(ball.pos, k.pos).setY(0);
        const d = tmpA.length();
        k.vel.copy(tmpA).multiplyScalar(d > 0.01 ? 5.6 / d : 0);
        if (d < 0.9 && ball.pos.y < 2.3 && ball.speed < 14) this.keeperCatch(k);
        if (this.ballState !== 'loose') k.ai.mode = 'track';
        break;
      }
      case 'track':
      case 'set': {
        // Stay on the line between ball and goal centre, a little off the line.
        const bz = Math.max(ball.pos.z, 1);
        const tx = clamp((ball.pos.x * 0.8) / bz, -HALF_GOAL + 0.6, HALF_GOAL - 0.6);
        const tz = 0.7;
        tmpA.set(tx - k.pos.x, 0, tz - k.pos.z);
        const d = tmpA.length();
        k.vel.copy(tmpA).multiplyScalar(d > 0.05 ? Math.min(3, d * 4) / d : 0);
        if (this.ballState === 'loose' && this.inBox(ball.pos) && ball.pos.distanceTo(k.pos) < 7 && !this.outfieldCloser(k)) {
          k.ai.mode = 'chase';
        }
        break;
      }
    }
    if (k.ai.mode === 'track' || k.ai.mode === 'set' || k.ai.mode === 'reach' || k.ai.mode === 'chase') {
      k.setAnim(k.ai.mode === 'chase' && k.vel.lengthSq() > 1 ? 'run' : 'idle');
    }
  }

  /**
   * The sim, not the clock, picks the dive frame so the sprite always matches the collision body:
   * launch, full stretch while airborne, lying once his hands are on the ground.
   */
  private syncKeeperPose(k: Person) {
    const mode = k.ai.mode as string;
    if (mode !== 'dive' && mode !== 'down') {
      k.frame = undefined;
      return;
    }
    const handsY = this.keeperHands(k, tmpC).y;
    const lowDive = (k.ai.handsY as number) < KEEPER_LOW;
    k.reachY = handsY;
    if (mode === 'dive') k.frame = (k.ai.diveProg as number) < 0.25 ? 0 : lowDive ? 2 : 1;
    else k.frame = handsY < KEEPER_LOW ? 2 : 1;
  }

  private advanceDive(k: Person, dt: number) {
    const prog = Math.min(1, (k.ai.diveProg as number) + dt / (k.ai.diveDur as number));
    k.ai.diveProg = prog;
    const ease = 1 - (1 - prog) * (1 - prog);
    k.pos.x = (k.ai.startX as number) + (k.ai.diveDir as number) * (k.ai.diveDist as number) * ease;
    k.vel.set(0, 0, 0);
    if (prog >= 1) {
      k.ai.mode = 'down';
      k.ai.downT = 0;
      // Stay on the dive animation's last frame (lying on the ground) while down.
    }
  }

  private keeperDecide(k: Person, skill: number) {
    const p = this.predictPlane(k.pos.z + 0.1);
    if (!p) return;
    const err = 1 - skill;
    p.x += this.rng.normal() * 0.9 * err;
    p.y += this.rng.normal() * 0.35 * err;
    // Ignore shots clearly going wide or over.
    if (Math.abs(p.x) > HALF_GOAL + 0.7 || p.y > PITCH.goalHeight + 0.5) return;
    const dx = p.x - k.pos.x;
    if (Math.abs(dx) < 0.8 && p.y < 2.1) {
      k.ai.mode = 'reach';
      k.ai.tx = k.pos.x + clamp(dx, -0.5, 0.5);
      k.ai.hx = k.pos.x;
      k.ai.hy = 1.15;
      k.ai.targetHx = p.x;
      k.ai.targetHy = clamp(p.y, 0.25, 2.0);
      k.ai.until = this.time + p.t + 0.6;
      return;
    }
    if (Math.abs(dx) < 1.1 && p.y >= 2.1) {
      k.jump(2.4 + skill);
      k.setAnim('jump');
      k.ai.mode = 'reach';
      k.ai.tx = k.pos.x + clamp(dx, -0.5, 0.5);
      k.ai.hx = k.pos.x;
      k.ai.hy = 2.0;
      k.ai.targetHx = p.x;
      k.ai.targetHy = 2.15;
      k.ai.until = this.time + p.t + 0.6;
      return;
    }
    const dir = Math.sign(dx);
    k.ai.mode = 'dive';
    k.ai.diveDir = dir;
    k.ai.diveProg = 0;
    k.ai.startX = k.pos.x;
    k.ai.diveDist = clamp(Math.abs(dx) - 1.15, 0.2, 1.35 + skill * 1.0);
    k.ai.diveDur = lerp(0.62, 0.46, skill);
    k.ai.handsY = clamp(p.y, 0.25, 1.85 + skill * 0.45);
    // Keeper's right is -x when facing the pitch (+z).
    k.setAnim(dir > 0 ? 'dive_left' : 'dive_right');
  }

  private keeperContact(k: Person) {
    const ball = this.ball;
    if (ball.pos.z < -0.3) return;
    const hands = this.keeperHands(k, tmpB);
    const mode = k.ai.mode as string;
    const lying = mode === 'down' && hands.y < KEEPER_LOW;
    const bodyR = lying ? KEEPER_LYING_RADIUS : k.radius;
    let bodyA: Vector3;
    if (mode === 'dive' || mode === 'down') bodyA = tmpA.set(k.pos.x - (k.ai.diveDir as number) * 0.35, lying ? 0.25 : 0.3, k.pos.z);
    else bodyA = tmpA.set(k.pos.x, 0.15 + k.jumpY, k.pos.z);
    const bodyB = mode === 'dive' || mode === 'down' ? hands : tmpC.set(k.pos.x, 1.75 + k.jumpY, k.pos.z);
    const cp = closestPointOnSegment(ball.pos, bodyA, bodyB, new Vector3());
    const dBody = cp.distanceTo(ball.pos);
    const dHands = hands.distanceTo(ball.pos);
    const hit = dBody < bodyR + BALL_RADIUS || dHands < 0.24 + BALL_RADIUS;
    if (!hit) return;

    const skill = this.setup.keeperSkill;
    const speed = ball.speed;
    const wet = this.setup.weather === 'rain' ? 0.25 : this.setup.weather === 'snow' ? 0.12 : 0;
    const handContact = dHands < 0.45;
    const pCatch = handContact
      ? clamp(0.32 + 0.6 * skill - Math.max(0, speed - 13) * 0.035 - wet - (mode === 'dive' ? 0.18 : 0), 0.03, 0.92)
      : speed < 8 ? 0.7 : 0.08;
    if (this.rng.chance(pCatch)) {
      this.keeperCatch(k);
      return;
    }
    // Parry: push it away from goal.
    tmpN.subVectors(ball.pos, dBody < dHands ? cp : hands);
    if (tmpN.lengthSq() < 1e-6) tmpN.set(0, 0, 1);
    tmpN.normalize();
    tmpN.z = Math.max(tmpN.z, 0.35);
    tmpN.normalize();
    const vn = ball.vel.dot(tmpN);
    if (vn < 0) ball.vel.addScaledVector(tmpN, -1.4 * vn);
    ball.vel.multiplyScalar(0.55);
    ball.vel.x += (k.ai.diveDir as number | undefined ?? Math.sign(ball.pos.x - k.pos.x)) * this.rng.range(0, 3);
    ball.vel.y += this.rng.range(0, 2.5);
    ball.vel.z += this.rng.range(1.5, 4);
    ball.spin.multiplyScalar(0.2);
    ball.pos.copy(dBody < dHands ? cp : hands).addScaledVector(tmpN, (dBody < dHands ? bodyR : 0.24) + BALL_RADIUS + 0.01);
    k.touchCooldown = 0.45;
    this.lastTouch = 'keeper';
    this.ballState = 'loose';
    this.events.emit('touch', { role: 'keeper', pos: ball.pos.clone(), kind: 'save' });
  }

  private keeperCatch(k: Person) {
    this.ballState = 'held';
    this.lastTouch = 'keeper';
    this.ball.vel.set(0, 0, 0);
    this.ball.spin.set(0, 0, 0);
    this.events.emit('touch', { role: 'keeper', pos: this.ball.pos.clone(), kind: 'catch' });
    if (k.ai.mode !== 'dive' && k.ai.mode !== 'down') {
      k.ai.mode = 'hold';
      k.setAnim('hold');
    }
    this.setOutcome('saved', 'SAVED!');
  }

  private inBox(p: Vector3) {
    return Math.abs(p.x) < PITCH.penaltyAreaWidth / 2 && p.z < PITCH.penaltyAreaDepth && p.z > -0.5;
  }

  private outfieldCloser(k: Person) {
    const dk = k.pos.distanceTo(this.ball.pos);
    return this.people.some((p) => p.side !== 'ref' && p.role !== 'keeper' && p.pos.distanceTo(this.ball.pos) < dk * 0.6);
  }

  // ---------------------------------------------------------------- outfield

  private idleBehaviour(dt: number) {
    for (const p of this.people) {
      if (p === this.kicker && this.phase === 'runup') continue;
      p.vel.set(0, 0, 0);
      p.heading = turnTowards(p.heading, headingTo(p.pos, this.ball.pos), 4 * dt);
      if (p.anim !== 'idle' && p.anim !== 'jump') p.setAnim('idle');
    }
  }

  private updateOutfield(dt: number) {
    const ball = this.ball;
    const loose = this.ballState === 'loose' && !this.outcome;

    // Pick the two nearest outfield players per side to chase a loose ball.
    const chasers = new Set<Person>();
    if (loose) {
      for (const side of ['attack', 'defence'] as const) {
        this.people
          .filter((p) => p.side === side && p.role !== 'keeper' && !(side === 'attack' && this.attackerShotUsed))
          .sort((a, b) => a.pos.distanceToSquared(ball.pos) - b.pos.distanceToSquared(ball.pos))
          .slice(0, 2)
          .forEach((p) => chasers.add(p));
      }
    }

    for (const p of this.people) {
      if (p.role === 'keeper') continue;
      if (p.ai.jumpAt !== undefined && this.time >= (p.ai.jumpAt as number)) {
        p.ai.jumpAt = undefined;
        p.jump(2.7);
      }

      if (p.ai.celebrate) {
        p.setAnim('celebrate');
        p.vel.set(0, 0, 0);
        continue;
      }

      if (p.role === 'referee') {
        // Keep a view of play, ~12 m from the ball.
        tmpA.subVectors(p.pos, ball.pos).setY(0);
        const d = tmpA.length();
        if (d > 16 || d < 8) {
          tmpB.copy(ball.pos).setY(0).addScaledVector(tmpA.normalize(), 12).sub(p.pos);
          tmpB.x = clamp(tmpB.x, -5, 5);
          tmpB.z = clamp(tmpB.z, -5, 5);
          p.vel.copy(tmpB).setLength(Math.min(3, tmpB.length()));
        } else p.vel.multiplyScalar(0.9);
        this.faceMovementOrBall(p, dt);
        continue;
      }

      if (p.anim === 'kick' && p.animTime < 0.45) {
        p.vel.set(0, 0, 0);
        continue;
      }

      if (chasers.has(p)) {
        this.chase(p, dt);
        continue;
      }

      if (p.ai.followAt !== undefined && this.time >= (p.ai.followAt as number) && !this.outcome) {
        // Follow in towards goal for any rebound.
        const target = tmpA.copy(p.home);
        target.z = Math.max(4, p.home.z - (p.side === 'attack' ? 4 : 3));
        target.x *= 0.8;
        tmpB.subVectors(target, p.pos).setY(0);
        const d = tmpB.length();
        p.vel.copy(tmpB).multiplyScalar(d > 0.2 ? (p.side === 'attack' ? 4.2 : 3.6) / d : 0);
      } else {
        p.vel.multiplyScalar(0.85);
      }
      this.faceMovementOrBall(p, dt);
    }
  }

  private chase(p: Person, dt: number) {
    const ball = this.ball;
    const speed = p.side === 'attack' ? 6.6 : 6.4;
    const dist = Math.hypot(ball.pos.x - p.pos.x, ball.pos.z - p.pos.z);
    const lead = Math.min(dist / speed, 0.8);
    tmpA.set(ball.pos.x + ball.vel.x * lead - p.pos.x, 0, ball.pos.z + ball.vel.z * lead - p.pos.z);
    const d = tmpA.length();
    p.vel.copy(tmpA).multiplyScalar(d > 0.05 ? speed / d : 0);
    this.faceMovementOrBall(p, dt);

    if (p.touchCooldown > 0) return;
    const foot = dist < 0.75 && ball.pos.y < 1.0;
    const head = dist < 0.5 && ball.pos.y >= 1.0 && ball.pos.y < 2.3 + p.jumpY;
    if (!foot && !head) return;
    if (p.side === 'defence') this.clearBall(p, head);
    else this.aiShot(p, head);
  }

  private clearBall(p: Person, header: boolean) {
    const ball = this.ball;
    const sx = Math.abs(ball.pos.x) > 1 ? Math.sign(ball.pos.x) : this.rng.chance(0.5) ? 1 : -1;
    const dir = tmpA.set(sx * this.rng.range(0.4, 1.1), 0, 1).normalize();
    const speed = header ? 15 : 24;
    const elev = (header ? 20 : 30) * DEG;
    ball.vel.copy(dir).multiplyScalar(Math.cos(elev) * speed).setY(Math.sin(elev) * speed);
    ball.spin.set(this.rng.range(-10, 10), this.rng.range(-10, 10), 0);
    p.touchCooldown = 0.5;
    p.setAnim('kick');
    this.ballState = 'cleared';
    this.lastTouch = 'defender';
    this.events.emit('touch', { role: p.role, pos: ball.pos.clone(), kind: 'clear' });
    this.events.emit('kick', { pos: ball.pos.clone(), speed, by: p.role });
    this.setOutcome('cleared', 'CLEARED!');
  }

  /** The game's automatic follow-up shot, aimed at the side away from the keeper. */
  private aiShot(p: Person, header: boolean) {
    const ball = this.ball;
    const k = this.keeper;
    const tx = (k.pos.x > ball.pos.x * 0.15 ? -1 : 1) * (HALF_GOAL - 0.7) + this.rng.normal() * 0.9;
    const ty = header ? this.rng.range(0.3, 1.2) : this.rng.range(0.25, 1.7);
    const target = tmpA.set(tx, ty, -0.5);
    const horiz = Math.hypot(target.x - ball.pos.x, target.z - ball.pos.z);
    const vh = header ? 13 : 21;
    const t = horiz / vh * 1.08;
    const vy = (ty - ball.pos.y + 0.5 * GRAVITY * t * t) / t;
    ball.vel.set(((target.x - ball.pos.x) / horiz) * vh, vy, ((target.z - ball.pos.z) / horiz) * vh);
    ball.spin.set(0, this.rng.range(-8, 8), 0);
    p.touchCooldown = 0.6;
    p.setAnim('kick');
    this.attackerShotUsed = true;
    this.ballState = 'flight';
    this.lastTouch = 'attacker';
    this.events.emit('touch', { role: p.role, pos: ball.pos.clone(), kind: 'shot' });
    this.events.emit('kick', { pos: ball.pos.clone(), speed: Math.hypot(vh, vy), by: p.role });
    const km = k.ai.mode as string;
    if (km !== 'dive' && km !== 'down') {
      k.ai.mode = 'track';
      this.scheduleKeeperReaction(0);
    }
  }

  private faceMovementOrBall(p: Person, dt: number) {
    const moving = p.vel.lengthSq() > 0.25;
    const target = moving ? Math.atan2(p.vel.x, p.vel.z) : headingTo(p.pos, this.ball.pos);
    p.heading = turnTowards(p.heading, target, 7 * dt);
    if (p.anim === 'jump' && p.jumpY > 0) return;
    if (p.anim === 'kick' && p.animTime < 0.45) return;
    p.setAnim(moving ? 'run' : 'idle');
  }

  private integratePerson(p: Person, dt: number) {
    p.animTime += dt;
    if (p.touchCooldown > 0) p.touchCooldown -= dt;
    p.pos.x += p.vel.x * dt;
    p.pos.z += p.vel.z * dt;
    if (p.jumpY > 0 || p.jumpVy > 0) {
      p.jumpY += p.jumpVy * dt;
      p.jumpVy -= GRAVITY * dt;
      if (p.jumpY <= 0) {
        p.jumpY = 0;
        p.jumpVy = 0;
        if (p.anim === 'jump') p.setAnim('idle');
      }
    }
  }
}
