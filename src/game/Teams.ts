import presets from '../config/teams.json';
import type { Kit, Team } from '../config/types';
import { storage } from './storage';

const CUSTOM_KEY = 'fk.teams.custom';
const SELECT_KEY = 'fk.teams.selection';

export const REFEREE_KIT: Kit = { pattern: 'plain', shirt1: '#151515', shirt2: '#151515', shorts: '#151515', socks: '#151515' };

export const Teams = {
  presets: presets as Team[],
  custom(): Team[] {
    return storage.get<Team[]>(CUSTOM_KEY, []);
  },
  all(): Team[] {
    const custom = this.custom();
    return [...custom, ...this.presets.filter((p) => !custom.some((c) => c.id === p.id))];
  },
  get(id: string): Team {
    return this.all().find((t) => t.id === id) ?? this.presets[0];
  },
  save(team: Team) {
    const list = this.custom().filter((t) => t.id !== team.id);
    list.unshift(team);
    storage.set(CUSTOM_KEY, list);
  },
  remove(id: string) {
    storage.set(CUSTOM_KEY, this.custom().filter((t) => t.id !== id));
  },
  selection(): { home: string; away: string } {
    return storage.get(SELECT_KEY, { home: this.presets[0].id, away: this.presets[1].id });
  },
  select(home: string, away: string) {
    storage.set(SELECT_KEY, { home, away });
  },
};
