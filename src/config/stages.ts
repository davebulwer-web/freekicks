import { Rng } from '../core/Rng';
import { DEG, clamp } from '../core/math';
import { PITCH } from './rules';
import { HALF_GOAL } from './rules';
import type { ModeConfig, StageSetup, TargetBoard, WeatherKind } from './types';

/**
 * Procedural free-kick positions. Difficulty ramps with the stage number:
 * longer distance, wider angles, bigger walls, better keepers, faster bars, more wind.
 */
export function makeStage(stage: number, mode: ModeConfig, runSeed: number): StageSetup {
  const seed = (runSeed * 7919 + stage * 104729) >>> 0;
  const rng = new Rng(seed);
  const t = clamp((stage - 1) / 14, 0, 1);

  const dist = 19.5 + t * 9 + rng.range(-1.5, 1.5);
  const maxAngle = (12 + t * 26) * DEG;
  let angle = rng.range(-maxAngle, maxAngle);
  if (stage === 1) angle = -8 * DEG;

  let x = Math.sin(angle) * dist;
  let z = Math.cos(angle) * dist;
  // Free kicks are always outside the penalty area in this game.
  const halfBox = PITCH.penaltyAreaWidth / 2;
  if (Math.abs(x) < halfBox + 0.5 && z < PITCH.penaltyAreaDepth + 1) z = PITCH.penaltyAreaDepth + 1 + rng.range(0, 1.5);
  x = clamp(x, -PITCH.width / 2 + 3, PITCH.width / 2 - 3);

  const windSpeed = clamp(
    rng.range(mode.windMin, mode.windMax) + mode.windRampPerStage * (stage - 1) * rng.next(),
    0,
    12,
  );
  const windDir = rng.range(0, Math.PI * 2);
  const weather = rng.weighted<WeatherKind>(mode.weather);

  const targets = mode.targets ? placeTargets(rng, mode.targets) : undefined;

  return {
    stage,
    seed,
    targets,
    ballPos: { x, z },
    wallSize: Math.min(3 + Math.floor((stage - 1) / 2), 6),
    keeperSkill: Math.min(0.35 + 0.045 * (stage - 1), 0.95),
    barSpeed: Math.min(0.55 + 0.07 * (stage - 1), 1.8),
    wind: { x: Math.sin(windDir) * windSpeed, z: Math.cos(windDir) * windSpeed },
    weather,
    markers: stage > 3 ? 3 : 2,
    attackers: 2,
  };
}

/** Boards fully inside the goal mouth, not overlapping, biased towards the corners. */
function placeTargets(rng: Rng, cfg: NonNullable<ModeConfig['targets']>): TargetBoard[] {
  const n = rng.int(cfg.min, cfg.max);
  const r = cfg.radius;
  const maxX = HALF_GOAL - r - 0.08;
  const minY = r + 0.08, maxY = PITCH.goalHeight - r - 0.1;
  const boards: TargetBoard[] = [];
  for (let tries = 0; boards.length < n && tries < 200; tries++) {
    const side = rng.chance(0.5) ? 1 : -1;
    const x = side * maxX * Math.sqrt(rng.next());
    const y = minY + (maxY - minY) * rng.next();
    if (boards.every((b) => Math.hypot(b.x - x, b.y - y) > b.r + r + 0.25)) boards.push({ x, y, r });
  }
  return boards;
}

/** Index of the board the ball passed through at the goal line (or -1). */
export function targetAt(targets: TargetBoard[] | undefined, x: number, y: number): number {
  return targets?.findIndex((t) => Math.hypot(t.x - x, t.y - y) < t.r) ?? -1;
}
