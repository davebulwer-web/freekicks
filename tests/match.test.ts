import { describe, expect, it } from 'vitest';
import modes from '../src/config/modes.json';
import { makeStage } from '../src/config/stages';
import { PITCH } from '../src/config/rules';
import type { ModeConfig } from '../src/config/types';
import { Match } from '../src/sim/Match';

const arcade = modes[0] as ModeConfig;

function run(m: Match) {
  for (let i = 0; i < 120 * 20 && !m.finished; i++) m.step();
  return m.outcome!;
}

describe('stages', () => {
  it('free kicks are always outside the penalty area and get harder', () => {
    for (let s = 1; s <= 30; s++) {
      const st = makeStage(s, arcade, 42);
      const inside = Math.abs(st.ballPos.x) < PITCH.penaltyAreaWidth / 2 && st.ballPos.z < PITCH.penaltyAreaDepth;
      expect(inside).toBe(false);
    }
    expect(makeStage(10, arcade, 1).wallSize).toBeGreaterThan(makeStage(1, arcade, 1).wallSize);
    expect(makeStage(10, arcade, 1).barSpeed).toBeGreaterThan(makeStage(1, arcade, 1).barSpeed);
  });

  it('stage generation is deterministic (a missed kick is retaken from the same spot)', () => {
    expect(makeStage(4, arcade, 99)).toEqual(makeStage(4, arcade, 99));
  });
});

describe('match', () => {
  it('places a wall 9.15 m from the ball', () => {
    const m = new Match(makeStage(3, arcade, 5));
    const wall = m.people.filter((p) => p.role === 'wall');
    expect(wall.length).toBe(m.setup.wallSize);
    const d = Math.hypot(wall[0].pos.x - m.ballStart.x, wall[0].pos.z - m.ballStart.z);
    expect(d).toBeCloseTo(9.15, 1);
  });

  it('a shot far wide is a miss and every kick resolves', () => {
    const m = new Match(makeStage(1, arcade, 5));
    m.takeKick({ height: 0.1, direction: 0, swerve: -1, dip: 0 });
    const o = run(m);
    expect(o.goal).toBe(false);
    expect(m.finished).toBe(true);
  });

  it('a well struck shot can score', () => {
    let goals = 0;
    for (const d of [0.2, 0.3, 0.4, 0.6, 0.7, 0.8])
      for (const s of [-1, -0.5, 0, 0.5, 1]) {
        const m = new Match(makeStage(1, arcade, 1234));
        m.takeKick({ height: 0.72, direction: d, swerve: s, dip: 0.6 });
        if (run(m).goal) goals++;
      }
    expect(goals).toBeGreaterThan(3);
  });
});
