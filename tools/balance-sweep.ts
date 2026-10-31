// Balance check: `npx vite-node tools/balance-sweep.ts` sweeps ring values and tallies outcomes per stage.
import { makeStage } from '../src/config/stages';
import modes from '../src/config/modes.json';
import { Match } from '../src/sim/Match';
import type { ModeConfig } from '../src/config/types';

const mode = modes[0] as ModeConfig;
for (const stageN of [1, 5, 10]) {
  const setup = makeStage(stageN, mode, 1234);
  const byDip: Record<string, { goals: number; shots: number; heights: Set<string> }> = {};
  let total = 0, goals = 0;
  for (const dip of [-1, -0.5, 0, 0.5, 1]) {
    const row = (byDip[dip] = { goals: 0, shots: 0, heights: new Set<string>() });
    for (let h = 0; h <= 1.001; h += 0.1)
      for (let d = 0; d <= 1.001; d += 0.1)
        for (const s of [-1, -0.5, 0, 0.5, 1]) {
          const m = new Match(setup);
          m.takeKick({ height: h, direction: d, swerve: s, dip });
          let n = 0;
          while (!m.finished && n++ < 20000) m.step();
          row.shots++;
          total++;
          if (m.outcome!.goal && !m.outcome!.rebound) {
            row.goals++;
            goals++;
            row.heights.add(h.toFixed(1));
          }
        }
  }
  console.log(`stage ${stageN} wall ${setup.wallSize} keeper ${setup.keeperSkill.toFixed(2)}: ${((goals / total) * 100).toFixed(1)}% direct goals`);
  for (const [dip, r] of Object.entries(byDip))
    console.log(`  dip ${dip.padStart(4)}: ${((r.goals / r.shots) * 100).toFixed(1).padStart(4)}%  heights that scored: ${[...r.heights].sort().join(' ')}`);
}
