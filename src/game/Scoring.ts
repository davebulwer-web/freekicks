import { HALF_GOAL, PITCH, RULES } from '../config/rules';
import { targetAt } from '../config/stages';
import type { ModeConfig, StageSetup } from '../config/types';
import type { Outcome } from '../sim/Match';
import type { ShotInput } from '../sim/Kick';

/** 3x3 target grid across the goal mouth. Corners are worth the most, the middle the least. */
export const ZONE_POINTS = {
  top: { side: 500, centre: 200 },
  middle: { side: 300, centre: 100 },
  bottom: { side: 350, centre: 150 },
} as const;

export interface ScoreBreakdown {
  zone: number;
  zoneName: string;
  swerve: number;
  /** Target Challenge bonus (0 if no board was hit). */
  target: number;
  multiplier: number;
  total: number;
}

export function zoneFor(x: number, y: number): { row: keyof typeof ZONE_POINTS; col: 'side' | 'centre' } {
  const row = y > (PITCH.goalHeight * 2) / 3 ? 'top' : y > PITCH.goalHeight / 3 ? 'middle' : 'bottom';
  const col = Math.abs(x) > HALF_GOAL / 3 ? 'side' : 'centre';
  return { row, col };
}

/** Difficulty multiplier from distance, angle, wall size and keeper quality. */
export function difficulty(setup: StageSetup): number {
  const { x, z } = setup.ballPos;
  const dist = Math.hypot(x, z);
  const angle = Math.abs(Math.atan2(x, z));
  return 1 + Math.max(0, dist - 18) / 18 + angle * 0.6 + (setup.wallSize - 3) * 0.06 + setup.keeperSkill * 0.4;
}

export function scoreGoal(outcome: Outcome, shot: ShotInput, setup: StageSetup, mode: Partial<ModeConfig> = {}): ScoreBreakdown {
  if (outcome.rebound) {
    return { zone: 0, zoneName: 'Rebound', swerve: 0, target: 0, multiplier: 1, total: RULES.reboundGoalPoints };
  }
  const c = outcome.crossing ?? { x: 0, y: 1 };
  const z = zoneFor(c.x, c.y);
  const zone = ZONE_POINTS[z.row][z.col];
  const swerve = Math.round(Math.abs(shot.swerve) * 200 * (mode.swerveBonusMultiplier ?? 1));
  const target = targetAt(setup.targets, c.x, c.y) >= 0 ? (mode.targets?.bonus ?? 1000) : 0;
  const multiplier = difficulty(setup) * (mode.scoreMultiplier ?? 1);
  const total = Math.round(((zone + swerve + target) * multiplier) / 10) * 10;
  const zoneName = z.col === 'side' ? (z.row === 'top' ? 'Top corner' : z.row === 'bottom' ? 'Bottom corner' : 'Inside the post') : z.row === 'top' ? 'Under the bar' : z.row === 'bottom' ? 'Low and central' : 'Straight down the middle';
  return { zone, zoneName, swerve, target, multiplier, total };
}
