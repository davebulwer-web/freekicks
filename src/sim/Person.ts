import { Vector3 } from 'three';

export type Role = 'kicker' | 'attacker' | 'wall' | 'defender' | 'keeper' | 'referee';
export type Side = 'attack' | 'defence' | 'ref';
export type AnimName =
  | 'idle'
  | 'run'
  | 'kick'
  | 'jump'
  | 'dive_left'
  | 'dive_right'
  | 'celebrate'
  | 'hold'
  | 'down';

export class Person {
  pos = new Vector3();
  vel = new Vector3();
  /** Facing direction = (sin h, 0, cos h). */
  heading = 0;
  anim: AnimName = 'idle';
  animTime = 0;
  /** Explicit frame within the current anim (set by the sim for keeper dives); undefined = time-based. */
  frame?: number;
  /** Current hand height in metres (keeper dives), used to draw the sprite at the real reach. */
  reachY = 0;
  /** Vertical offset from jumping. */
  jumpY = 0;
  jumpVy = 0;
  height = 1.82;
  radius = 0.28;
  /** Seconds until this person may touch the ball again. */
  touchCooldown = 0;
  /** Free-form AI state. */
  ai: Record<string, number | string | boolean | undefined> = {};
  home = new Vector3();

  constructor(
    public id: number,
    public role: Role,
    public side: Side,
  ) {}

  setAnim(a: AnimName) {
    if (this.anim !== a) {
      this.anim = a;
      this.animTime = 0;
    }
  }

  jump(v = 3.2) {
    if (this.jumpY <= 0) {
      this.jumpVy = v;
      this.setAnim('jump');
    }
  }
}
