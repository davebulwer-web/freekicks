import { describe, it, expect } from 'vitest';
import { Game } from '../src/game/game';
import type { Input } from '../src/core/input';

function fakeInput(): Input {
  return { ax: 0, ay: 0, action: false, clicks: [], touchMode: false, took: () => false, update() {}, endFrame() {} } as unknown as Input;
}

describe('game simulation', () => {
  it('an idle Andy gets angrier as tasks expire, and every event type shows up', () => {
    const g = new Game(null, 123);
    g.newGame();
    const input = fakeInput();
    const seen = new Set<string>();
    let steps = 0;
    while (g.screen === 'playing' && steps < 20000) {
      g.update(1 / 30, input);
      for (const t of g.tasks) seen.add(t.type);
      steps++;
    }
    expect(g.stats.failed).toBeGreaterThan(3);
    expect(['gameover', 'dayEnd']).toContain(g.screen);
    expect(seen.size).toBeGreaterThanOrEqual(5);
  });

  it('tea and the loo relieve thirst and bladder', () => {
    const g = new Game(null, 5);
    g.newGame();
    const input = fakeInput();
    g.meters.thirst = 80;
    g.meters.bladder = 80;
    const kettle = g.map.point('kettle');
    g.andy.x = kettle.x;
    g.andy.y = kettle.y;
    (input as { action: boolean }).action = true;
    for (let i = 0; i < 120; i++) g.update(1 / 30, input);
    expect(g.meters.thirst).toBeLessThan(5);
    const loo = g.map.point('toilet');
    g.andy.x = loo.x;
    g.andy.y = loo.y;
    for (let i = 0; i < 100; i++) g.update(1 / 30, input);
    expect(g.meters.bladder).toBeLessThan(5);
  });

  it('a rant at the right person completes the task', () => {
    const g = new Game(null, 9);
    g.newGame();
    const input = fakeInput();
    g.spawn('rant');
    const t = g.tasks.find((k) => k.type === 'rant')!;
    expect(t).toBeTruthy();
    const anger = g.meters.anger;
    g.andy.x = t.npc!.x;
    g.andy.y = t.npc!.y + 4;
    (input as { action: boolean }).action = true;
    for (let i = 0; i < 80; i++) g.update(1 / 30, input);
    expect(g.tasks.includes(t)).toBe(false);
    expect(g.stats.done).toBe(1);
    expect(g.meters.anger).toBeLessThan(anger);
  });
});
