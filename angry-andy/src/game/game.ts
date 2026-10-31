import mapJson from '../data/map.json';
import charactersJson from '../data/characters.json';
import tuningJson from '../data/tuning.json';
import eventsJson from '../data/events.json';
import phrasesJson from '../data/catchphrases.json';
import { TileMap, type MapData, type Vec } from '../world/map';
import { makeRng, pick, range, type Rng } from '../core/rng';
import { Andy, Npc } from '../entities/person';
import { Car } from '../entities/car';
import { PhraseRotator } from './catchphrases';
import { addAnger, tickNeeds, type Meters } from './meters';
import { Spawner, type EventDefs, type EventType } from './spawner';
import { makeCarCheck, isCorrectDecision } from './permit';
import type { Audio, Sfx } from '../core/audio';
import type { Input } from '../core/input';

export type Tuning = typeof tuningJson;
export type Screen = 'title' | 'playing' | 'paused' | 'dayEnd' | 'gameover';

export interface CharacterDef {
  id: string;
  name: string;
  role: string;
  office: string;
  desk?: string;
  rantTarget?: boolean;
  rantReason?: string;
}

export interface Task {
  id: number;
  type: EventType;
  title: string;
  detail: string;
  icon: string;
  portrait?: string;
  verb: string;
  timeLeft: number;
  timeLimit: number;
  hold: number;
  progress: number;
  phase: 'upcoming' | 'live';
  startsIn: number;
  radius: number;
  target: () => Vec | null;
  npc?: Npc;
  npc2?: Npc;
  car?: Car;
  variant?: string;
}

export interface Interactable {
  key: string;
  label: string;
  pos: Vec;
  hold: number;
  progress: number;
  task?: Task;
  kind: 'task' | 'toilet' | 'tea';
}

export type Modal =
  | { kind: 'car'; task: Task; car: Car }
  | { kind: 'boss'; t: number; total: number; line: string; task: Task }
  | { kind: 'darts'; t: number; total: number; task: Task; throws: DartThrow[]; win: boolean };

export interface DartThrow { who: 'andy' | 'dave'; score: number; dx: number; dy: number }

export interface Toast { text: string; x: number; y: number; t: number; colour: string }

export interface DayStats { done: number; failed: number; score: number }

const CAR_RADIUS = 30;

export class Game {
  readonly map: TileMap;
  readonly tuning: Tuning = tuningJson;
  readonly defs = eventsJson as unknown as EventDefs;
  readonly characters = charactersJson.characters as CharacterDef[];
  rng: Rng;
  screen: Screen = 'title';
  day = 1;
  clock = 0; // seconds into the working day
  score = 0;
  best = 0;
  stats: DayStats = { done: 0, failed: 0, score: 0 };
  meters: Meters = { anger: 0, bladder: 0, thirst: 0 };
  andy!: Andy;
  npcs: Npc[] = [];
  cars: Car[] = [];
  tasks: Task[] = [];
  modal: Modal | null = null;
  toasts: Toast[] = [];
  banner: { text: string; t: number } | null = null;
  near: Interactable | null = null;
  holding = false;
  deskScreens: Record<string, string> = {};
  toiletOutOfOrder = 0;
  intruderInside: Npc | null = null;
  slowed = false;
  result: { title: string; lines: string[] } | null = null;
  lastPhrase = '';

  private spawner!: Spawner;
  private callTimes: number[] = [];
  private callsQueued = 0;
  private nextId = 1;
  private amberLeave = 0;
  private carIds = 0;
  private teaProgress = 0;
  private looProgress = 0;
  private mutterT = 20;
  private stepT = 0;
  private catchphrases: PhraseRotator;
  private grumbles: PhraseRotator;
  private excuses: PhraseRotator;
  private bossLines: PhraseRotator;

  constructor(private readonly audio: Audio | null, seed = Date.now()) {
    this.map = new TileMap(mapJson as unknown as MapData);
    this.rng = makeRng(seed);
    this.catchphrases = new PhraseRotator(phrasesJson.catchphrases, this.rng);
    this.grumbles = new PhraseRotator(phrasesJson.grumbles, this.rng);
    this.excuses = new PhraseRotator(phrasesJson.excuses, this.rng);
    this.bossLines = new PhraseRotator(phrasesJson.boss, this.rng);
    try { this.best = Number(localStorage.getItem('andy.best') || 0); } catch { /* storage blocked */ }
    this.resetWorld();
  }

  // ------------------------------------------------------------ lifecycle

  newGame() {
    this.day = 1;
    this.score = 0;
    this.meters = { anger: this.tuning.startAnger, bladder: 0, thirst: 0 };
    this.startDay();
  }

  startDay() {
    this.resetWorld();
    this.clock = 0;
    this.stats = { done: 0, failed: 0, score: 0 };
    this.meters.bladder = this.tuning.needsStartBladder;
    this.meters.thirst = this.tuning.needsStartThirst;
    this.spawner = new Spawner(this.rng, this.tuning, this.defs, this.day);
    this.callTimes = this.spawner.scheduleCalls();
    this.callsQueued = 0;
    this.screen = 'playing';
    this.banner = { text: `DAY ${this.day} - ${this.dateLabel()}`, t: 3 };
    this.andy.say(this.day === 1 ? 'Right. Another day...' : 'Back again. Marvellous.', 3, 'andy');
  }

  nextDay() {
    this.day++;
    this.meters.anger *= this.tuning.angerCarryOver;
    this.startDay();
  }

  private resetWorld() {
    const seat = this.map.seat('andy');
    this.andy = new Andy(seat.x, seat.y + 2);
    this.andy.dir = 'up';
    this.npcs = [];
    for (const c of this.characters) {
      if (c.id === 'andy' || c.office === 'upstairs') continue;
      const p = c.desk ? this.map.seat(c.desk) : this.map.point('outsideLeft');
      const n = new Npc(c.id, c.name, p.x, p.y, c.desk ?? null, c.office, this.tuning.npcSpeed * range(this.rng, 0.85, 1.1));
      if (c.desk) n.sitDown();
      else n.hidden = true;
      this.npcs.push(n);
    }
    this.cars = [];
    this.tasks = [];
    this.modal = null;
    this.toasts = [];
    this.deskScreens = {};
    this.toiletOutOfOrder = 0;
    this.intruderInside = null;
    this.near = null;
    this.result = null;
    this.amberLeave = 0;
  }

  dateLabel(): string {
    const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
    return days[(this.day - 1) % 5];
  }

  today(): Date {
    const base = new Date(2025, 10, 3); // a Monday
    const n = this.day - 1;
    return new Date(base.getFullYear(), base.getMonth(), base.getDate() + n + 2 * Math.floor(n / 5));
  }

  get dayFrac(): number {
    return Math.min(1, this.clock / this.tuning.dayLengthSeconds);
  }

  clockLabel(): string {
    const mins = this.tuning.dayStartHour * 60 + this.dayFrac * (this.tuning.dayEndHour - this.tuning.dayStartHour) * 60;
    const h = Math.floor(mins / 60), m = Math.floor(mins % 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  /** Game-clock label for a day fraction, e.g. a video call start. */
  timeAt(frac: number): string {
    const mins = this.tuning.dayStartHour * 60 + frac * (this.tuning.dayEndHour - this.tuning.dayStartHour) * 60;
    return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(Math.floor(mins % 60)).padStart(2, '0')}`;
  }

  npc(id: string): Npc {
    const n = this.npcs.find((k) => k.id === id);
    if (!n) throw new Error(`No npc ${id}`);
    return n;
  }

  private sfx(s: Sfx) {
    this.audio?.play(s);
  }

  toast(text: string, at: Vec, colour = '#fff') {
    this.toasts.push({ text, x: at.x, y: at.y - 28, t: 1.6, colour });
  }

  // ------------------------------------------------------------ main update

  update(dt: number, input: Input) {
    if (input.took('mute')) this.audio?.toggleMute();
    if (this.screen === 'playing' && input.took('pause')) {
      this.screen = 'paused';
      return;
    }
    if (this.screen === 'paused') {
      if (input.took('pause') || input.took('action') || input.clicks.length) this.screen = 'playing';
      return;
    }
    if (this.screen !== 'playing') return;

    if (this.modal?.kind === 'car') {
      this.updateCarModal(input);
      return; // world pauses while Andy reads the permit
    }

    this.clock += dt;
    for (const t of this.toasts) { t.t -= dt; t.y -= 14 * dt; }
    this.toasts = this.toasts.filter((t) => t.t > 0);
    if (this.banner && (this.banner.t -= dt) <= 0) this.banner = null;
    if (this.toiletOutOfOrder > 0) this.toiletOutOfOrder -= dt;

    // needs
    const needs = tickNeeds(this.meters, dt, this.tuning);
    this.slowed = needs.bladderFull || needs.thirstFull;

    this.updateAndy(dt, input);
    const errands = (office: string) =>
      office === 'finance' ? ['printerFinance', 'kitchenChat', 'cooler'] : office === 'middle' ? ['printerMiddle', 'kitchenChat', 'cooler'] : ['kitchenChat', 'printerMiddle'];
    for (const n of this.npcs) n.update(dt, this.map, this.rng, errands(n.office).map((p) => this.map.point(p)));
    for (const c of this.cars) {
      c.update(dt);
      if (c.state === 'parked' && c.leaveTimer <= 0) c.leave(this.map.w * this.map.ts);
    }
    this.cars = this.cars.filter((c) => c.state !== 'gone');

    this.updateTasks(dt);
    this.updateSpawning(dt);

    if (this.amberLeave > 0 && (this.amberLeave -= dt) <= 0) this.sendAmberAway();
    if (this.modal?.kind === 'darts') {
      this.modal.t -= dt;
      if (this.modal.t <= 0) this.resolveDarts();
    }
    if (this.modal?.kind === 'boss') {
      this.modal.t -= dt;
      if (this.modal.t <= 0) {
        const task = this.modal.task;
        this.modal = null;
        const p = this.map.point('stairs');
        this.andy.hidden = false;
        this.andy.x = p.x;
        this.andy.y = p.y + 10;
        this.andy.dir = 'down';
        this.completeTask(task);
      }
    }

    if (this.meters.anger >= 100) this.meltdown();
    else if (this.clock >= this.tuning.dayLengthSeconds) this.endDay();
  }

  private updateAndy(dt: number, input: Input) {
    const a = this.andy;
    a.tickBubble(dt);
    if (a.hidden) return;
    if (this.modal?.kind === 'darts') {
      this.near = null;
      this.holding = false;
      a.dir = 'up';
      a.pose = 'work';
      return;
    }
    this.near = this.findInteractable();
    this.holding = false;
    if (input.action && this.near) {
      this.holding = true;
      this.doHold(this.near, dt);
      return;
    }
    if (!input.action) { this.teaProgress = 0; this.looProgress = 0; }
    const speed = this.tuning.andySpeed * (this.slowed ? this.tuning.andySlowFactor : 1);
    if (input.ax || input.ay) {
      a.move(input.ax * speed * dt, input.ay * speed * dt, this.map);
      a.face(input.ax, input.ay);
      a.pose = 'walk';
      this.stepT -= dt;
      if (this.stepT <= 0) { this.stepT = 0.3; this.sfx('step'); }
      this.mutterT -= dt;
      if (this.mutterT <= 0 && !a.bubble) {
        const [lo, hi] = this.tuning.muttersEverySeconds;
        this.mutterT = range(this.rng, lo, hi);
        this.sayCatchphrase();
      }
    } else {
      a.pose = 'stand';
    }
  }

  sayCatchphrase() {
    this.lastPhrase = this.catchphrases.next();
    this.andy.say(this.lastPhrase, 2.8, 'andy');
  }

  private findInteractable(): Interactable | null {
    const a = { x: this.andy.x, y: this.andy.y };
    const r = this.tuning.interactRadius;
    const cands: Interactable[] = [];
    for (const t of this.tasks) {
      if (t.phase !== 'live') continue;
      const p = t.target();
      if (!p || dist(a, p) > t.radius) continue;
      cands.push({ key: `task${t.id}`, label: t.verb, pos: p, hold: t.hold, progress: t.progress, task: t, kind: 'task' });
    }
    const loo = this.map.point('toilet');
    if (dist(a, loo) <= r && this.meters.bladder >= this.tuning.needMinimumToUse && this.toiletOutOfOrder <= 0 && !this.intruderInside)
      cands.push({ key: 'loo', label: 'Use the loo', pos: loo, hold: this.tuning.toiletSeconds, progress: this.looProgress, kind: 'toilet' });
    const kettle = this.map.point('kettle');
    if (dist(a, kettle) <= r && this.meters.thirst >= this.tuning.needMinimumToUse)
      cands.push({ key: 'tea', label: 'Make tea', pos: kettle, hold: this.tuning.teaSeconds, progress: this.teaProgress, kind: 'tea' });
    if (!cands.length) return null;
    cands.sort((p, q) => dist(a, p.pos) - dist(a, q.pos));
    return cands[0];
  }

  private doHold(it: Interactable, dt: number) {
    const a = this.andy;
    a.face(it.pos.x - a.x, it.pos.y - a.y);
    const loud = it.task && ['rant', 'toilet', 'fun', 'shower'].includes(it.task.type);
    a.pose = loud ? 'shout' : a.dir === 'up' ? 'work' : 'stand';
    const inc = dt / it.hold;
    if (it.kind === 'tea') {
      this.teaProgress += inc;
      it.progress = this.teaProgress;
      if (this.teaProgress >= 1) {
        this.teaProgress = 0;
        this.meters.thirst = 0;
        addAnger(this.meters, -this.tuning.teaCalm);
        this.sfx('tea');
        a.say('Ahh. Proper tea.', 2, 'andy');
        this.toast(`-${this.tuning.teaCalm} anger`, a, '#8f8');
      }
    } else if (it.kind === 'toilet') {
      this.looProgress += inc;
      it.progress = this.looProgress;
      if (this.looProgress >= 1) {
        this.looProgress = 0;
        this.meters.bladder = 0;
        this.sfx('flush');
        a.say('That\'s better.', 2, 'andy');
      }
    } else if (it.task) {
      const t = it.task;
      t.progress += inc;
      it.progress = t.progress;
      if (t.type === 'video') this.deskScreens.andy = 'call';
      if (t.progress >= 1) {
        t.progress = 1;
        this.finishHold(t);
      }
    }
  }

  // ------------------------------------------------------------ tasks

  private updateTasks(dt: number) {
    // queue scheduled video calls ahead of time
    while (this.callsQueued < this.callTimes.length) {
      const at = this.callTimes[this.callsQueued];
      const warnFrac = this.tuning.videoCallWarningSeconds / this.tuning.dayLengthSeconds;
      if (this.dayFrac < at - warnFrac) break;
      this.callsQueued++;
      this.spawnVideo(at);
    }
    for (const t of [...this.tasks]) {
      if (t.phase === 'upcoming') {
        t.startsIn -= dt;
        if (t.startsIn <= 0) {
          t.phase = 'live';
          this.sfx('alert');
          this.banner = { text: 'Video call starting - get to your desk!', t: 2.5 };
        }
        continue;
      }
      t.timeLeft -= dt;
      if (t.timeLeft <= 0) this.failTask(t);
    }
  }

  private updateSpawning(dt: number) {
    const live = this.tasks.filter((t) => t.type !== 'video').length;
    const type = this.spawner.update(dt, this.dayFrac, live, (k) => this.canSpawn(k));
    if (!type) return;
    this.spawn(type);
  }

  /** Free = not hidden and not already in someone's event. */
  private freeNpcs(filter: (n: Npc) => boolean): Npc[] {
    return this.npcs.filter((n) => !n.busy && !n.hidden && n.deskId && filter(n) && !this.tasks.some((t) => t.npc === n || t.npc2 === n));
  }

  canSpawn(type: EventType): boolean {
    const has = (k: EventType) => this.tasks.some((t) => t.type === k);
    if (this.dayFrac > 0.97) return false;
    switch (type) {
      case 'car': return this.freeBays().length > 0 && this.tasks.filter((t) => t.type === 'car').length < 2;
      case 'toilet': return !has('toilet') && this.toiletOutOfOrder <= 0 && this.freeNpcs((n) => n.office !== 'it').length > 0;
      case 'rant': return this.tasks.filter((t) => t.type === 'rant').length < 2 && this.rantTargets().length > 0;
      case 'fun': return !has('fun') && this.freeNpcs((n) => n.office === 'it').length > 0;
      case 'boss': return !has('boss') && !this.modal;
      case 'shower': return !has('shower') && this.npcs.some((n) => n.id === 'lee' && n.hidden);
      case 'invoice': return !has('invoice') && this.freeNpcs((n) => n.office === 'finance').length > 0;
      case 'darts': return !has('darts') && !this.modal && this.freeNpcs((n) => n.id === 'dave').length > 0;
      case 'amber': return !has('amber') && this.amberLeave <= 0 && this.npcs.some((n) => n.id === 'amber' && n.hidden);
      case 'video': return false;
    }
  }

  private freeBays() {
    return this.map.data.bays.filter((b) => !this.cars.some((c) => c.bay.id === b.id));
  }

  private rantTargets(): Npc[] {
    const ids = this.characters.filter((c) => c.rantTarget).map((c) => c.id);
    return this.freeNpcs((n) => ids.includes(n.id));
  }

  spawn(type: EventType) {
    switch (type) {
      case 'car': this.spawnCar(); break;
      case 'toilet': this.spawnToilet(); break;
      case 'rant': this.spawnRant(); break;
      case 'fun': this.spawnFun(); break;
      case 'boss': this.spawnBoss(); break;
      case 'shower': this.spawnShower(); break;
      case 'invoice': this.spawnInvoice(); break;
      case 'darts': this.spawnDarts(); break;
      case 'amber': this.spawnAmber(); break;
      case 'video': this.spawnVideo(this.dayFrac + this.tuning.videoCallWarningSeconds / this.tuning.dayLengthSeconds); break;
    }
  }

  private baseTask(type: EventType, fields: Partial<Task> & Pick<Task, 'title' | 'detail' | 'icon' | 'verb' | 'target'>): Task {
    const d = this.defs[type];
    const limit = this.spawner.timeLimit(type);
    const t: Task = {
      id: this.nextId++,
      type,
      timeLeft: limit,
      timeLimit: limit,
      hold: d.hold,
      progress: 0,
      phase: 'live',
      startsIn: 0,
      radius: this.tuning.interactRadius,
      ...fields,
    };
    this.tasks.push(t);
    if (t.phase === 'live') this.sfx('alert');
    return t;
  }

  private spawnCar() {
    const bay = pick(this.rng, this.freeBays());
    const check = makeCarCheck(this.rng, this.today(), this.defs.car.legitChance ?? 0.55);
    const car = new Car(++this.carIds, Math.floor(this.rng() * 8), bay, check, this.map.ts);
    this.cars.push(car);
    this.sfx('car');
    this.baseTask('car', {
      title: 'Car arriving',
      detail: `Check permit: ${check.plate}`,
      icon: 'car',
      verb: 'Check permit',
      radius: CAR_RADIUS,
      car,
      target: () => (car.state === 'parked' ? car.checkPos : null),
    });
  }

  private spawnToilet() {
    const n = pick(this.rng, this.freeNpcs((k) => k.office !== 'it'));
    n.busy = true;
    n.goTo(this.map, this.map.point('toilet'), () => {
      this.intruderInside = n;
      n.activity = 'toilet';
      n.dir = 'down';
    });
    n.say('Nature calls...', 2);
    this.baseTask('toilet', {
      title: 'Loo alert!',
      detail: `${n.name} is off to make a mess`,
      icon: 'toilet',
      portrait: n.id,
      verb: `Chase ${first(n.name)} out`,
      npc: n,
      target: () => ({ x: n.x, y: n.y }),
    });
  }

  private spawnRant() {
    const n = pick(this.rng, this.rantTargets());
    const c = this.characters.find((k) => k.id === n.id)!;
    this.baseTask('rant', {
      title: `Rant at ${n.name}`,
      detail: c.rantReason ?? 'They know what they did.',
      icon: 'rant',
      portrait: n.id,
      verb: `Rant at ${first(n.name)}`,
      npc: n,
      radius: this.tuning.interactRadius + 4,
      target: () => ({ x: n.x, y: n.y }),
    });
  }

  private spawnFun() {
    const free = this.freeNpcs((n) => n.office === 'it');
    const n = pick(this.rng, free);
    const variants = ['game', 'football', 'lounge'];
    if (free.length >= 2) variants.push('chat');
    const v = pick(this.rng, variants) as 'game' | 'football' | 'lounge' | 'chat';
    n.busy = true;
    const task: Partial<Task> & Pick<Task, 'title' | 'detail' | 'icon' | 'verb' | 'target'> = {
      title: '',
      detail: '',
      icon: 'fun',
      portrait: n.id,
      verb: 'Stop that!',
      npc: n,
      variant: v,
      target: () => ({ x: n.x, y: n.y }),
    };
    if (v === 'game' || v === 'football') {
      n.goTo(this.map, this.map.seat(n.deskId!), () => {
        n.sitDown();
        n.activity = v;
        this.deskScreens[n.deskId!] = v;
      });
      task.title = v === 'game' ? 'Gaming at work!' : 'Watching the footy!';
      task.detail = `${n.name} is ${v === 'game' ? 'playing games' : 'streaming football'}`;
    } else if (v === 'lounge') {
      n.goTo(this.map, this.map.point('serverLounge'), () => {
        n.activity = 'lounge';
        n.dir = 'down';
      });
      task.title = 'Skiving in the server room';
      task.detail = `${n.name} is lounging on the beanbag`;
    } else {
      const m = pick(this.rng, free.filter((k) => k !== n));
      m.busy = true;
      const spot = this.map.point('itChat');
      n.goTo(this.map, { x: spot.x - 10, y: spot.y }, () => { n.activity = 'chat'; n.dir = 'right'; });
      m.goTo(this.map, { x: spot.x + 10, y: spot.y }, () => { m.activity = 'chat'; m.dir = 'left'; });
      task.npc2 = m;
      task.title = 'Having a laugh';
      task.detail = `${first(n.name)} and ${first(m.name)} are chatting`;
    }
    this.baseTask('fun', task);
  }

  private spawnVideo(atFrac: number) {
    const seat = this.map.seat('andy');
    const startsIn = Math.max(1, (atFrac - this.dayFrac) * this.tuning.dayLengthSeconds);
    this.baseTask('video', {
      title: `Video call ${this.timeAt(atFrac)}`,
      detail: 'Be at your desk, then hold to sit through it',
      icon: 'video',
      verb: 'Sit through the call',
      phase: 'upcoming',
      startsIn,
      radius: 14,
      target: () => ({ x: seat.x, y: seat.y }),
    });
    this.sfx('alert');
  }

  private spawnBoss() {
    this.baseTask('boss', {
      title: 'Boss wants you',
      detail: 'Go upstairs to see the boss',
      icon: 'boss',
      portrait: 'boss',
      verb: 'Go upstairs',
      target: () => this.map.point('stairs'),
    });
    this.banner = { text: 'The boss wants a word upstairs...', t: 2.5 };
  }

  private spawnShower() {
    const lee = this.npc('lee');
    const start = this.map.point('outsideLeft');
    lee.hidden = false;
    lee.busy = true;
    lee.x = start.x;
    lee.y = start.y;
    lee.goTo(this.map, this.map.point('showerDoor'), () => {
      lee.activity = 'shower';
      lee.dir = 'down';
    });
    lee.say('Just did 40 miles!', 2.5);
    this.baseTask('shower', {
      title: 'Shower hog',
      detail: 'Lycra Lee is hogging the shower',
      icon: 'shower',
      portrait: 'lee',
      verb: 'Evict Lee',
      npc: lee,
      target: () => ({ x: lee.x, y: lee.y }),
    });
  }

  private spawnInvoice() {
    const n = pick(this.rng, this.freeNpcs((k) => k.office === 'finance'));
    n.busy = true;
    n.goTo(this.map, this.map.point('itInvoice'), () => {
      n.dir = 'right';
      n.say('Invoices to sign, Andy!', 2.5);
    });
    n.say('Where is he...', 2);
    this.baseTask('invoice', {
      title: 'Sign invoices',
      detail: `${n.name} needs your signature`,
      icon: 'invoice',
      portrait: n.id,
      verb: 'Sign invoices',
      npc: n,
      target: () => ({ x: n.x, y: n.y }),
    });
  }

  private spawnDarts() {
    const dave = this.npc('dave');
    dave.busy = true;
    dave.goTo(this.map, this.map.point('dartsOche'), () => {
      dave.dir = 'up';
      dave.say('Fancy a game of arrows, Andy?', 3);
    });
    this.baseTask('darts', {
      title: 'Darts challenge',
      detail: 'Big Toe Dave wants a game. Win to calm down',
      icon: 'darts',
      portrait: 'dave',
      verb: 'Play darts',
      npc: dave,
      target: () => ({ x: dave.x, y: dave.y }),
    });
  }

  private spawnAmber() {
    const amber = this.npc('amber');
    const start = this.map.point('outsideRight');
    amber.hidden = false;
    amber.busy = true;
    amber.x = start.x;
    amber.y = start.y;
    amber.goTo(this.map, this.map.point('amberSpot'), () => {
      amber.dir = 'down';
      amber.activity = 'phone';
    });
    this.baseTask('amber', {
      title: "Amber's outside",
      detail: 'Get to the IT office corner before she goes',
      icon: 'window',
      portrait: 'amber',
      verb: 'Lean casually in the corner',
      radius: 14,
      target: () => this.map.point('itCorner'),
    });
  }

  private sendAmberAway() {
    this.amberLeave = 0;
    const amber = this.npc('amber');
    if (amber.hidden) return;
    amber.activity = null;
    amber.goTo(this.map, this.map.point('outsideRight'), () => { amber.hidden = true; amber.busy = false; });
  }

  /** Three darts each, revealed in turn. The winner is decided first, then the scores are made to fit. */
  private makeDarts(): { throws: DartThrow[]; win: boolean } {
    const win = this.rng() < (this.defs.darts.winChance ?? 0.5);
    const one = () => {
      const r = this.rng();
      if (r < 0.08) return 0;
      if (r < 0.14) return this.rng() < 0.3 ? 50 : 25;
      const seg = 1 + Math.floor(this.rng() * 20);
      const m = this.rng();
      return seg * (m < 0.7 ? 1 : m < 0.85 ? 2 : 3);
    };
    let a: number[], d: number[];
    const sum = (k: number[]) => k.reduce((x, y) => x + y, 0);
    do { a = [one(), one(), one()]; d = [one(), one(), one()]; } while (sum(a) === sum(d));
    if ((sum(a) > sum(d)) !== win) [a, d] = [d, a];
    const jit = () => (this.rng() - 0.5) * 9;
    const throws: DartThrow[] = [];
    for (let i = 0; i < 3; i++) {
      throws.push({ who: 'andy', score: a[i], dx: jit(), dy: jit() });
      throws.push({ who: 'dave', score: d[i], dx: jit(), dy: jit() });
    }
    return { throws, win };
  }

  /** How many darts have landed so far in the current game. */
  dartsShown(m: Extract<Modal, { kind: 'darts' }>): number {
    return Math.min(6, Math.floor(((m.total - m.t) / m.total) * 7.5));
  }

  private resolveDarts() {
    const m = this.modal as Extract<Modal, { kind: 'darts' }>;
    this.modal = null;
    const d = this.defs.darts;
    const dave = this.npc('dave');
    const a = this.andy;
    this.stats.done++;
    if (m.win) {
      addAnger(this.meters, -(d.calmOnWin ?? 14));
      this.score += d.score;
      this.stats.score += d.score;
      this.sfx('done');
      this.toast(`Andy wins! +${d.score}`, a, '#ff6');
      if (this.rng() < 0.5) a.say('Game shot!', 2.4, 'andy');
      else this.sayCatchphrase();
      dave.say('Best of three?', 2.4);
    } else {
      addAnger(this.meters, d.angerOnLoss ?? 10);
      this.sfx('wrong');
      this.toast(`Dave wins. +${d.angerOnLoss ?? 10} anger`, a, '#f88');
      a.say(this.grumbles.next(), 2.4, 'andy');
      dave.say('Get in! Big Toe Dave!', 2.4);
    }
    dave.goHome(this.map);
  }

  /** Andy has finished holding the action on a task. */
  private finishHold(t: Task) {
    if (t.type === 'car') {
      this.modal = { kind: 'car', task: t, car: t.car! };
      this.sfx('click');
      return;
    }
    if (t.type === 'darts') {
      const spot = this.map.point('dartsAndy');
      this.andy.x = spot.x;
      this.andy.y = spot.y;
      this.andy.dir = 'up';
      t.npc!.dir = 'up';
      const total = this.defs.darts.gameSeconds ?? 6;
      this.modal = { kind: 'darts', t: total, total, task: t, ...this.makeDarts() };
      this.tasks = this.tasks.filter((k) => k !== t);
      this.sfx('click');
      return;
    }
    if (t.type === 'amber') {
      this.completeTask(t, pick(this.rng, ['Ahh, lovely weather today.', 'Just checking the window seals.', 'Nice view from here.']));
      this.amberLeave = 4;
      return;
    }
    if (t.type === 'boss') {
      this.andy.hidden = true;
      this.sfx('boss');
      this.modal = { kind: 'boss', t: this.tuning.bossMeetingSeconds, total: this.tuning.bossMeetingSeconds, line: this.bossLines.next(), task: t };
      this.tasks = this.tasks.filter((k) => k !== t);
      return;
    }
    this.completeTask(t);
  }

  private updateCarModal(input: Input) {
    const m = this.modal as { kind: 'car'; task: Task; car: Car };
    let choice: boolean | null = null;
    if (input.took('allow') || input.took('left')) choice = true;
    if (input.took('deny') || input.took('right')) choice = false;
    for (const c of input.clicks) {
      const b = carModalButtons();
      if (inRect(c, b.allow)) choice = true;
      if (inRect(c, b.deny)) choice = false;
    }
    if (choice === null) return;
    this.modal = null;
    const { task, car } = m;
    car.checked = true;
    if (choice) car.leaveTimer = range(this.rng, 40, 90);
    else car.leave(this.map.w * this.map.ts);
    if (isCorrectDecision(car.check, choice)) {
      this.completeTask(task, choice ? 'Fine. Park there.' : 'Not today, sunshine!');
    } else {
      this.tasks = this.tasks.filter((k) => k !== task);
      this.stats.failed++;
      addAnger(this.meters, this.defs.car.angerOnWrong ?? 10);
      this.sfx('wrong');
      const why = car.check.legit ? 'They had a valid permit!' : car.check.problem ?? 'Dodgy permit!';
      this.toast(`Wrong call! ${why}`, this.andy, '#f88');
      this.andy.say(this.grumbles.next(), 2, 'andy');
    }
  }

  private completeTask(t: Task, line?: string) {
    this.tasks = this.tasks.filter((k) => k !== t);
    const d = this.defs[t.type];
    addAnger(this.meters, -d.calm);
    const pts = Math.round(d.score * (0.5 + 0.5 * Math.max(0, t.timeLeft) / t.timeLimit));
    this.score += pts;
    this.stats.score += pts;
    this.stats.done++;
    this.sfx(t.type === 'rant' ? 'rant' : 'done');
    this.toast(`+${pts}`, this.andy, '#ff6');
    this.releaseNpcs(t, true);
    if (t.type === 'video') this.deskScreens.andy = 'work';
    if (line) this.andy.say(line, 2.4, 'andy');
    else if (t.type === 'rant' || this.rng() < 0.45) this.sayCatchphrase();
  }

  private failTask(t: Task) {
    this.tasks = this.tasks.filter((k) => k !== t);
    const d = this.defs[t.type];
    addAnger(this.meters, d.angerOnFail);
    this.stats.failed++;
    this.sfx('fail');
    const msgs: Record<EventType, string> = {
      car: 'Unchecked car!', toilet: 'They made a mess!', rant: 'Missed the rant', fun: 'They got away with it',
      video: 'Missed the call!', boss: 'Boss is NOT happy', shower: 'Lee used all the hot water',
      invoice: 'Invoices not signed', darts: 'Dave is sulking', amber: 'Missed Amber',
    };
    this.toast(`${msgs[t.type]} +${d.angerOnFail} anger`, this.andy, '#f88');
    if (!this.andy.hidden) this.andy.say(this.grumbles.next(), 2, 'andy');
    if (t.type === 'toilet') this.toiletOutOfOrder = this.tuning.toiletOutOfOrderSeconds;
    if (t.type === 'car' && t.car) {
      t.car.checked = true;
      t.car.leaveTimer = range(this.rng, 30, 70);
    }
    if (t.type === 'video') this.deskScreens.andy = 'work';
    if (t.type === 'amber') this.sendAmberAway();
    this.releaseNpcs(t, false);
  }

  private releaseNpcs(t: Task, scolded: boolean) {
    for (const n of [t.npc, t.npc2]) {
      if (!n) continue;
      if (t.type === 'invoice') n.say(scolded ? 'Thanks, Andy!' : "I'll come back later...", 2.2);
      else if (t.type === 'darts') n.say('Suit yourself...', 2.2);
      else if (scolded && t.type !== 'rant') n.say(this.excuses.next(), 2);
      if (scolded && t.type === 'rant') n.say(pick(this.rng, ['Sorry Andy...', 'Yes Andy.', 'Won\'t happen again!']), 2.4);
      if (n.deskId && this.deskScreens[n.deskId]) delete this.deskScreens[n.deskId];
      if (this.intruderInside === n) this.intruderInside = null;
      if (t.type === 'rant') continue;
      if (n.id === 'lee') {
        n.busy = true;
        n.activity = null;
        n.goTo(this.map, this.map.point('outsideLeft'), () => { n.hidden = true; n.busy = false; });
      } else n.goHome(this.map);
    }
  }

  private meltdown() {
    this.meters.anger = 100;
    this.screen = 'gameover';
    this.sfx('meltdown');
    this.saveBest();
  }

  private endDay() {
    this.score += this.tuning.dayEndBonus;
    this.stats.score += this.tuning.dayEndBonus;
    this.screen = 'dayEnd';
    this.sfx('dayEnd');
    this.saveBest();
  }

  private saveBest() {
    if (this.score > this.best) {
      this.best = this.score;
      try { localStorage.setItem('andy.best', String(this.best)); } catch { /* ignore */ }
    }
  }

  // ------------------------------------------------------------ helpers for the renderer

  liveTargets(): { task: Task; pos: Vec }[] {
    const out: { task: Task; pos: Vec }[] = [];
    for (const t of this.tasks) {
      if (t.phase !== 'live') continue;
      const p = t.target();
      if (p) out.push({ task: t, pos: p });
    }
    return out;
  }
}

export const dist = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.y - b.y);
const first = (name: string) => name.split(' ').slice(-1)[0];
export const inRect = (p: Vec, r: { x: number; y: number; w: number; h: number }) => p.x >= r.x && p.y >= r.y && p.x <= r.x + r.w && p.y <= r.y + r.h;

/** Car-check modal button rectangles in logical screen coords (shared by renderer and input). */
export function carModalButtons() {
  return {
    allow: { x: 200, y: 318, w: 150, h: 34 },
    deny: { x: 370, y: 318, w: 150, h: 34 },
  };
}
