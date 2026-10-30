import { describe, expect, it } from 'vitest';
import modes from '../src/config/modes.json';
import { makeStage } from '../src/config/stages';
import type { ModeConfig } from '../src/config/types';
import { Match } from '../src/sim/Match';

const arcade = modes[0] as ModeConfig;

/** A match with play live and the keeper put into a dive towards +x. */
function diving(handsY: number) {
  const m = new Match(makeStage(1, arcade, 7));
  const k = m.keeper;
  k.pos.set(0, 0, 0.7);
  m.phase = 'live';
  m.ballState = 'flight';
  m.kickTime = m.time;
  // Park the ball far away, slowly rolling, so it can't interfere.
  m.ball.pos.set(20, 0.11, 30);
  m.ball.vel.set(0, 0, 0.1);
  Object.assign(k.ai, { mode: 'dive', diveDir: 1, diveProg: 0, startX: 0, diveDist: 0.6, diveDur: 0.5, handsY });
  k.setAnim('dive_left');
  return m;
}

function runFrames(m: Match, seconds: number) {
  const seen: { frame?: number; reachY: number }[] = [];
  for (let i = 0; i < seconds * 120; i++) {
    m.step();
    seen.push({ frame: m.keeper.frame, reachY: m.keeper.reachY });
  }
  return seen;
}

describe('goalkeeper dive pose matches collision', () => {
  it('high dive: launch, stretch, then lying only once the hands are on the ground', () => {
    const seen = runFrames(diving(1.9), 0.9);
    const order = seen.map((s) => s.frame).filter((f, i, a) => f !== undefined && f !== a[i - 1]);
    expect(order).toEqual([0, 1, 2]);
    for (const s of seen) if (s.frame === 2) expect(s.reachY).toBeLessThan(0.65);
    // Airborne stretch frames carry the real (high) hand height for drawing.
    expect(Math.max(...seen.filter((s) => s.frame === 1).map((s) => s.reachY))).toBeGreaterThan(1.7);
  });

  it('low dive goes straight from launch to the ground', () => {
    const order = runFrames(diving(0.3), 0.9)
      .map((s) => s.frame)
      .filter((f, i, a) => f !== undefined && f !== a[i - 1]);
    expect(order).toEqual([0, 2]);
  });

  it('a keeper lying on the floor does not touch a ball passing 2 ft above him, but blocks a low one', () => {
    for (const [height, touched] of [[1.0, false], [0.3, true]] as const) {
      const m = diving(1.9);
      runFrames(m, 0.75); // dive finished, now lying
      expect(m.keeper.frame).toBe(2);
      let hit = false;
      m.events.on('touch', (e) => (hit ||= e.role === 'keeper'));
      // Ball flies straight at goal over the middle of his body.
      m.ball.pos.set(0.6, height, 3);
      m.ball.vel.set(0, 0, -22);
      m.ball.spin.set(0, 0, 0);
      for (let i = 0; i < 30; i++) m.step();
      expect(hit).toBe(touched);
    }
  });
});
