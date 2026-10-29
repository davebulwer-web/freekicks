import { Rng } from '../core/Rng';
import { DEG, clamp } from '../core/math';
import { PITCH } from './rules';
import type { ModeConfig, StageSetup, WeatherKind } from './types';

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

  return {
    stage,
    seed,
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
