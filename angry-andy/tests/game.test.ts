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

  function play(g: Game, input: Input, secs: number) {
    for (let i = 0; i < secs * 30; i++) g.update(1 / 30, input);
  }

  it('signing invoices: the Finance lady walks to IT and Andy signs', () => {
    const g = new Game(null, 11);
    g.newGame();
    const input = fakeInput();
    g.spawn('invoice');
    const t = g.tasks.find((k) => k.type === 'invoice')!;
    expect(t.npc!.office).toBe('finance');
    play(g, input, 26);
    const spot = g.map.point('itInvoice');
    expect(Math.hypot(t.npc!.x - spot.x, t.npc!.y - spot.y)).toBeLessThan(2);
    g.andy.x = t.npc!.x - 10;
    g.andy.y = t.npc!.y;
    (input as { action: boolean }).action = true;
    play(g, input, 3);
    expect(g.tasks.includes(t)).toBe(false);
    expect(g.stats.done).toBe(1);
  });

  it('Amber: reaching the IT office corner completes the task, then she leaves', () => {
    const g = new Game(null, 12);
    g.newGame();
    const input = fakeInput();
    g.spawn('amber');
    const amber = g.npc('amber');
    expect(amber.hidden).toBe(false);
    const c = g.map.point('itCorner');
    g.andy.x = c.x;
    g.andy.y = c.y;
    (input as { action: boolean }).action = true;
    play(g, input, 1.5);
    expect(g.tasks.some((k) => k.type === 'amber')).toBe(false);
    expect(g.stats.done).toBe(1);
    (input as { action: boolean }).action = false;
    play(g, input, 12);
    expect(amber.hidden).toBe(true);
  });

  it('darts: a win calms Andy and a loss winds him up', () => {
    const darts = (win: number) => {
      const g = new Game(null, 13);
      g.defs.darts.winChance = win;
      g.newGame();
      const input = fakeInput();
      g.spawn('darts');
      const dave = g.npc('dave');
      play(g, input, 10);
      g.meters.anger = 50;
      g.meters.bladder = g.meters.thirst = 0;
      g.andy.x = dave.x;
      g.andy.y = dave.y + 8;
      (input as { action: boolean }).action = true;
      play(g, input, 1);
      expect(g.modal?.kind).toBe('darts');
      (input as { action: boolean }).action = false;
      play(g, input, 7);
      expect(g.modal).toBeNull();
      return g.meters.anger;
    };
    const before = 50;
    try {
      expect(darts(1)).toBeLessThan(before - 10);
      expect(darts(0)).toBeGreaterThan(before + 5);
    } finally {
      new Game(null, 1).defs.darts.winChance = 0.5;
    }
  });
});
