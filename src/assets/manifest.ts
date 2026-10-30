/**
 * Asset manifest: every graphic and sound the game uses is a named slot here.
 * public/assets/manifest.json overrides these defaults, so replacing art means dropping in a
 * file (same name) or pointing a slot at a new file. Missing files fall back to the procedural
 * placeholders in src/placeholders.
 */

export interface AnimDef {
  sheet: string;
  start: number;
  count: number;
  fps: number;
  loop: boolean;
}

export interface SheetDef {
  /** Colour/lighting layer (kit areas greyscale). */
  base: string;
  /** R = shirt, G = shorts, B = socks. Optional for sheets with no kit (e.g. crowd). */
  mask?: string;
  /** Shirt surface UVs for patterns. */
  uv?: string;
  frameW: number;
  frameH: number;
  columns: number;
  rows: number;
}

export interface CharacterSet {
  sheets: Record<string, SheetDef>;
  anims: Record<string, AnimDef>;
  /** Pixels per metre in the frames. */
  pixelsPerMetre: number;
  /** Ground line, in pixels from the bottom of a frame. */
  footY: number;
  /** Row order is fixed: 0 = facing camera, then clockwise in 45 degree steps as seen from above (2 = facing screen-right, 4 = back, 6 = facing screen-left). */
  directions: number;
}

export interface Manifest {
  version: number;
  characters: Record<'people' | 'cameraman', CharacterSet>;
  crowd: { atlas: string; frameW: number; frameH: number; variants: number; frames: number; worldHeight: number };
  textures: Record<string, string>;
  hoardings: string[];
  models: Record<string, string>;
  audio: Record<string, string>;
}

export const DEFAULT_MANIFEST: Manifest = {
  version: 1,
  characters: {
    people: {
      sheets: {
        main: { base: 'sprites/people_base.png', mask: 'sprites/people_mask.png', uv: 'sprites/people_uv.png', frameW: 128, frameH: 256, columns: 17, rows: 8 },
        dive: { base: 'sprites/dive_base.png', mask: 'sprites/dive_mask.png', uv: 'sprites/dive_uv.png', frameW: 320, frameH: 256, columns: 6, rows: 8 },
      },
      anims: {
        idle: { sheet: 'main', start: 0, count: 2, fps: 1.5, loop: true },
        run: { sheet: 'main', start: 2, count: 6, fps: 12, loop: true },
        kick: { sheet: 'main', start: 8, count: 4, fps: 12, loop: false },
        jump: { sheet: 'main', start: 12, count: 2, fps: 5, loop: false },
        celebrate: { sheet: 'main', start: 14, count: 2, fps: 4, loop: true },
        hold: { sheet: 'main', start: 16, count: 1, fps: 1, loop: false },
        dive_left: { sheet: 'dive', start: 0, count: 3, fps: 6, loop: false },
        dive_right: { sheet: 'dive', start: 3, count: 3, fps: 6, loop: false },
      },
      pixelsPerMetre: 110,
      footY: 14,
      directions: 8,
    },
    cameraman: {
      sheets: { main: { base: 'sprites/cameraman_base.png', mask: 'sprites/cameraman_mask.png', uv: 'sprites/cameraman_uv.png', frameW: 128, frameH: 256, columns: 2, rows: 8 } },
      anims: { idle: { sheet: 'main', start: 0, count: 2, fps: 0.5, loop: true } },
      pixelsPerMetre: 110,
      footY: 14,
      directions: 8,
    },
  },
  crowd: { atlas: 'sprites/crowd.png', frameW: 48, frameH: 64, variants: 16, frames: 2, worldHeight: 1.0 },
  textures: {
    grass: 'textures/grass.png',
    net: 'textures/net.png',
    ball: 'textures/ball.png',
    shadow: 'textures/shadow.png',
    stand: 'textures/stand.png',
    dugout: 'textures/dugout.png',
    sky: 'textures/sky.png',
    surround: 'textures/surround.png',
  },
  hoardings: [
    'hoardings/hoarding_01.png',
    'hoardings/hoarding_02.png',
    'hoardings/hoarding_03.png',
    'hoardings/hoarding_04.png',
    'hoardings/hoarding_05.png',
    'hoardings/hoarding_06.png',
    'hoardings/hoarding_07.png',
    'hoardings/hoarding_08.png',
    'hoardings/hoarding_09.png',
    'hoardings/hoarding_10.png',
  ],
  models: {},
  audio: {
    kick: '',
    whistle: '',
    post: '',
    net: '',
    bounce: '',
    cheer: '',
    groan: '',
    crowd: '',
  },
};

export function mergeManifest(base: Manifest, over: Partial<Manifest>): Manifest {
  return {
    ...base,
    ...over,
    characters: { ...base.characters, ...(over.characters ?? {}) },
    crowd: { ...base.crowd, ...(over.crowd ?? {}) },
    textures: { ...base.textures, ...(over.textures ?? {}) },
    models: { ...base.models, ...(over.models ?? {}) },
    audio: { ...base.audio, ...(over.audio ?? {}) },
    hoardings: over.hoardings ?? base.hoardings,
  };
}
