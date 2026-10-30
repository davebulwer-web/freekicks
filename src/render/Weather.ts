import {
  BufferAttribute,
  BufferGeometry,
  DynamicDrawUsage,
  Group,
  LineBasicMaterial,
  LineSegments,
  Points,
  PointsMaterial,
  Vector3,
} from 'three';
import type { WeatherKind } from '../config/types';
import { Rng } from '../core/Rng';

const AREA = 70;
const HEIGHT = 30;
const SPLASHES = 400;
const BURST = 60;

/** Dynamic point/line buffer whose array is shared with the GPU attribute (no copy). */
function dynamicGeometry(arr: Float32Array): BufferGeometry {
  const g = new BufferGeometry();
  const attr = new BufferAttribute(arr, 3);
  attr.setUsage(DynamicDrawUsage);
  g.setAttribute('position', attr);
  return g;
}

/**
 * Rain streaks with ground splashes, or drifting snowflakes, in a box that follows the camera.
 * Also spawns water bursts where the ball lands in a puddle.
 */
export class Weather {
  readonly group = new Group();
  /** Ball splash bursts live in world space, outside the camera-following group. */
  readonly bursts: Points;
  private kind: WeatherKind = 'clear';
  private rain: LineSegments;
  private splash: Points;
  private snow: Points[] = [];
  private drops: Float32Array;
  private splashPos: Float32Array;
  private splashLife: Float32Array;
  private flakes: Float32Array[] = [];
  private burstPos = new Float32Array(BURST * 3);
  private burstVel = new Float32Array(BURST * 3);
  private burstLife = new Float32Array(BURST);
  private wind = new Vector3();
  private rng = new Rng(9);
  private t = 0;
  private burstsWereLive = true;

  constructor() {
    const nRain = 2600;
    this.drops = new Float32Array(nRain * 6);
    for (let i = 0; i < nRain; i++) this.resetDrop(i, true);
    this.rain = new LineSegments(dynamicGeometry(this.drops), new LineBasicMaterial({ color: 0xb4c4d4, transparent: true, opacity: 0.45 }));

    this.splashPos = new Float32Array(SPLASHES * 3);
    this.splashLife = new Float32Array(SPLASHES);
    for (let i = 0; i < SPLASHES; i++) this.resetSplash(i, this.rng.next());
    this.splash = new Points(dynamicGeometry(this.splashPos), new PointsMaterial({ color: 0xdde8f2, size: 0.09, transparent: true, opacity: 0.75 }));

    for (const [n, size] of [[1600, 0.09], [900, 0.16]] as const) {
      const f = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        f[i * 3] = this.rng.range(-AREA / 2, AREA / 2);
        f[i * 3 + 1] = this.rng.range(0, HEIGHT);
        f[i * 3 + 2] = this.rng.range(-AREA / 2, AREA / 2);
      }
      this.flakes.push(f);
      this.snow.push(new Points(dynamicGeometry(f), new PointsMaterial({ color: 0xffffff, size, transparent: true, opacity: 0.9 })));
    }

    this.bursts = new Points(dynamicGeometry(this.burstPos), new PointsMaterial({ color: 0xcfe0ee, size: 0.07, transparent: true, opacity: 0.85 }));
    for (const o of [this.rain, this.splash, ...this.snow, this.bursts]) o.frustumCulled = false;
    this.group.add(this.rain, this.splash, ...this.snow);
    this.set('clear', new Vector3());
  }

  private resetDrop(i: number, anyHeight: boolean) {
    const x = this.rng.range(-AREA / 2, AREA / 2);
    const z = this.rng.range(-AREA / 2, AREA / 2);
    const y = anyHeight ? this.rng.range(0, HEIGHT) : HEIGHT + this.rng.range(0, 4);
    this.drops.set([x, y, z, x, y + 0.6, z], i * 6);
  }

  private resetSplash(i: number, life: number) {
    // Splashes are denser close to the centre of the box (where the camera looks).
    const r = Math.sqrt(this.rng.next()) * AREA * 0.45;
    const a = this.rng.range(0, Math.PI * 2);
    this.splashPos.set([Math.sin(a) * r, -10, Math.cos(a) * r], i * 3);
    this.splashLife[i] = -life * 0.6;
  }

  set(kind: WeatherKind, wind: Vector3) {
    this.kind = kind;
    this.wind.copy(wind);
    this.rain.visible = this.splash.visible = kind === 'rain';
    this.snow.forEach((s) => (s.visible = kind === 'snow'));
  }

  /** Water thrown up where the ball hits a puddle. */
  burst(pos: Vector3, strength: number) {
    let spawned = 0;
    for (let i = 0; i < BURST && spawned < 24 * Math.min(1, strength); i++) {
      if (this.burstLife[i] > 0) continue;
      const a = this.rng.range(0, Math.PI * 2);
      const s = this.rng.range(0.5, 2.2) * strength;
      this.burstPos.set([pos.x, 0.05, pos.z], i * 3);
      this.burstVel.set([Math.sin(a) * s, this.rng.range(1.2, 3) * strength, Math.cos(a) * s], i * 3);
      this.burstLife[i] = this.rng.range(0.4, 0.8);
      spawned++;
    }
  }

  update(dt: number, centre: Vector3) {
    this.t += dt;
    this.group.position.set(centre.x, 0, centre.z);
    if (this.kind === 'rain') {
      const d = this.drops;
      const sx = this.wind.x * 0.45, sz = this.wind.z * 0.45;
      for (let i = 0; i < d.length / 6; i++) {
        const k = i * 6;
        d[k] += sx * dt;
        d[k + 1] -= 22 * dt;
        d[k + 2] += sz * dt;
        // Streak trails back along the fall direction (slanted by the wind).
        d[k + 3] = d[k] - sx * 0.03;
        d[k + 4] = d[k + 1] + 0.65;
        d[k + 5] = d[k + 2] - sz * 0.03;
        if (d[k + 1] < 0) this.resetDrop(i, false);
      }
      this.rain.geometry.attributes.position.needsUpdate = true;

      for (let i = 0; i < SPLASHES; i++) {
        this.splashLife[i] += dt;
        const life = this.splashLife[i];
        if (life >= 0 && this.splashPos[i * 3 + 1] < -5) this.splashPos[i * 3 + 1] = 0.03;
        if (life >= 0) this.splashPos[i * 3 + 1] = 0.03 + life * 0.5;
        if (life > 0.12) this.resetSplash(i, this.rng.next());
      }
      this.splash.geometry.attributes.position.needsUpdate = true;
    } else if (this.kind === 'snow') {
      this.flakes.forEach((f, layer) => {
        const fall = layer ? 0.9 : 1.4;
        for (let i = 0; i < f.length / 3; i++) {
          const k = i * 3;
          const sway = Math.sin(this.t * (0.8 + layer * 0.3) + i * 1.7) * 0.5;
          f[k] += (this.wind.x * 0.6 + sway) * dt;
          f[k + 1] -= fall * dt;
          f[k + 2] += (this.wind.z * 0.6 + Math.cos(this.t * 0.7 + i) * 0.4) * dt;
          if (f[k + 1] < 0) f[k + 1] += HEIGHT;
          if (f[k] > AREA / 2) f[k] -= AREA; else if (f[k] < -AREA / 2) f[k] += AREA;
          if (f[k + 2] > AREA / 2) f[k + 2] -= AREA; else if (f[k + 2] < -AREA / 2) f[k + 2] += AREA;
        }
        this.snow[layer].geometry.attributes.position.needsUpdate = true;
      });
    }

    // Ball splash bursts
    let any = false;
    for (let i = 0; i < BURST; i++) {
      if (this.burstLife[i] <= 0) {
        this.burstPos[i * 3 + 1] = -10;
        continue;
      }
      any = true;
      this.burstLife[i] -= dt;
      this.burstVel[i * 3 + 1] -= 9.8 * dt;
      for (let c = 0; c < 3; c++) this.burstPos[i * 3 + c] += this.burstVel[i * 3 + c] * dt;
      if (this.burstPos[i * 3 + 1] < 0) this.burstLife[i] = 0;
    }
    if (any || this.burstsWereLive) this.bursts.geometry.attributes.position.needsUpdate = true;
    this.burstsWereLive = any;
  }
}
