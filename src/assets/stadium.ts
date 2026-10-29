/**
 * Stadium dressing layout (public/assets/stadium.json overrides it). Coordinates in metres:
 * goal line at z = 0, the far goal at z = 105, touchlines at x = +-34.
 */
/** Adverts face to the pitch side when runs go from the kicker's left round to the right (see default). */
export interface HoardingRun {
  from: [number, number];
  to: [number, number];
}

export interface StandDef {
  name: string;
  /** Centre of the front edge of the stand. */
  x: number;
  z: number;
  width: number;
  rows: number;
  rowDepth: number;
  rowHeight: number;
  /** Rotation so the stand faces the pitch (0 = faces +z). */
  rotationDeg: number;
  crowdDensity: number;
}

export interface PlacedItem {
  x: number;
  z: number;
  rotationDeg?: number;
}

export interface ModelPlacement extends PlacedItem {
  /** Path under public/assets, e.g. models/floodlight.glb */
  file: string;
  y?: number;
  scale?: number;
}

export interface StadiumLayout {
  hoardings: { height: number; panelWidth: number; runs: HoardingRun[] };
  stands: StandDef[];
  cameramen: PlacedItem[];
  dugouts: PlacedItem[];
  cornerFlags: boolean;
  models: ModelPlacement[];
}

export const DEFAULT_STADIUM: StadiumLayout = {
  hoardings: {
    height: 0.9,
    panelWidth: 6,
    runs: [
      { from: [-33, -4.5], to: [33, -4.5] },
      { from: [-38, 107], to: [-38, -2] },
      { from: [38, -2], to: [38, 107] },
      { from: [33, 109.5], to: [-33, 109.5] },
    ],
  },
  stands: [
    { name: 'home-end', x: 0, z: -9, width: 84, rows: 16, rowDepth: 0.85, rowHeight: 0.42, rotationDeg: 0, crowdDensity: 0.9 },
    { name: 'west', x: -43, z: 52.5, width: 120, rows: 18, rowDepth: 0.85, rowHeight: 0.42, rotationDeg: 90, crowdDensity: 0.8 },
    { name: 'east', x: 43, z: 52.5, width: 120, rows: 18, rowDepth: 0.85, rowHeight: 0.42, rotationDeg: -90, crowdDensity: 0.8 },
    { name: 'away-end', x: 0, z: 114, width: 84, rows: 16, rowDepth: 0.85, rowHeight: 0.42, rotationDeg: 180, crowdDensity: 0.6 },
  ],
  cameramen: [
    { x: -6.2, z: -3.2 },
    { x: -8.6, z: -3.4 },
    { x: 6.4, z: -3.2 },
    { x: 9.2, z: -3.5 },
    { x: 12.5, z: -3.3 },
  ],
  dugouts: [
    { x: -37, z: 45, rotationDeg: 90 },
    { x: -37, z: 60, rotationDeg: 90 },
  ],
  cornerFlags: true,
  models: [],
};
