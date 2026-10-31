import { CanvasTexture, LinearFilter, NearestFilter, RepeatWrapping, SRGBColorSpace, Texture } from 'three';
import { puddleSampler } from '../config/surface';
import { generatePlaceholder } from '../placeholders';
import { DEFAULT_MANIFEST, mergeManifest, type Manifest } from './manifest';
import { DEFAULT_STADIUM, type StadiumLayout } from './stadium';

export type ImageSource = HTMLImageElement | HTMLCanvasElement;

/**
 * Loads manifest.json + stadium.json and every texture they reference. Any file that is
 * missing or fails to load is replaced by its procedural placeholder, so the game always runs.
 */
export class AssetManager {
  manifest: Manifest = DEFAULT_MANIFEST;
  stadium: StadiumLayout = DEFAULT_STADIUM;
  readonly images = new Map<string, ImageSource>();
  private textures = new Map<string, Texture>();
  readonly placeholdersUsed: string[] = [];

  /** URL prefix for public/assets (tools pages served from elsewhere pass '/assets/'). */
  constructor(private base = './assets/') {}

  async load(onProgress?: (done: number, total: number) => void): Promise<void> {
    const m = await fetchJson<Partial<Manifest>>(this.base + 'manifest.json');
    if (m) this.manifest = mergeManifest(DEFAULT_MANIFEST, m);
    const s = await fetchJson<Partial<StadiumLayout>>(this.base + 'stadium.json');
    if (s) this.stadium = { ...DEFAULT_STADIUM, ...s };

    const paths = new Set<string>();
    for (const set of Object.values(this.manifest.characters))
      for (const sh of Object.values(set.sheets)) [sh.base, sh.mask, sh.uv].forEach((p) => p && paths.add(p));
    paths.add(this.manifest.crowd.atlas);
    Object.values(this.manifest.textures).forEach((p) => paths.add(p));
    this.manifest.hoardings.forEach((p) => paths.add(p));

    let done = 0;
    await Promise.all(
      [...paths].map(async (p) => {
        const img = await loadImage(this.base + p).catch(() => null);
        if (img) this.images.set(p, img);
        else {
          const c = generatePlaceholder(p, this.manifest);
          if (c) {
            this.images.set(p, c);
            this.placeholdersUsed.push(p);
          }
        }
        onProgress?.(++done, paths.size);
      }),
    );
  }

  private puddles: ((x: number, z: number) => number) | null = null;

  /** Puddle depth read from the wet-pitch overlay's alpha, so replacement art drives the physics. */
  puddleAt(): ((x: number, z: number) => number) | undefined {
    if (this.puddles) return this.puddles;
    const img = this.images.get(this.manifest.textures.pitchWet);
    if (!img) return undefined;
    const w = 256, h = 384;
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = c.getContext('2d', { willReadFrequently: true })!;
    g.drawImage(img, 0, 0, w, h);
    this.puddles = puddleSampler(g.getImageData(0, 0, w, h).data, w, h);
    return this.puddles;
  }

  /** Texture for a manifest path. `data` textures (masks, UV maps) use nearest filtering and no colour conversion. */
  texture(path: string, opts: { data?: boolean; repeat?: boolean } = {}): Texture {
    const key = `${path}|${opts.data ? 'd' : 'c'}|${opts.repeat ? 'r' : ''}`;
    let t = this.textures.get(key);
    if (t) return t;
    const img = this.images.get(path);
    t = img ? new CanvasTexture(img as HTMLCanvasElement) : new Texture();
    if (opts.data) {
      t.magFilter = NearestFilter;
      t.minFilter = NearestFilter;
      t.generateMipmaps = false;
    } else {
      t.colorSpace = SRGBColorSpace;
      t.minFilter = opts.repeat ? t.minFilter : LinearFilter;
      t.generateMipmaps = !!opts.repeat;
    }
    if (opts.repeat) t.wrapS = t.wrapT = RepeatWrapping;
    t.needsUpdate = true;
    this.textures.set(key, t);
    return t;
  }
}

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    return (await r.json()) as T;
  } catch {
    return null;
  }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}
