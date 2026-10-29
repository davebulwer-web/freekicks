// Balance check: `npx vite-node tools/balance-sweep.ts` sweeps bar values and tallies outcomes per stage.
import { makeStage } from '../src/config/stages';
import modes from '../src/config/modes.json';
import { Match } from '../src/sim/Match';
import type { ModeConfig } from '../src/config/types';

const mode = modes[0] as ModeConfig;
for (const stageN of [1, 5, 10]) {
  const setup = makeStage(stageN, mode, 1234);
  const tally: Record<string, number> = {};
  const goodShots: string[] = [];
  for (let h = 0; h <= 1.001; h += 0.1)
    for (let d = 0; d <= 1.001; d += 0.1)
      for (const s of [-1, -0.5, 0, 0.5, 1]) {
        const m = new Match(setup);
        m.takeKick({ height: h, direction: d, swerve: s });
        let n = 0;
        while (!m.finished && n++ < 20000) m.step();
        const k = m.outcome!.kind + (m.outcome!.rebound ? '-reb' : '');
        tally[k] = (tally[k] ?? 0) + 1;
        if (m.outcome!.goal && !m.outcome!.rebound) goodShots.push(`h${h.toFixed(1)} d${d.toFixed(1)} s${s}`);
      }
  console.log('stage', stageN, JSON.stringify(setup.ballPos), 'wall', setup.wallSize, 'skill', setup.keeperSkill.toFixed(2), tally);
  console.log('  goals:', goodShots.slice(0, 40).join(', '));
}
