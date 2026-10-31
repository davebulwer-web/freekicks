import { describe, it, expect } from 'vitest';
import mapJson from '../src/data/map.json';
import charactersJson from '../src/data/characters.json';
import { TileMap, type MapData } from '../src/world/map';

const map = new TileMap(mapJson as unknown as MapData);
const tileIdx = (p: { x: number; y: number }) => Math.floor(p.y / map.ts) * map.w + Math.floor(p.x / map.ts);

describe('office map', () => {
  it('has rows of the declared size', () => {
    expect(mapJson.rows.length).toBe(map.h);
    for (const r of mapJson.rows) expect(r.length).toBe(map.w);
  });

  it('every point, desk seat and bay can be reached from Andy\'s desk', () => {
    const reach = map.reachable(map.seat('andy'));
    const pts = Object.entries(mapJson.points).filter(([k]) => !k.startsWith('car'));
    for (const [name] of pts) expect(reach.has(tileIdx(map.point(name))), name).toBe(true);
    for (const d of mapJson.desks) expect(reach.has(tileIdx(map.seat(d.id))), d.id).toBe(true);
    for (const b of mapJson.bays) expect(reach.has((b.y + 1) * map.w + b.x), b.id).toBe(true);
  });

  it('finds a path from Finance to the toilet', () => {
    const path = map.findPath(map.seat('fin1'), map.point('toilet'));
    expect(path).not.toBeNull();
    for (const p of path!) expect(map.blockedPx(p.x, p.y)).toBe(false);
  });

  it('puts the right rooms in the right places', () => {
    expect(map.roomAt(map.seat('andy'))?.id).toBe('it');
    expect(map.roomAt(map.point('kettle'))?.id).toBe('kitchen');
    expect(map.roomAt(map.point('toilet'))?.id).toBe('toilet');
    expect(map.roomAt(map.point('serverLounge'))?.id).toBe('server');
    expect(map.roomAt(map.seat('fin1'))?.id).toBe('finance');
  });

  it('gives every desk-owning character a real desk', () => {
    for (const c of charactersJson.characters) if ('desk' in c && c.desk) expect(() => map.desk(c.desk!)).not.toThrow();
  });
});
