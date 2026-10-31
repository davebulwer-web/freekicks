import { type Rng, pick } from '../core/rng';

export type PermitKind = 'staff' | 'visitor' | 'none';
export interface Permit {
  kind: PermitKind;
  plate: string;
  name: string;
  expires: Date | null;
}
export interface CarCheck {
  plate: string;
  permit: Permit;
  legit: boolean;
  /** Why it is not legit (for the result message). */
  problem: string | null;
}

const LETTERS = 'ABCDEFGHJKLMNOPRSTUVWXY';
const NAMES = ['K. Patel', 'S. Jones', 'M. Wright', 'D. Hughes', 'R. Clarke', 'J. Walsh', 'P. Green', 'L. Ahmed', 'T. Barnes', 'A. Moss'];

export function makePlate(rng: Rng): string {
  const l = () => LETTERS[Math.floor(rng() * LETTERS.length)];
  const d = () => String(Math.floor(rng() * 10));
  return `${l()}${l()}${d()}${d()} ${l()}${l()}${l()}`;
}

/** Same plate with one character changed: a cheeky borrowed permit. */
function nearPlate(rng: Rng, plate: string): string {
  const chars = [...plate];
  let i: number;
  do i = Math.floor(rng() * chars.length);
  while (chars[i] === ' ');
  const pool = /\d/.test(chars[i]) ? '0123456789' : LETTERS;
  let c: string;
  do c = pool[Math.floor(rng() * pool.length)];
  while (c === chars[i]);
  chars[i] = c;
  return chars.join('');
}

const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

/** A car turning up with (or without) a permit. Legit = staff/visitor permit for this plate, not expired. */
export function makeCarCheck(rng: Rng, today: Date, legitChance: number): CarCheck {
  const plate = makePlate(rng);
  const name = pick(rng, NAMES);
  if (rng() < legitChance) {
    const kind: PermitKind = rng() < 0.75 ? 'staff' : 'visitor';
    const expires = kind === 'staff' ? addDays(today, 10 + Math.floor(rng() * 300)) : today;
    return { plate, permit: { kind, plate, name, expires }, legit: true, problem: null };
  }
  const fault = pick(rng, ['expired', 'plate', 'none', 'visitor_old'] as const);
  if (fault === 'none') return { plate, permit: { kind: 'none', plate: '', name: '', expires: null }, legit: false, problem: 'No permit at all' };
  if (fault === 'plate')
    return { plate, permit: { kind: 'staff', plate: nearPlate(rng, plate), name, expires: addDays(today, 30 + Math.floor(rng() * 200)) }, legit: false, problem: "Permit is for a different car" };
  if (fault === 'visitor_old')
    return { plate, permit: { kind: 'visitor', plate, name, expires: addDays(today, -1 - Math.floor(rng() * 5)) }, legit: false, problem: 'Old visitor pass' };
  return { plate, permit: { kind: 'staff', plate, name, expires: addDays(today, -1 - Math.floor(rng() * 60)) }, legit: false, problem: 'Permit has expired' };
}

export function isCorrectDecision(check: CarCheck, allowed: boolean): boolean {
  return allowed === check.legit;
}

export function fmtDate(d: Date): string {
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}
