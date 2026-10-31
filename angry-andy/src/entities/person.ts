import type { TileMap, Vec } from '../world/map';
import type { Rng } from '../core/rng';
import { pick, range } from '../core/rng';

export type Dir = 'down' | 'up' | 'left' | 'right';
export type Pose = 'stand' | 'walk' | 'work' | 'shout';

export interface Bubble { text: string; t: number; tone: 'andy' | 'npc' | 'fun' }

export class Person {
  dir: Dir = 'down';
  pose: Pose = 'stand';
  animT = 0;
  hidden = false;
  bubble: Bubble | null = null;

  constructor(public id: string, public name: string, public x: number, public y: number) {}

  say(text: string, secs = 2.6, tone: Bubble['tone'] = 'npc') {
    this.bubble = { text, t: secs, tone };
  }

  face(dx: number, dy: number) {
    if (Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01) return;
    this.dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up';
  }

  tickBubble(dt: number) {
    this.animT += dt;
    if (this.bubble && (this.bubble.t -= dt) <= 0) this.bubble = null;
  }
}

export type Activity = null | 'game' | 'football' | 'chat' | 'lounge' | 'toilet' | 'shower';

/** Office worker: sits at their desk, wanders to the printer/kitchen now and then, or follows a script. */
export class Npc extends Person {
  path: Vec[] | null = null;
  onArrive: (() => void) | null = null;
  /** True while an event is controlling this person. */
  busy = false;
  seated = false;
  activity: Activity = null;
  private idle = 0;
  private waiting = 0;
  private funT = 0;

  constructor(id: string, name: string, x: number, y: number, public readonly deskId: string | null, public readonly office: string, public speed: number) {
    super(id, name, x, y);
  }

  goTo(map: TileMap, to: Vec, onArrive?: () => void): boolean {
    const p = map.findPath({ x: this.x, y: this.y }, to);
    if (!p) return false;
    this.path = p;
    this.seated = false;
    this.waiting = 0;
    this.onArrive = onArrive ?? null;
    return true;
  }

  goHome(map: TileMap) {
    this.busy = false;
    this.activity = null;
    if (!this.deskId) return;
    this.goTo(map, map.seat(this.deskId), () => this.sitDown());
  }

  sitDown() {
    this.seated = true;
    this.dir = 'up';
    this.idle = 0;
  }

  update(dt: number, map: TileMap, rng: Rng, errands: Vec[]) {
    this.tickBubble(dt);
    if (this.hidden) return;
    if (this.path) {
      this.walk(dt);
      return;
    }
    this.pose = this.seated ? 'work' : 'stand';
    if (this.activity === 'chat') this.pose = 'shout';
    if (this.activity) {
      this.funT -= dt;
      if (this.funT <= 0) {
        this.funT = range(rng, 1.6, 3.2);
        const lines: Record<string, string[]> = {
          game: ['Headshot!', 'Pew pew!', 'One more level...'],
          football: ['GOAL!', 'Offside!', 'Come onnn!'],
          chat: ['HA HA HA!', 'No way!', 'LOL'],
          lounge: ['Zzz...', '*munch*', 'Zzz...'],
          toilet: ['*grunt*', '...', 'Hmm hmm hmm'],
          shower: ['La la la!', '*splash*', 'Ahhh...'],
        };
        this.say(pick(rng, lines[this.activity]), 1.5, 'fun');
      }
    }
    if (this.busy || !this.deskId) return;
    if (this.seated) {
      this.idle += dt;
      if (this.idle > 12 && rng() < dt / 25 && errands.length) {
        this.goTo(map, pick(rng, errands), () => (this.waiting = range(rng, 3, 7)));
      }
    } else if (this.waiting > 0) {
      this.waiting -= dt;
      if (this.waiting <= 0) this.goHome(map);
    } else if (!this.seated) {
      this.goHome(map);
    }
  }

  private walk(dt: number) {
    const target = this.path![0];
    const dx = target.x - this.x, dy = target.y - this.y;
    const d = Math.hypot(dx, dy);
    const stepLen = this.speed * dt;
    this.pose = 'walk';
    this.face(dx, dy);
    if (d <= stepLen) {
      this.x = target.x;
      this.y = target.y;
      this.path!.shift();
      if (!this.path!.length) {
        this.path = null;
        this.pose = 'stand';
        const cb = this.onArrive;
        this.onArrive = null;
        cb?.();
      }
    } else {
      this.x += (dx / d) * stepLen;
      this.y += (dy / d) * stepLen;
    }
  }
}

export class Andy extends Person {
  constructor(x: number, y: number) {
    super('andy', 'Andy', x, y);
  }

  /** Move with wall collision; feet box is 10x5 px. */
  move(dx: number, dy: number, map: TileMap) {
    const hw = 5, hh = 5;
    const nx = this.x + dx;
    if (!map.boxBlocked(nx - hw, this.y - hh, nx + hw, this.y)) this.x = nx;
    const ny = this.y + dy;
    if (!map.boxBlocked(this.x - hw, ny - hh, this.x + hw, ny)) this.y = ny;
  }
}
