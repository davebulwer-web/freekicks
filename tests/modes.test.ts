import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import modes from '../src/config/modes.json';
import { HALF_GOAL, PITCH } from '../src/config/rules';
import { makeStage, targetAt } from '../src/config/stages';
import { puddleDepth } from '../src/config/surface';
import type { ModeConfig } from '../src/config/types';
import { Session } from '../src/game/Session';
import { BALL_RADIUS, Ball, SURFACES } from '../src/physics/Ball';
import { Recorder } from '../src/replay/Recorder';
import { Match, type Outcome } from '../src/sim/Match';

const mode = (id: string) => (modes as ModeConfig[]).find((m) => m.id === id)!;
const goal = (x: number, y: number, rebound = false): Outcome => ({ kind: 'goal', goal: true, rebound, message: 'GOAL!', time: 0, crossing: { x, y } });
const miss: Outcome = { kind: 'wide', goal: false, rebound: false, message: 'WIDE!', time: 0 };
const shot = (swerve = 0) => ({ height: 0.7, direction: 0.5, swerve, dip: 0 });

describe('time attack', () => {
  it('misses cost no lives; the game ends when the clock runs out', () => {
    const s = new Session(mode('time-attack'), 3);
    expect(s.timed).toBe(true);
    s.record(miss, shot());
    s.record(miss, shot());
    s.record(miss, shot());
    expect(s.gameOver).toBe(false);
    s.tick(89);
    expect(s.gameOver).toBe(false);
    s.tick(2);
    expect(s.gameOver).toBe(true);
  });
});

describe('bending masterclass', () => {
  it('a goal without enough swerve is a miss; with enough it scores double swerve bonus', () => {
    const s = new Session(mode('bending'), 3);
    const r = s.record(goal(1, 1), shot(0.2));
    expect(r.outcome.goal).toBe(false);
    expect(r.outcome.message).toBe('NOT ENOUGH BEND!');
    expect(s.lives).toBe(2);
    const ok = s.record(goal(1, 1), shot(0.8));
    expect(ok.outcome.goal).toBe(true);
    expect(ok.points!.swerve).toBe(320);
  });
  it('rebound goals still save the life', () => {
    const s = new Session(mode('bending'), 3);
    expect(s.record(goal(0, 1, true), shot(0)).outcome.goal).toBe(true);
  });
});

describe('sudden death', () => {
  it('one miss ends the game', () => {
    const s = new Session(mode('sudden-death'), 3);
    s.record(miss, shot());
    expect(s.gameOver).toBe(true);
  });
});

describe('target challenge', () => {
  it('boards sit fully inside the goal mouth, deterministically per stage', () => {
    for (let st = 1; st < 30; st++) {
      const a = makeStage(st, mode('targets'), 9);
      expect(a.targets!.length).toBeGreaterThanOrEqual(1);
      for (const t of a.targets!) {
        expect(Math.abs(t.x) + t.r).toBeLessThan(HALF_GOAL);
        expect(t.y - t.r).toBeGreaterThan(0);
        expect(t.y + t.r).toBeLessThan(PITCH.goalHeight);
      }
      expect(makeStage(st, mode('targets'), 9)).toEqual(a);
    }
    expect(makeStage(1, mode('arcade'), 9).targets).toBeUndefined();
  });
  it('hitting a board adds the bonus', () => {
    const s = new Session(mode('targets'), 4);
    const t = s.current.targets![0];
    const plain = new Session(mode('targets'), 4);
    // A goal well away from every board
    let away = { x: 0, y: 0.2 };
    for (const cand of [{ x: -3.3, y: 0.2 }, { x: 3.3, y: 0.2 }, { x: 0, y: 2.3 }]) if (targetAt(s.current.targets, cand.x, cand.y) < 0) away = cand;
    const hit = s.record(goal(t.x, t.y), shot());
    const normal = plain.record(goal(away.x, away.y), shot());
    expect(hit.points!.target).toBe(1000);
    expect(hit.outcome.message).toBe('TARGET!');
    expect(normal.points!.target).toBe(0);
  });
});

describe('wet pitch', () => {
  it('a ball rolling through standing water stops sooner', () => {
    const roll = (puddleAt?: (x: number, z: number) => number) => {
      const b = new Ball();
      b.pos.set(0, BALL_RADIUS, 0);
      b.vel.set(0, 0, 9);
      for (let i = 0; i < 120 * 20; i++) b.step(1 / 120, { wind: new Vector3(), surface: SURFACES.rain, puddleAt });
      return b.pos.z;
    };
    expect(roll(() => 0.8)).toBeLessThan(roll() * 0.6);
  });
  it('the procedural field has puddles, concentrated in the goalmouth', () => {
    let goalmouth = 0, wing = 0;
    for (let x = -6; x <= 6; x += 0.5) for (let z = 0; z <= 6; z += 0.5) goalmouth += puddleDepth(x, z) > 0.25 ? 1 : 0;
    for (let x = 22; x <= 34; x += 0.5) for (let z = 40; z <= 46; z += 0.5) wing += puddleDepth(x, z) > 0.25 ? 1 : 0;
    expect(goalmouth).toBeGreaterThan(wing);
  });
});

describe('replay crowd', () => {
  it('replays the crowd level recorded at each moment', () => {
    const m = new Match(makeStage(1, mode('arcade'), 1));
    const r = new Recorder();
    for (let i = 0; i < 10; i++) {
      m.step();
      r.capture(m, i < 5 ? 0 : 1);
    }
    expect(r.sample(r.frames[2].t).excitement).toBe(0);
    expect(r.sample(r.frames[8].t).excitement).toBe(1);
  });
});
