import { el, shield } from './dom';

export const BAR_NAMES = ['HEIGHT', 'DIRECTION', 'SWERVE'] as const;

/**
 * In-game overlay: score, stage, lives, wind gauge, the three shot bars, messages and the
 * replay controls.
 */
export class Hud {
  readonly root: HTMLElement;
  private score = el('div.hud-score');
  private teams = el('div.hud-teams');
  private stage = el('div.hud-stage');
  private lives = el('div.hud-lives');
  private clock = el('div.hud-clock');
  private modeTag = el('div.hud-mode');
  private deadZone = el('div.bar-deadzone');
  private windArrow = el('div.wind-arrow');
  private windText = el('div.wind-text');
  private weatherIcon = el('div.weather-icon');
  private bars: { root: HTMLElement; marker: HTMLElement; label: HTMLElement }[] = [];
  private barPanel = el('div.bars');
  private banner = el('div.banner');
  private sub = el('div.banner-sub');
  private hint = el('div.hint');
  private replay = el('div.replay-ui');
  private replayAngle = el('span.replay-angle');
  onExit: () => void = () => {};
  onReplayCamera: () => void = () => {};
  onReplaySkip: () => void = () => {};
  onResetView: () => void = () => {};

  constructor(parent: HTMLElement) {
    BAR_NAMES.forEach((name, i) => {
      const marker = el('div.bar-marker');
      const label = el('div.bar-label', { text: name });
      const track = el('div.bar-track', {}, [i === 2 ? this.deadZone : null, i === 2 ? el('div.bar-centre') : null, marker]);
      const root = el('div.bar', {}, [label, track]);
      this.bars.push({ root, marker, label });
      this.barPanel.append(root);
    });
    this.replay.append(
      el('div.replay-tag', {}, ['REPLAY ', this.replayAngle]),
      shield(el('div.replay-buttons', {}, [
        el('button.btn.small', { text: 'CAMERA', onclick: () => this.onReplayCamera() }),
        el('button.btn.small', { text: 'SKIP ▶', onclick: () => this.onReplaySkip() }),
      ])),
    );
    this.root = el('div.hud', {}, [
      el('div.hud-top', {}, [el('div.hud-left', {}, [this.teams, this.score, this.lives, this.clock, this.modeTag]), this.stage]),
      el('div.wind', {}, [el('div.wind-dial', {}, [this.windArrow]), this.windText, this.weatherIcon]),
      shield(el('button.btn.exit', { text: 'EXIT', onclick: () => this.onExit() })),
      shield(el('button.btn.view', { text: '⟲ VIEW', title: 'Reset camera', onclick: () => this.onResetView() })),
      this.barPanel,
      el('div.banner-wrap', {}, [this.banner, this.sub]),
      this.hint,
      this.replay,
    ]);
    parent.append(this.root);
    this.showReplay(false);
  }

  /** Mode-specific HUD: clock for Time Attack, dead zone for Bending, etc. */
  configure(opts: { timed: boolean; minSwerve?: number; tag?: string }) {
    this.lives.style.display = opts.timed ? 'none' : '';
    this.clock.style.display = opts.timed ? '' : 'none';
    const dz = opts.minSwerve ?? 0;
    this.deadZone.style.display = dz > 0 ? '' : 'none';
    this.deadZone.style.left = `${50 - dz * 50}%`;
    this.deadZone.style.width = `${dz * 100}%`;
    this.modeTag.textContent = opts.tag ?? '';
  }

  setClock(seconds: number) {
    const s = Math.ceil(seconds);
    this.clock.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    this.clock.classList.toggle('low', seconds <= 10);
  }

  show(v: boolean) {
    this.root.style.display = v ? '' : 'none';
  }

  setInfo(home: string, away: string, score: number, stage: number, lives: number, maxLives: number) {
    this.teams.textContent = `${home} v ${away}`;
    this.score.textContent = score.toLocaleString();
    this.stage.textContent = `STAGE ${stage}`;
    this.lives.innerHTML = '';
    for (let i = 0; i < maxLives; i++) this.lives.append(el(`div.life${i < lives ? '' : '.lost'}`));
  }

  /** Wind: world-space vector; viewYaw rotates the arrow to match the camera. */
  setWind(wx: number, wz: number, viewYaw: number, weather: string) {
    const speed = Math.hypot(wx, wz);
    const ang = Math.atan2(wx, wz) - viewYaw;
    this.windArrow.style.transform = `rotate(${(-ang * 180) / Math.PI + 180}deg)`;
    this.windArrow.style.opacity = speed < 0.3 ? '0.2' : '1';
    this.windText.textContent = `${speed.toFixed(1)} m/s`;
    this.weatherIcon.textContent = weather === 'rain' ? '🌧 RAIN' : weather === 'snow' ? '❄ SNOW' : '';
  }

  /** active: index of the moving bar (-1 none). values: 0..1 */
  setBars(values: number[], active: number, visible: boolean) {
    this.barPanel.style.display = visible ? '' : 'none';
    this.bars.forEach((b, i) => {
      b.marker.style.left = `${values[i] * 100}%`;
      b.root.classList.toggle('active', i === active);
      b.root.classList.toggle('locked', i < active || active === -1);
    });
  }

  message(text: string, sub = '', kind: 'goal' | 'miss' | 'info' = 'info') {
    this.banner.textContent = text;
    this.sub.innerHTML = sub;
    this.banner.className = `banner ${kind} ${text ? 'show' : ''}`;
    this.sub.className = `banner-sub ${sub ? 'show' : ''}`;
  }

  setHint(text: string) {
    this.hint.textContent = text;
    this.hint.style.display = text ? '' : 'none';
  }

  showReplay(v: boolean, angleName = '') {
    this.replay.style.display = v ? '' : 'none';
    this.replayAngle.textContent = angleName;
  }
}
