import { Quaternion, Vector3 } from 'three';
import type { Match } from '../sim/Match';
import type { AnimName } from '../sim/Person';

const ANIMS: AnimName[] = ['idle', 'run', 'kick', 'jump', 'dive_left', 'dive_right', 'celebrate', 'hold', 'down'];
const STRIDE = 6;

interface Frame {
  t: number;
  ball: Float32Array; // x y z qx qy qz qw
  people: Float32Array; // per person: x z jumpY heading anim animTime
  excitement: number;
}

export interface ReplayState {
  ballPos: Vector3;
  ballRot: Quaternion;
  people: { pos: Vector3; jumpY: number; heading: number; anim: string; animTime: number }[];
  netHits: { pos: Vector3; strength: number; t: number }[];
  /** Crowd excitement at this moment of the replay. */
  excitement: number;
}

/** Records a match at 60 Hz for replays; playback interpolates between frames. */
export class Recorder {
  frames: Frame[] = [];
  netHits: { pos: Vector3; strength: number; t: number }[] = [];
  /** Water splashes (time-stamped) to replay as particle bursts. */
  splashes: { pos: Vector3; strength: number; t: number }[] = [];
  private lastNet: unknown = null;

  capture(m: Match, excitement = 0) {
    const ball = new Float32Array([m.ball.pos.x, m.ball.pos.y, m.ball.pos.z, m.ball.rot.x, m.ball.rot.y, m.ball.rot.z, m.ball.rot.w]);
    const people = new Float32Array(m.people.length * STRIDE);
    m.people.forEach((p, i) => {
      people.set([p.pos.x, p.pos.z, p.jumpY, p.heading, ANIMS.indexOf(p.anim), p.animTime], i * STRIDE);
    });
    this.frames.push({ t: m.time, ball, people, excitement });
    if (m.netImpact && m.netImpact !== this.lastNet) {
      this.lastNet = m.netImpact;
      this.netHits.push({ pos: m.netImpact.pos.clone(), strength: m.netImpact.strength, t: m.netImpact.time });
    }
  }

  get start() {
    return this.frames[0]?.t ?? 0;
  }
  get end() {
    return this.frames[this.frames.length - 1]?.t ?? 0;
  }

  sample(t: number, out?: ReplayState): ReplayState {
    const fs = this.frames;
    let lo = 0, hi = fs.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (fs[mid].t <= t) lo = mid; else hi = mid;
    }
    const a = fs[lo], b = fs[hi];
    const k = b.t > a.t ? Math.min(1, Math.max(0, (t - a.t) / (b.t - a.t))) : 0;
    const n = a.people.length / STRIDE;
    const s: ReplayState = out && out.people.length === n && out.netHits === this.netHits ? out : {
      ballPos: new Vector3(),
      ballRot: new Quaternion(),
      people: Array.from({ length: n }, () => ({ pos: new Vector3(), jumpY: 0, heading: 0, anim: 'idle', animTime: 0 })),
      netHits: this.netHits,
      excitement: 0,
    };
    s.excitement = lerp(a.excitement, b.excitement, k);
    s.ballPos.set(lerp(a.ball[0], b.ball[0], k), lerp(a.ball[1], b.ball[1], k), lerp(a.ball[2], b.ball[2], k));
    s.ballRot.set(a.ball[3], a.ball[4], a.ball[5], a.ball[6]).slerp(new Quaternion(b.ball[3], b.ball[4], b.ball[5], b.ball[6]), k);
    for (let i = 0; i < n; i++) {
      const o = i * STRIDE;
      const p = s.people[i];
      p.pos.set(lerp(a.people[o], b.people[o], k), 0, lerp(a.people[o + 1], b.people[o + 1], k));
      p.jumpY = lerp(a.people[o + 2], b.people[o + 2], k);
      p.heading = a.people[o + 3];
      p.anim = ANIMS[a.people[o + 4]] ?? 'idle';
      p.animTime = a.people[o + 5] + (t - a.t);
    }
    return s;
  }
}

const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
