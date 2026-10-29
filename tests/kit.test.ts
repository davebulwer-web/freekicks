import { describe, expect, it } from 'vitest';
import teams from '../src/config/teams.json';
import { KIT_PATTERNS, type Team } from '../src/config/types';
import { kitPattern } from '../src/ui/kitPreview';

describe('kits', () => {
  it('preset teams are valid', () => {
    for (const t of teams as Team[]) {
      expect(KIT_PATTERNS).toContain(t.kit.pattern);
      for (const c of [t.kit.shirt1, t.kit.shirt2, t.kit.shorts, t.kit.socks, t.keeper.shirt1]) expect(c).toMatch(/^#[0-9a-f]{6}$/i);
      expect(t.short).toHaveLength(3);
    }
  });
  it('patterns produce both colours (except plain)', () => {
    for (let p = 0; p <= 4; p++) {
      const seen = new Set<number>();
      for (let u = 0; u < 1; u += 0.02) for (let v = 0; v < 1; v += 0.05) seen.add(kitPattern(u, v, p, 6));
      expect(seen.size).toBe(p === 0 ? 1 : 2);
    }
  });
});
