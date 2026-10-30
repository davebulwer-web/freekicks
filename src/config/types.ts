export type KitPattern = 'plain' | 'stripes' | 'hoops' | 'halves' | 'sash';
export const KIT_PATTERNS: KitPattern[] = ['plain', 'stripes', 'hoops', 'halves', 'sash'];

export interface Kit {
  pattern: KitPattern;
  /** Hex colours, e.g. "#d01020". */
  shirt1: string;
  shirt2: string;
  shorts: string;
  socks: string;
  /** Number of stripes/hoops around the body (default 6). */
  patternCount?: number;
}

export interface Team {
  id: string;
  name: string;
  short: string;
  kit: Kit;
  keeper: Kit;
}

export type WeatherKind = 'clear' | 'rain' | 'snow';

export interface ModeConfig {
  id: string;
  name: string;
  description: string;
  lives: number;
  /** Wind speed range in m/s, plus ramp per stage. */
  windMin: number;
  windMax: number;
  windRampPerStage: number;
  weather: Partial<Record<WeatherKind, number>>;
  /** Final points multiplier for this mode. */
  scoreMultiplier: number;
  /** Time Attack: seconds on the clock. When set, misses don't cost lives. */
  timeLimit?: number;
  /** Target Challenge: round boards hung in the goal. */
  targets?: { min: number; max: number; radius: number; bonus: number };
  /** Bending Masterclass: |swerve| (0..1) needed for a goal to count. */
  minSwerve?: number;
  swerveBonusMultiplier?: number;
  /** Floodlit evening match. */
  night?: boolean;
  /** 'short' = a single replay pass. */
  replay?: 'full' | 'short';
}

export interface TargetBoard {
  /** Centre across the goal (x) and height (y), metres. */
  x: number;
  y: number;
  r: number;
}

export interface StageSetup {
  stage: number;
  seed: number;
  ballPos: { x: number; z: number };
  wallSize: number;
  keeperSkill: number;
  barSpeed: number;
  wind: { x: number; z: number };
  weather: WeatherKind;
  markers: number;
  attackers: number;
  targets?: TargetBoard[];
}
