import type { Vec } from '../world/map';
import type { CarCheck } from '../game/permit';

export type CarState = 'arriving' | 'parked' | 'leaving' | 'gone';

/** A car driving into a bay, sitting there, then leaving. angle 0 = nose pointing up the screen. */
export class Car {
  x: number;
  y: number;
  angle = Math.PI / 2;
  state: CarState = 'arriving';
  checked = false;
  leaveTimer = Infinity;
  private route: { p: Vec; reverse: boolean }[] = [];

  constructor(public readonly id: number, public readonly colour: number, public readonly bay: { id: string; x: number; y: number }, public readonly check: CarCheck, readonly ts: number) {
    const roadY = 21 * ts + ts / 2;
    const bayX = (bay.x + 1) * ts;
    const bayY = (bay.y + 1.5) * ts;
    this.x = -40;
    this.y = roadY;
    this.route = [
      { p: { x: bayX, y: roadY }, reverse: false },
      { p: { x: bayX, y: bayY }, reverse: false },
    ];
  }

  get parkedPos(): Vec {
    return { x: (this.bay.x + 1) * this.ts, y: (this.bay.y + 1.5) * this.ts };
  }

  /** Where Andy stands to check the permit: the pavement edge in front of the bay. */
  get checkPos(): Vec {
    return { x: (this.bay.x + 1) * this.ts, y: (this.bay.y + 1.5) * this.ts };
  }

  leave(worldW: number) {
    if (this.state === 'leaving' || this.state === 'gone') return;
    const roadY = 21 * this.ts + this.ts / 2;
    this.state = 'leaving';
    this.route = [
      { p: { x: this.x, y: roadY }, reverse: true },
      { p: { x: worldW + 40, y: roadY }, reverse: false },
    ];
  }

  update(dt: number) {
    if (this.state === 'parked') {
      this.leaveTimer -= dt;
      return;
    }
    const step = this.route[0];
    if (!step) {
      if (this.state === 'arriving') this.state = 'parked';
      else if (this.state === 'leaving') this.state = 'gone';
      return;
    }
    const dx = step.p.x - this.x, dy = step.p.y - this.y;
    const d = Math.hypot(dx, dy);
    const v = 70 * dt;
    if (d > 0.01) {
      const a = Math.atan2(dx, -dy);
      this.angle = step.reverse ? a + Math.PI : a;
    }
    if (d <= v) {
      this.x = step.p.x;
      this.y = step.p.y;
      this.route.shift();
    } else {
      this.x += (dx / d) * v;
      this.y += (dy / d) * v;
    }
  }
}
