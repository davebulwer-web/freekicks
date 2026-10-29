/** Real pitch dimensions (IFAB Laws of the Game), metres. Goal line at z=0, pitch towards +z. */
export const PITCH = {
  length: 105,
  width: 68,
  lineWidth: 0.12,
  goalWidth: 7.32,
  goalHeight: 2.44,
  goalDepth: 2.0,
  postRadius: 0.06,
  goalAreaWidth: 18.32,
  goalAreaDepth: 5.5,
  penaltyAreaWidth: 40.32,
  penaltyAreaDepth: 16.5,
  penaltySpot: 11,
  arcRadius: 9.15,
  centreCircleRadius: 9.15,
  cornerArcRadius: 1,
} as const;

export const HALF_GOAL = PITCH.goalWidth / 2;

export const RULES = {
  startingLives: 3,
  wallDistance: 9.15,
  playTimeout: 9,
  /** Seconds to keep simulating after the outcome is decided (net ripple, keeper landing, etc.). */
  postOutcomeTime: 1.4,
  reboundGoalPoints: 100,
} as const;
