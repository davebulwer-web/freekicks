import { describe, it, expect, afterEach } from 'vitest';
import { Game } from '../src/game/game';
import type { Input } from '../src/core/input';
import phrases from '../src/data/catchphrases.json';
import calls from '../src/data/phonecalls.json';
import characters from '../src/data/characters.json';
import events from '../src/data/events.json';

function fakeInput(): Input & { action: boolean } {
  return { ax: 0, ay: 0, action: false, clicks: [], touchMode: false, took: () => false, update() {}, endFrame() {} } as unknown as Input & { action: boolean };
}
const play = (g: Game, input: Input, secs: number) => { for (let i = 0; i < secs * 30; i++) g.update(1 / 30, input); };

/** A game with needs and anger set so they don't interfere. `defs` is shared JSON, so tests restore it. */
function fresh(seed = 31) {
  const g = new Game(null, seed);
  g.newGame();
  g.meters.anger = 50;
  g.meters.bladder = g.meters.thirst = 0;
  return g;
}
const saved = JSON.parse(JSON.stringify(events));
afterEach(() => {
  const defs = new Game(null, 1).defs as unknown as Record<string, Record<string, number>>;
  for (const [k, v] of Object.entries(saved as Record<string, Record<string, number>>)) if (typeof v === 'object') Object.assign(defs[k], v);
});

describe('cast', () => {
  it('has Debbie, Simon, Emma and a bald boss', () => {
    const byId = Object.fromEntries(characters.characters.map((c) => [c.id, c]));
    expect(byId.debbie.name).toBe('Debbie');
    expect(byId.simon.office).toBe('middle');
    expect(byId.emma.name).toBe('Emma');
    expect(byId.boss.look.hair).toBe('bald');
  });

  it('Debbie always brings the invoices', () => {
    for (let s = 0; s < 5; s++) {
      const g = fresh(100 + s);
      g.spawn('invoice');
      expect(g.tasks.find((t) => t.type === 'invoice')!.npc!.id).toBe('debbie');
    }
  });

  it('Simon is usually the toilet culprit', () => {
    let simon = 0;
    for (let s = 0; s < 60; s++) {
      const g = fresh(200 + s);
      g.spawn('toilet');
      if (g.tasks.find((t) => t.type === 'toilet')!.npc!.id === 'simon') simon++;
    }
    expect(simon).toBeGreaterThan(30);
    expect(simon).toBeLessThan(60);
  });
});

describe('Amber lines', () => {
  it("come from catchphrases.json", () => {
    const g = fresh();
    g.spawn('amber');
    const c = g.map.point('itCorner');
    g.andy.x = c.x;
    g.andy.y = c.y;
    const input = fakeInput();
    input.action = true;
    play(g, input, 1.5);
    expect(phrases.amber).toContain(g.andy.bubble?.text);
  });
});

describe('cold calls', () => {
  function coldCall() {
    const g = fresh();
    g.defs.phone.coldCallChance = 1;
    g.defs.phone.mobileChance = 1;
    g.spawn('phone');
    const input = fakeInput();
    input.action = true;
    play(g, input, 0.6);
    expect(g.modal?.kind).toBe('phone');
    const m = g.modal as { caller: { cold: boolean; name: string }; request: string };
    expect(m.caller.cold).toBe(true);
    expect(calls.coldCallers).toContain(m.caller.name);
    expect(calls.coldCalls).toContain(m.request);
    return g;
  }

  it('hanging up calms Andy and does not count as a brush-off', () => {
    const g = coldCall();
    const before = g.meters.anger;
    g.answerCall(true);
    expect(g.meters.anger).toBeLessThan(before);
    expect(g.brushOffsToday).toBe(0);
  });

  it('hearing them out winds him up', () => {
    const g = coldCall();
    const before = g.meters.anger;
    g.answerCall(false);
    expect(g.meters.anger).toBeGreaterThan(before);
  });
});

describe("Emma's walk", () => {
  function walk(calmChance: number) {
    const g = fresh();
    g.defs.walk.calmChance = calmChance;
    g.spawn('walk');
    const emma = g.npc('emma');
    const input = fakeInput();
    play(g, input, 20);
    g.meters.anger = 50;
    g.meters.bladder = g.meters.thirst = 0;
    g.andy.x = emma.x - 8;
    g.andy.y = emma.y;
    input.action = true;
    play(g, input, 1.2);
    expect(g.modal?.kind).toBe('walk');
    expect(g.andy.hidden).toBe(true);
    input.action = false;
    play(g, input, 9);
    expect(g.modal).toBeNull();
    expect(g.andy.hidden).toBe(false);
    return g.meters.anger;
  }

  it('a good walk calms him', () => expect(walk(1)).toBeLessThan(45));
  it('a bad walk annoys him', () => expect(walk(0)).toBeGreaterThan(52));
});

describe('open-calls screen', () => {
  it('calls pile up while the team is away from their desks', () => {
    const g = fresh();
    for (const n of g.npcs.filter((k) => k.office === 'it')) n.busy = true; // e.g. all off having fun
    const before = g.openCalls;
    play(g, fakeInput(), 30);
    expect(g.openCalls).toBeGreaterThan(before + 1.5);
  });

  it('too many calls means a rant at the screen, which cuts the count', () => {
    const g = fresh();
    g.openCalls = g.tuning.screenRantAt + 1;
    play(g, fakeInput(), 0.1);
    const t = g.tasks.find((k) => k.type === 'screen');
    expect(t).toBeTruthy();
    const p = g.map.point('itScreen');
    g.andy.x = p.x;
    g.andy.y = p.y;
    const input = fakeInput();
    input.action = true;
    play(g, input, 2);
    expect(g.tasks.some((k) => k.type === 'screen')).toBe(false);
    expect(g.openCalls).toBeLessThan(4);
  });

  it('logging a ticket adds an open call', () => {
    const g = fresh();
    g.defs.phone.coldCallChance = 0;
    g.defs.phone.mobileChance = 1;
    g.spawn('phone');
    const input = fakeInput();
    input.action = true;
    play(g, input, 0.6);
    const before = g.openCalls;
    g.answerCall(false);
    expect(g.openCalls).toBeCloseTo(before + 1, 1);
  });
});

describe("Big Toe Dave's AI pictures", () => {
  it('make Andy laugh and calm down', () => {
    const g = fresh();
    g.spawn('aiimage');
    const dave = g.npc('dave');
    const input = fakeInput();
    play(g, input, 15);
    g.meters.anger = 50;
    g.meters.bladder = g.meters.thirst = 0;
    g.andy.x = dave.x - 8;
    g.andy.y = dave.y;
    input.action = true;
    play(g, input, 1);
    expect(g.tasks.some((t) => t.type === 'aiimage')).toBe(false);
    expect(g.aiCard).not.toBeNull();
    expect(phrases.aiImages).toContain(g.aiCard!.caption);
    expect(g.meters.anger).toBeLessThan(45);
  });
});
