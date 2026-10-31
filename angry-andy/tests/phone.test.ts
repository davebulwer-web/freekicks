import { describe, it, expect } from 'vitest';
import { Game } from '../src/game/game';
import type { Input } from '../src/core/input';
import calls from '../src/data/phonecalls.json';

function fakeInput(): Input & { action: boolean } {
  return { ax: 0, ay: 0, action: false, clicks: [], touchMode: false, took: () => false, update() {}, endFrame() {} } as unknown as Input & { action: boolean };
}
const play = (g: Game, input: Input, secs: number) => { for (let i = 0; i < secs * 30; i++) g.update(1 / 30, input); };

/** Start a game with a phone call of the chosen kind ringing, needs reset so they don't interfere. */
function ringing(variant: 'desk' | 'mobile', seed = 21) {
  const g = new Game(null, seed);
  g.defs.phone.mobileChance = variant === 'mobile' ? 1 : 0;
  g.newGame();
  g.spawn('phone');
  g.defs.phone.mobileChance = 0.5;
  g.meters.anger = 50;
  g.meters.bladder = g.meters.thirst = 0;
  return g;
}

describe('phone calls', () => {
  it("includes Dave's requests", () => {
    for (const r of [
      'Can you connect my gym equipment to the internet?',
      'I need a full Office license.',
      'I poured coffee in my laptop.',
      'How do I make my CCTV work?',
      'I need AI to do my job for me.',
      'My eyes hurt from the new wallpaper.',
    ])
      expect(calls.requests).toContain(r);
  });

  it('answering the desk phone at the desk opens the call, and brushing off calms Andy', () => {
    const g = ringing('desk');
    const input = fakeInput();
    const seat = g.map.seat('andy');
    g.andy.x = seat.x;
    g.andy.y = seat.y;
    input.action = true;
    play(g, input, 0.6);
    expect(g.modal?.kind).toBe('phone');
    const m = g.modal as { request: string };
    expect(calls.requests).toContain(m.request);
    g.answerCall(true);
    expect(g.modal).toBeNull();
    expect(g.meters.anger).toBeLessThan(50);
    expect(g.tasks.some((t) => t.type === 'phone')).toBe(false);
    expect(g.brushOffsToday).toBe(1);
  });

  it('the desk phone cannot be answered from the car park, but the mobile can', () => {
    const desk = ringing('desk');
    const input = fakeInput();
    const bay = desk.map.point('frontDoor');
    desk.andy.x = bay.x;
    desk.andy.y = bay.y;
    input.action = true;
    play(desk, input, 0.6);
    expect(desk.modal).toBeNull();

    const mob = ringing('mobile');
    mob.andy.x = bay.x;
    mob.andy.y = bay.y;
    play(mob, input, 0.6);
    expect(mob.modal?.kind).toBe('phone');
  });

  it('logging a ticket winds Andy up a little', () => {
    const g = ringing('mobile');
    const input = fakeInput();
    input.action = true;
    play(g, input, 0.6);
    const before = g.meters.anger;
    g.answerCall(false);
    expect(g.meters.anger).toBeCloseTo(before + (g.defs.phone.ticketAnger ?? 3), 0);
    expect(g.brushOffsToday).toBe(0);
  });

  it('too many brush-offs and the boss wants a word', () => {
    const g = ringing('mobile');
    const input = fakeInput();
    input.action = true;
    for (let i = 0; i < (g.defs.phone.brushOffsBeforeBoss ?? 3); i++) {
      if (!g.tasks.some((t) => t.type === 'phone')) g.spawn('phone');
      g.tasks.filter((t) => t.type === 'phone').forEach((t) => (t.variant = 'mobile', t.radius = 1e6, t.target = () => ({ x: g.andy.x, y: g.andy.y })));
      play(g, input, 0.6);
      expect(g.modal?.kind).toBe('phone');
      g.answerCall(true);
    }
    expect(g.tasks.some((t) => t.type === 'boss')).toBe(true);
    expect(g.brushOffsToday).toBe(0);
  });

  it('an unanswered call costs anger', () => {
    const g = ringing('desk');
    const input = fakeInput();
    const before = g.meters.anger;
    play(g, input, 16);
    expect(g.tasks.some((t) => t.type === 'phone')).toBe(false);
    expect(g.stats.failed).toBeGreaterThanOrEqual(1);
    expect(g.meters.anger).toBeGreaterThan(before);
  });
});
