import { BufferGeometry, Float32BufferAttribute, Group, LineBasicMaterial, LineSegments, Points, PointsMaterial, Vector3 } from 'three';
import type { WeatherKind } from '../config/types';
import { Rng } from '../core/Rng';

const AREA = 70;
const HEIGHT = 30;

/** Rain streaks or snowflakes in a box that follows the camera target. */
export class Weather {
  readonly group = new Group();
  private kind: WeatherKind = 'clear';
  private rain: LineSegments;
  private snow: Points;
  private drops: Float32Array;
  private flakes: Float32Array;
  private wind = new Vector3();
  private rng = new Rng(9);

  constructor() {
    const nRain = 2500;
    this.drops = new Float32Array(nRain * 6);
    for (let i = 0; i < nRain; i++) this.resetDrop(i, true);
    const rg = new BufferGeometry();
    rg.setAttribute('position', new Float32BufferAttribute(this.drops, 3));
    this.rain = new LineSegments(rg, new LineBasicMaterial({ color: 0xaabbcc, transparent: true, opacity: 0.5 }));
    this.rain.frustumCulled = false;

    const nSnow = 2500;
    this.flakes = new Float32Array(nSnow * 3);
    for (let i = 0; i < nSnow; i++) {
      this.flakes[i * 3] = this.rng.range(-AREA / 2, AREA / 2);
      this.flakes[i * 3 + 1] = this.rng.range(0, HEIGHT);
      this.flakes[i * 3 + 2] = this.rng.range(-AREA / 2, AREA / 2);
    }
    const sg = new BufferGeometry();
    sg.setAttribute('position', new Float32BufferAttribute(this.flakes, 3));
    this.snow = new Points(sg, new PointsMaterial({ color: 0xffffff, size: 0.12, transparent: true, opacity: 0.9 }));
    this.snow.frustumCulled = false;
    this.group.add(this.rain, this.snow);
    this.set('clear', new Vector3());
  }

  private resetDrop(i: number, anyHeight: boolean) {
    const x = this.rng.range(-AREA / 2, AREA / 2);
    const z = this.rng.range(-AREA / 2, AREA / 2);
    const y = anyHeight ? this.rng.range(0, HEIGHT) : HEIGHT;
    this.drops.set([x, y, z, x, y + 0.6, z], i * 6);
  }

  set(kind: WeatherKind, wind: Vector3) {
    this.kind = kind;
    this.wind.copy(wind);
    this.rain.visible = kind === 'rain';
    this.snow.visible = kind === 'snow';
  }

  update(dt: number, centre: Vector3) {
    this.group.position.set(centre.x, 0, centre.z);
    if (this.kind === 'rain') {
      const d = this.drops;
      for (let i = 0; i < d.length / 6; i++) {
        const k = i * 6;
        const dx = this.wind.x * 0.5 * dt, dz = this.wind.z * 0.5 * dt, dy = -22 * dt;
        d[k] += dx; d[k + 1] += dy; d[k + 2] += dz;
        d[k + 3] = d[k] - this.wind.x * 0.03; d[k + 4] = d[k + 1] + 0.6; d[k + 5] = d[k + 2] - this.wind.z * 0.03;
        if (d[k + 1] < 0) this.resetDrop(i, false);
      }
      this.rain.geometry.attributes.position.needsUpdate = true;
    } else if (this.kind === 'snow') {
      const f = this.flakes;
      const t = performance.now() / 1000;
      for (let i = 0; i < f.length / 3; i++) {
        const k = i * 3;
        f[k] += (this.wind.x * 0.6 + Math.sin(t + i) * 0.4) * dt;
        f[k + 1] -= 1.3 * dt;
        f[k + 2] += (this.wind.z * 0.6 + Math.cos(t * 0.7 + i) * 0.4) * dt;
        if (f[k + 1] < 0) f[k + 1] = HEIGHT;
        if (f[k] > AREA / 2) f[k] -= AREA; else if (f[k] < -AREA / 2) f[k] += AREA;
        if (f[k + 2] > AREA / 2) f[k + 2] -= AREA; else if (f[k + 2] < -AREA / 2) f[k + 2] += AREA;
      }
      this.snow.geometry.attributes.position.needsUpdate = true;
    }
  }
}
