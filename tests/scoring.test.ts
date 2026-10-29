import { describe, expect, it } from 'vitest';
import modes from '../src/config/modes.json';
import type { ModeConfig } from '../src/config/types';
import { Session } from '../src/game/Session';
import { scoreGoal, zoneFor } from '../src/game/Scoring';
import type { Outcome } from '../src/sim/Match';

const mode = modes[0] as ModeConfig;
const goal = (x: number, y: number, rebound = false): Outcome => ({ kind: 'goal', goal: true, rebound, message: '', time: 0, crossing: { x, y } });
const miss: Outcome = { kind: 'wide', goal: false, rebound: false, message: '', time: 0 };
const shot = { height: 0.7, direction: 0.5, swerve: 0 };

describe('scoring', () => {
  it('zones: top corner beats the middle', () => {
    expect(zoneFor(3.3, 2.2)).toEqual({ row: 'top', col: 'side' });
    expect(zoneFor(0, 1.2)).toEqual({ row: 'middle', col: 'centre' });
    const s = new Session(mode, 1).current;
    expect(scoreGoal(goal(3.3, 2.2), shot, s).total).toBeGreaterThan(scoreGoal(goal(0, 1.2), shot, s).total);
  });

  it('swerve adds a bonus and rebounds score a flat 100', () => {
    const s = new Session(mode, 1).current;
    expect(scoreGoal(goal(0, 1.2), { ...shot, swerve: 1 }, s).total).toBeGreaterThan(scoreGoal(goal(0, 1.2), shot, s).total);
    expect(scoreGoal(goal(0, 1.2, true), shot, s).total).toBe(100);
  });
});

describe('session rules', () => {
  it('three misses is game over, a goal refills lives and advances the stage', () => {
    const se = new Session(mode, 7);
    const first = se.current;
    se.record(miss, shot);
    expect(se.lives).toBe(2);
    expect(se.current).toBe(first);
    se.record(goal(1, 1), shot);
    expect(se.lives).toBe(3);
    expect(se.stage).toBe(2);
    se.record(miss, shot);
    se.record(miss, shot);
    expect(se.gameOver).toBe(false);
    se.record(miss, shot);
    expect(se.gameOver).toBe(true);
    expect(se.score).toBeGreaterThan(0);
  });
});
