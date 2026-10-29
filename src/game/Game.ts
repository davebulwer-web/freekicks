import type { AssetManager } from '../assets/AssetManager';
import { Sfx } from '../audio/Sfx';
import { ANGLE_NAMES, type ReplayAngle } from '../camera/CameraDirector';
import { makeStage } from '../config/stages';
import type { ModeConfig, Team } from '../config/types';
import { Rng } from '../core/Rng';
import { World } from '../render/World';
import { Recorder, type ReplayState } from '../replay/Recorder';
import type { ShotInput } from '../sim/Kick';
import { Match, SIM_DT } from '../sim/Match';
import { Hud } from '../ui/Hud';
import { Menus, type Settings } from '../ui/Menus';
import { Session, type KickResult } from './Session';
import { Teams } from './Teams';

type State = 'menu' | 'aim' | 'kick' | 'result' | 'replay' | 'gameover' | 'paused';

const REPLAY_EXTRA: ReplayAngle[] = ['side', 'keeper', 'kicker', 'aerial'];

/** Oscillating tap-to-stop bar: triangle wave 0..1. */
class Bar {
  t = Math.random();
  value = 0;
  update(dt: number, speed: number) {
    this.t += dt * speed;
    const x = this.t % 2;
    this.value = x < 1 ? x : 2 - x;
  }
}

/** Top-level game flow: menus -> aim -> kick -> result -> replay -> next kick / game over. */
export class Game {
  readonly world: World;
  readonly hud: Hud;
  readonly menus: Menus;
  readonly sfx: Sfx;
  private state: State = 'menu';
  private session: Session | null = null;
  private match: Match | null = null;
  private recorder = new Recorder();
  private bars = [new Bar(), new Bar(), new Bar()];
  private barIndex = 0;
  private locked: number[] = [0.5, 0.5, 0.5];
  private shot: ShotInput | null = null;
  private acc = 0;
  private stepCount = 0;
  private stateTime = 0;
  private lastResult: KickResult | null = null;
  private home!: Team;
  private away!: Team;
  private replayT = 0;
  private replayPass = 0;
  private replaySpeed = 1;
  private replayAngles: ReplayAngle[] = [];
  private replayState: ReplayState | undefined;
  private rng = new Rng(Date.now() & 0xffff);
  private demo = false;
  private pausedFrom: State = 'aim';

  constructor(canvas: HTMLCanvasElement, ui: HTMLElement, assets: AssetManager) {
    this.world = new World(canvas, assets);
    this.hud = new Hud(ui);
    this.menus = new Menus(ui, assets);
    this.sfx = new Sfx(assets.manifest);
    this.applySettings(this.menus.settings);
    this.menus.onPlay = (m) => this.start(m);
    this.menus.onSettings = (s) => this.applySettings(s);
    this.hud.onExit = () => this.pause();
    this.hud.onReplaySkip = () => this.endReplay();
    this.hud.onReplayCamera = () => this.cycleReplayCamera();
    this.hud.onResetView = () => this.world.director.resetOrbit();
    this.showMenu();
  }

  private applySettings(s: Settings) {
    this.sfx.setMuted(!s.sound);
  }

  // ------------------------------------------------------------------ flow

  showMenu() {
    this.state = 'menu';
    this.hud.show(false);
    this.demo = true;
    // Attract mode: show a free kick behind the menu.
    const sel = Teams.selection();
    this.home = Teams.get(sel.home);
    this.away = Teams.get(sel.away);
    const s = new Session(this.menusMode(), this.rng.int(1, 1e6));
    this.newMatch(s);
    this.world.director.setPreset('tv');
    this.menus.main();
  }

  private menusMode(): ModeConfig {
    return { id: 'demo', name: 'Demo', description: '', lives: 3, windMin: 0, windMax: 2, windRampPerStage: 0, weather: { clear: 1 }, scoreMultiplier: 1 };
  }

  start(mode: ModeConfig) {
    this.sfx.unlock();
    this.demo = false;
    const sel = Teams.selection();
    this.home = Teams.get(sel.home);
    this.away = Teams.get(sel.away);
    this.session = new Session(mode);
    this.menus.hide();
    this.hud.show(true);
    this.nextKick();
  }

  private newMatch(session: Session) {
    this.match = new Match(session.current);
    this.recorder = new Recorder();
    this.world.bindMatch(this.match, this.home, this.away);
    this.bindSounds(this.match);
  }

  private nextKick() {
    const s = this.session!;
    this.newMatch(s);
    this.state = 'aim';
    this.stateTime = 0;
    this.barIndex = 0;
    this.locked = [0.5, 0.5, 0.5];
    this.bars.forEach((b) => (b.t = this.rng.range(0, 2)));
    this.hud.message('');
    this.hud.showReplay(false);
    this.hud.setHint('Tap to stop the HEIGHT bar');
    this.updateInfo();
    this.sfx.play('whistle');
  }

  private updateInfo() {
    const s = this.session;
    if (!s) return;
    this.hud.setInfo(this.home.short, this.away.short, s.score, s.stage, s.lives, s.mode.lives);
  }

  /** A short tap anywhere on the pitch. */
  tap() {
    this.sfx.unlock();
    if (this.state !== 'aim' || !this.match) return;
    this.locked[this.barIndex] = this.bars[this.barIndex].value;
    this.barIndex++;
    if (this.barIndex < 3) {
      this.hud.setHint(`Tap to stop the ${['HEIGHT', 'DIRECTION', 'SWERVE'][this.barIndex]} bar`);
      return;
    }
    this.shot = { height: this.locked[0], direction: this.locked[1], swerve: this.locked[2] * 2 - 1 };
    this.hud.setHint('');
    this.match.takeKick(this.shot);
    this.state = 'kick';
    this.stateTime = 0;
  }

  drag(dx: number, dy: number) {
    this.world.director.orbit(dx, dy);
  }

  pinch(scale: number) {
    this.world.director.pinch(scale);
  }

  private pause() {
    if (this.state === 'menu' || this.state === 'gameover' || this.state === 'paused') return;
    this.pausedFrom = this.state;
    this.state = 'paused';
    this.menus.confirm('QUIT THIS GAME?', () => this.showMenu(), () => {
      this.menus.hide();
      this.state = this.pausedFrom;
    });
  }

  private bindSounds(m: Match) {
    m.events.on('kick', (e) => this.sfx.play('kick', e.speed / 25));
    m.events.on('bounce', (e) => this.sfx.play('bounce', e.speed / 10));
    m.events.on('frame', () => {
      this.sfx.play('post');
      this.world.stadium.excitement = Math.max(this.world.stadium.excitement, 0.5);
    });
    m.events.on('net', (e) => this.sfx.play('net', e.speed / 8));
    m.events.on('touch', (e) => {
      if (e.kind === 'save' || e.kind === 'block') this.sfx.play('bounce', 0.8);
    });
    m.events.on('outcome', (o) => {
      if (this.demo) return;
      if (o.goal) {
        this.sfx.play('cheer');
        this.world.stadium.excitement = 1;
      } else this.sfx.play('groan');
    });
  }

  // ------------------------------------------------------------------ loop

  update(dt: number) {
    dt = Math.min(dt, 0.1);
    this.stateTime += dt;
    const m = this.match;
    if (!m) return;

    if (this.state === 'paused') {
      this.world.renderLive(m, 0);
      return;
    }

    if (this.state === 'menu') return this.updateDemo(dt);

    if (this.state === 'aim') {
      const speed = this.session!.current.barSpeed;
      this.bars[this.barIndex]?.update(dt, speed * (this.barIndex === 2 ? 1.15 : 1));
      const vals = this.bars.map((b, i) => (i < this.barIndex ? this.locked[i] : i === this.barIndex ? b.value : 0.5));
      this.hud.setBars(vals, this.barIndex, true);
    }

    if (this.state === 'kick' || this.state === 'result') this.stepSim(dt);

    if (this.state === 'kick' && m.outcome) {
      this.state = 'result';
      this.stateTime = 0;
      this.lastResult = this.session!.record(m.outcome, this.shot!);
      this.showResult(this.lastResult);
    }
    if (this.state === 'result' && m.finished && this.stateTime > 1.8) {
      if (this.menus.settings.autoReplay) this.startReplay();
      else this.afterReplay();
    }

    if (this.state === 'replay') {
      this.updateReplay(dt);
    } else {
      this.world.renderLive(m, dt);
    }

    const s = this.session!;
    this.hud.setWind(m.env.wind.x, m.env.wind.z, this.world.director.viewYaw, s.current.weather);
    this.sfx.setCrowd(this.world.stadium.excitement);
  }

  private stepSim(dt: number) {
    const m = this.match!;
    this.acc += dt;
    while (this.acc >= SIM_DT) {
      m.step(SIM_DT);
      if (this.stepCount++ % 2 === 0) this.recorder.capture(m);
      this.acc -= SIM_DT;
    }
  }

  private showResult(r: KickResult) {
    const o = r.outcome;
    this.hud.setBars(this.locked.map((v, i) => (i === 2 ? v : v)), -1, false);
    if (o.goal && r.points) {
      const p = r.points;
      const sub = o.rebound
        ? `Rebound saves the life · +${p.total}`
        : `${p.zoneName} ${p.zone}${p.swerve ? ` + swerve ${p.swerve}` : ''} × ${p.multiplier.toFixed(2)} = <b>${p.total}</b>`;
      this.hud.message(o.message, sub, 'goal');
    } else {
      const sub = r.gameOver ? 'No lives left' : `${r.livesAfter} ${r.livesAfter === 1 ? 'life' : 'lives'} left`;
      this.hud.message(o.message, sub, 'miss');
    }
    this.updateInfo();
  }

  // ------------------------------------------------------------------ replay

  private startReplay() {
    this.state = 'replay';
    this.replayPass = 0;
    // Each kick can have a different number of players (wall size), so don't reuse the buffer.
    this.replayState = undefined;
    this.replayAngles = ['behind-goal', this.rng.pick(REPLAY_EXTRA)];
    this.beginReplayPass();
  }

  private beginReplayPass() {
    const m = this.match!;
    this.replayT = Math.max(this.recorder.start, m.kickTime - 0.9);
    this.replaySpeed = this.replayPass === 0 ? 1 : 0.6;
    const angle = this.replayAngles[this.replayPass];
    this.world.director.setPreset(angle);
    this.world.goal.reset();
    this.hud.message('');
    this.hud.showReplay(true, ANGLE_NAMES[angle]);
  }

  private cycleReplayCamera() {
    const order: ReplayAngle[] = ['behind-goal', 'side', 'keeper', 'kicker', 'aerial', 'tv'];
    const next = order[(order.indexOf(this.world.director.angle) + 1) % order.length];
    this.world.director.setPreset(next);
    this.hud.showReplay(true, ANGLE_NAMES[next]);
  }

  private updateReplay(dt: number) {
    const m = this.match!;
    this.replayT += dt * this.replaySpeed;
    const end = Math.min(this.recorder.end, (m.outcome?.time ?? this.recorder.end) + 1.2);
    if (this.replayT > end) {
      this.replayPass++;
      if (this.replayPass >= this.replayAngles.length) return this.endReplay();
      this.beginReplayPass();
    }
    this.replayState = this.recorder.sample(this.replayT, this.replayState);
    this.world.renderReplay(this.replayState, this.replayT, m.people.indexOf(m.keeper), dt);
  }

  private endReplay() {
    if (this.state !== 'replay') return;
    this.hud.showReplay(false);
    this.afterReplay();
  }

  private afterReplay() {
    const s = this.session!;
    if (s.gameOver) {
      this.state = 'gameover';
      this.hud.show(false);
      this.menus.gameOver(s.mode, s.score, s.stage, s.goals, this.home.name, s.history, () => this.showMenu());
      return;
    }
    this.nextKick();
  }

  // ------------------------------------------------------------------ attract mode

  private updateDemo(dt: number) {
    const m = this.match!;
    if (m.phase === 'ready' && this.stateTime > 1.5) {
      m.takeKick({ height: this.rng.range(0.6, 0.8), direction: this.rng.range(0.25, 0.75), swerve: this.rng.range(-1, 1) });
    }
    this.stepSim(dt);
    this.world.renderLive(m, dt);
    if (m.finished && this.stateTime > 4) {
      this.stateTime = 0;
      const s = new Session(this.menusMode(), this.rng.int(1, 1e6));
      s.current = makeStage(this.rng.int(1, 8), s.mode, s.runSeed);
      this.newMatch(s);
      this.world.director.setPreset(this.rng.pick(['tv', 'behind-goal', 'side'] as ReplayAngle[]));
    }
  }
}
