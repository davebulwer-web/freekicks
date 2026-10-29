import { makeStage } from '../config/stages';
import type { ModeConfig, StageSetup } from '../config/types';
import type { ShotInput } from '../sim/Kick';
import type { Outcome } from '../sim/Match';
import { scoreGoal, type ScoreBreakdown } from './Scoring';

export interface KickResult {
  outcome: Outcome;
  points: ScoreBreakdown | null;
  livesBefore: number;
  livesAfter: number;
  gameOver: boolean;
}

/**
 * Rules for a run: lives, stages and score. A goal refills lives and moves on to the next
 * stage; a miss costs a life and the same free kick is retaken.
 */
export class Session {
  stage = 1;
  lives: number;
  score = 0;
  goals = 0;
  kicks = 0;
  readonly runSeed: number;
  current: StageSetup;
  history: KickResult[] = [];

  constructor(readonly mode: ModeConfig, runSeed = (Math.random() * 2 ** 31) >>> 0) {
    this.runSeed = runSeed;
    this.lives = mode.lives;
    this.current = makeStage(1, mode, runSeed);
  }

  get gameOver(): boolean {
    return this.lives <= 0;
  }

  record(outcome: Outcome, shot: ShotInput): KickResult {
    const livesBefore = this.lives;
    let points: ScoreBreakdown | null = null;
    this.kicks++;
    if (outcome.goal) {
      points = scoreGoal(outcome, shot, this.current, this.mode.scoreMultiplier);
      this.score += points.total;
      this.goals++;
      this.lives = this.mode.lives;
      this.stage++;
      this.current = makeStage(this.stage, this.mode, this.runSeed);
    } else {
      this.lives--;
    }
    const r = { outcome, points, livesBefore, livesAfter: this.lives, gameOver: this.gameOver };
    this.history.push(r);
    return r;
  }
}
