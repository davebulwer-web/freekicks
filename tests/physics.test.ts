import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { BALL_RADIUS, Ball, SURFACES } from '../src/physics/Ball';
import { collideFrame, POST_X, POST_Z } from '../src/physics/GoalFrame';
import { computeKick } from '../src/sim/Kick';

const calm = { wind: new Vector3(), surface: SURFACES.clear };

function fly(ball: Ball, env = calm, untilZ = 0) {
  for (let i = 0; i < 2000 && ball.pos.z > untilZ; i++) ball.step(1 / 120, env);
  return ball.pos;
}

describe('ball physics', () => {
  it('positive swerve curls the ball to the kicker’s right', () => {
    const start = new Vector3(0, BALL_RADIUS, 20);
    const results = [-1, 0, 1].map((swerve) => {
      const b = new Ball();
      b.pos.copy(start);
      const k = computeKick(start, { height: 0.5, direction: 0.5, swerve, dip: 0 });
      b.vel.copy(k.vel);
      b.spin.copy(k.spin);
      return fly(b).x;
    });
    expect(Math.abs(results[1])).toBeLessThan(0.05);
    expect(results[2]).toBeGreaterThan(1.5);
    expect(results[0]).toBeLessThan(-1.5);
  });

  it('dip makes the ball drop: topspin crosses the goal line lower, backspin floats higher', () => {
    const start = new Vector3(0, BALL_RADIUS, 20);
    const [float, none, dip] = [-1, 0, 1].map((d) => {
      const b = new Ball();
      b.pos.copy(start);
      const k = computeKick(start, { height: 0.6, direction: 0.5, swerve: 0, dip: d });
      b.vel.copy(k.vel);
      b.spin.copy(k.spin);
      return fly(b).y;
    });
    expect(dip).toBeLessThan(none - 0.5);
    expect(float).toBeGreaterThan(none + 0.3);
  });

  it('wind pushes the ball downwind', () => {
    const b = new Ball();
    b.pos.set(0, BALL_RADIUS, 20);
    b.vel.set(0, 6, -24);
    fly(b, { wind: new Vector3(5, 0, 0), surface: SURFACES.clear });
    expect(b.pos.x).toBeGreaterThan(0.5);
  });

  it('drag slows the ball and gravity brings it down', () => {
    const b = new Ball();
    b.pos.set(0, BALL_RADIUS, 0);
    b.vel.set(0, 8, 25);
    for (let i = 0; i < 240; i++) b.step(1 / 120, calm);
    expect(b.vel.length()).toBeLessThan(25);
    expect(b.pos.y).toBeLessThan(5);
  });

  it('rolling ball eventually stops; snow stops it sooner than rain', () => {
    const roll = (surface: typeof SURFACES.clear) => {
      const b = new Ball();
      b.vel.set(0, 0, 10);
      for (let i = 0; i < 120 * 30; i++) b.step(1 / 120, { wind: new Vector3(), surface });
      return b.pos.z;
    };
    expect(roll(SURFACES.snow)).toBeLessThan(roll(SURFACES.rain));
  });

  it('bounces off a post', () => {
    const b = new Ball();
    b.pos.set(POST_X, 1, POST_Z + 0.25);
    b.vel.set(0, 0, -20);
    let hit = null;
    for (let i = 0; i < 20 && !hit; i++) {
      b.step(1 / 120, calm);
      hit = collideFrame(b);
    }
    expect(hit).toBe('post');
    expect(b.vel.z).toBeGreaterThan(0);
  });
});
