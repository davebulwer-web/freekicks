import { storage } from './storage';

export interface HighScore {
  name: string;
  score: number;
  stage: number;
  team: string;
  date: string;
}

const key = (mode: string) => `fk.highscores.${mode}`;

export const HighScores = {
  list(mode: string): HighScore[] {
    return storage.get<HighScore[]>(key(mode), []);
  },
  qualifies(mode: string, score: number): boolean {
    if (score <= 0) return false;
    const l = this.list(mode);
    return l.length < 10 || score > l[l.length - 1].score;
  },
  add(mode: string, entry: HighScore): HighScore[] {
    const l = [...this.list(mode), entry].sort((a, b) => b.score - a.score).slice(0, 10);
    storage.set(key(mode), l);
    return l;
  },
};
