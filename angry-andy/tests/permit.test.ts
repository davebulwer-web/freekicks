import { describe, it, expect } from 'vitest';
import { makeCarCheck, isCorrectDecision } from '../src/game/permit';
import { makeRng } from '../src/core/rng';

describe('car permits', () => {
  const today = new Date(2025, 10, 3);
  it('legit permits match the plate and have not expired; dodgy ones say why', () => {
    const rng = makeRng(9);
    let legit = 0, bad = 0;
    for (let i = 0; i < 500; i++) {
      const c = makeCarCheck(rng, today, 0.5);
      if (c.legit) {
        legit++;
        expect(c.permit.plate).toBe(c.plate);
        expect(c.permit.expires!.getTime()).toBeGreaterThanOrEqual(today.getTime());
        expect(isCorrectDecision(c, true)).toBe(true);
      } else {
        bad++;
        expect(c.problem).toBeTruthy();
        const visibleFault = c.permit.kind === 'none' || c.permit.plate !== c.plate || c.permit.expires!.getTime() < today.getTime();
        expect(visibleFault).toBe(true);
        expect(isCorrectDecision(c, false)).toBe(true);
      }
    }
    expect(legit).toBeGreaterThan(150);
    expect(bad).toBeGreaterThan(150);
  });
});
