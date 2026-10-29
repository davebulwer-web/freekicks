import type { AssetManager } from '../assets/AssetManager';
import modesJson from '../config/modes.json';
import { KIT_PATTERNS, type Kit, type ModeConfig, type Team } from '../config/types';
import { HighScores } from '../game/HighScores';
import type { KickResult } from '../game/Session';
import { storage } from '../game/storage';
import { Teams } from '../game/Teams';
import { el, shield } from './dom';
import { drawKitPreview } from './kitPreview';

export const MODES = modesJson as ModeConfig[];

export interface Settings {
  sound: boolean;
  autoReplay: boolean;
}

/** Full-screen menus: title, teams & kit editor, high scores, game over. */
export class Menus {
  readonly root: HTMLElement;
  onPlay: (mode: ModeConfig) => void = () => {};
  onSettings: (s: Settings) => void = () => {};
  settings: Settings = storage.get<Settings>('fk.settings', { sound: true, autoReplay: true });

  constructor(parent: HTMLElement, private assets: AssetManager) {
    this.root = shield(el('div.menus'));
    parent.append(this.root);
  }

  hide() {
    this.root.style.display = 'none';
    this.root.innerHTML = '';
  }

  private screen(...children: (Node | null)[]) {
    this.root.innerHTML = '';
    this.root.style.display = '';
    this.root.append(el('div.screen', {}, children));
  }

  main() {
    const sel = Teams.selection();
    const home = Teams.get(sel.home), away = Teams.get(sel.away);
    const preview = el('div.title-kits', {}, [this.kitCanvas(home.kit, 1), el('div.vs', { text: 'v' }), this.kitCanvas(away.kit, 7)]);
    this.screen(
      el('h1.title', { html: 'FREE <span>KICKS</span>' }),
      el('div.subtitle', { text: `${home.name} v ${away.name}` }),
      preview,
      el('div.menu-buttons', {}, [
        ...MODES.map((m) =>
          el('button.btn.big', { onclick: () => this.onPlay(m) }, [el('div', { text: m.name }), el('small', { text: m.description })]),
        ),
        el('div.row', {}, [
          el('button.btn', { text: 'TEAMS & KITS', onclick: () => this.teams() }),
          el('button.btn', { text: 'HIGH SCORES', onclick: () => this.highScores(MODES[0].id) }),
          el('button.btn', { text: 'SETTINGS', onclick: () => this.settingsScreen() }),
        ]),
      ]),
    );
  }

  private kitCanvas(kit: Kit, row: number) {
    const c = el('canvas.kit-preview');
    drawKitPreview(c, this.assets, kit, row);
    return c;
  }

  settingsScreen() {
    const s = this.settings;
    const toggle = (label: string, key: keyof Settings) =>
      el('label.toggle', {}, [
        el('input', {
          type: 'checkbox',
          ...(s[key] ? { checked: true } : {}),
          onchange: (e: Event) => {
            s[key] = (e.target as HTMLInputElement).checked;
            storage.set('fk.settings', s);
            this.onSettings(s);
          },
        }),
        ` ${label}`,
      ]);
    this.screen(
      el('h2', { text: 'SETTINGS' }),
      toggle('Sound', 'sound'),
      toggle('Automatic replays', 'autoReplay'),
      el('p.note', { text: 'Tip: drag on the pitch to rotate the camera and pinch to zoom, during aiming and replays.' }),
      el('button.btn', { text: 'BACK', onclick: () => this.main() }),
    );
  }

  // ------------------------------------------------------------------ teams

  teams() {
    const sel = Teams.selection();
    const all = Teams.all();
    const picker = (label: string, current: string, onChange: (id: string) => void) => {
      const s = el('select', { onchange: (e: Event) => onChange((e.target as HTMLSelectElement).value) },
        all.map((t) => el('option', { value: t.id, text: t.name, ...(t.id === current ? { selected: true } : {}) })));
      return el('div.team-pick', {}, [
        el('div.label', { text: label }),
        s,
        this.kitCanvas(Teams.get(current).kit, 1),
        el('button.btn.small', { text: 'EDIT KIT', onclick: () => this.editor(Teams.get(current), label === 'YOUR TEAM' ? 'home' : 'away') }),
      ]);
    };
    this.screen(
      el('h2', { text: 'TEAMS & KITS' }),
      el('div.team-picks', {}, [
        picker('YOUR TEAM', sel.home, (id) => { Teams.select(id, sel.away); this.teams(); }),
        picker('OPPONENTS', sel.away, (id) => { Teams.select(sel.home, id); this.teams(); }),
      ]),
      el('div.row', {}, [
        el('button.btn', { text: 'NEW TEAM', onclick: () => this.editor(newTeam(), 'home') }),
        el('button.btn', { text: 'BACK', onclick: () => this.main() }),
      ]),
    );
  }

  editor(team: Team, slot: 'home' | 'away') {
    const t: Team = JSON.parse(JSON.stringify(team));
    const previews = [0, 1, 4].map(() => el('canvas.kit-preview'));
    const kPrev = el('canvas.kit-preview');
    const redraw = () => {
      previews.forEach((c, i) => drawKitPreview(c, this.assets, t.kit, [0, 1, 4][i]));
      drawKitPreview(kPrev, this.assets, t.keeper, 0);
    };
    const colour = (kit: Kit, key: 'shirt1' | 'shirt2' | 'shorts' | 'socks', label: string) =>
      el('label.field', {}, [label, el('input', { type: 'color', value: kit[key], oninput: (e: Event) => { kit[key] = (e.target as HTMLInputElement).value; redraw(); } })]);
    const pattern = (kit: Kit) =>
      el('label.field', {}, [
        'Pattern',
        el('select', { onchange: (e: Event) => { kit.pattern = (e.target as HTMLSelectElement).value as Kit['pattern']; redraw(); } },
          KIT_PATTERNS.map((p) => el('option', { value: p, text: p, ...(p === kit.pattern ? { selected: true } : {}) }))),
      ]);
    const count = el('label.field', {}, [
      'Stripes/hoops',
      el('input', { type: 'range', min: 2, max: 10, value: t.kit.patternCount ?? 6, oninput: (e: Event) => { t.kit.patternCount = +(e.target as HTMLInputElement).value; redraw(); } }),
    ]);
    const isCustom = Teams.custom().some((c) => c.id === t.id);
    this.screen(
      el('h2', { text: 'KIT EDITOR' }),
      el('div.editor', {}, [
        el('div.editor-fields', {}, [
          el('label.field', {}, ['Team name', el('input', { type: 'text', maxlength: 22, value: t.name, oninput: (e: Event) => (t.name = (e.target as HTMLInputElement).value) })]),
          el('label.field', {}, ['Short (3)', el('input', { type: 'text', maxlength: 3, value: t.short, oninput: (e: Event) => (t.short = (e.target as HTMLInputElement).value.toUpperCase()) })]),
          pattern(t.kit),
          count,
          colour(t.kit, 'shirt1', 'Shirt colour 1'),
          colour(t.kit, 'shirt2', 'Shirt colour 2'),
          colour(t.kit, 'shorts', 'Shorts'),
          colour(t.kit, 'socks', 'Socks'),
          el('div.label', { text: 'GOALKEEPER' }),
          pattern(t.keeper),
          colour(t.keeper, 'shirt1', 'Shirt colour 1'),
          colour(t.keeper, 'shirt2', 'Shirt colour 2'),
          colour(t.keeper, 'shorts', 'Shorts'),
          colour(t.keeper, 'socks', 'Socks'),
        ]),
        el('div.editor-preview', {}, [...previews, kPrev]),
      ]),
      el('div.row', {}, [
        el('button.btn', {
          text: 'SAVE',
          onclick: () => {
            t.name = t.name.trim() || 'My Team';
            t.short = (t.short || t.name).slice(0, 3).toUpperCase().padEnd(3, 'X');
            Teams.save(t);
            const sel = Teams.selection();
            Teams.select(slot === 'home' ? t.id : sel.home, slot === 'away' ? t.id : sel.away);
            this.teams();
          },
        }),
        isCustom ? el('button.btn', { text: Teams.presets.some((p) => p.id === t.id) ? 'RESET' : 'DELETE', onclick: () => { Teams.remove(t.id); this.teams(); } }) : null,
        el('button.btn', { text: 'CANCEL', onclick: () => this.teams() }),
      ]),
    );
    redraw();
  }

  // ------------------------------------------------------------------ scores

  highScores(modeId: string, highlight?: number) {
    const list = HighScores.list(modeId);
    this.screen(
      el('h2', { text: 'HIGH SCORES' }),
      el('div.row.tabs', {}, MODES.map((m) => el(`button.btn.small${m.id === modeId ? '.on' : ''}`, { text: m.name, onclick: () => this.highScores(m.id) }))),
      el('table.scores', {}, [
        el('tr', {}, ['#', 'NAME', 'TEAM', 'STAGE', 'SCORE'].map((h) => el('th', { text: h }))),
        ...(list.length
          ? list.map((s, i) => el(`tr${i === highlight ? '.hl' : ''}`, {}, [i + 1, s.name, s.team, s.stage, s.score.toLocaleString()].map((v) => el('td', { text: String(v) }))))
          : [el('tr', {}, [el('td', { colspan: 5, text: 'No scores yet. Go and bend one in!' })])]),
      ]),
      el('button.btn', { text: 'BACK', onclick: () => this.main() }),
    );
  }

  gameOver(mode: ModeConfig, score: number, stage: number, goals: number, team: string, history: KickResult[], onDone: () => void) {
    const best = Math.max(0, ...history.map((h) => h.points?.total ?? 0));
    const qualifies = HighScores.qualifies(mode.id, score);
    const name = el('input', { type: 'text', maxlength: 12, value: storage.get('fk.lastName', 'PLAYER') }) as HTMLInputElement;
    const save = () => {
      const n = name.value.trim().toUpperCase() || 'PLAYER';
      storage.set('fk.lastName', n);
      const list = HighScores.add(mode.id, { name: n, score, stage, team, date: new Date().toISOString() });
      this.highScores(mode.id, list.findIndex((s) => s.score === score && s.name === n));
    };
    this.screen(
      el('h1.title.small', { text: 'GAME OVER' }),
      el('div.summary', {}, [
        el('div', { html: `Score <b>${score.toLocaleString()}</b>` }),
        el('div', { html: `Reached stage <b>${stage}</b> · Goals <b>${goals}</b>` }),
        el('div', { html: `Best goal <b>${best}</b> pts` }),
      ]),
      qualifies ? el('div.row', {}, [el('div.label', { text: 'NEW HIGH SCORE! NAME:' }), name, el('button.btn', { text: 'SAVE', onclick: save })]) : null,
      el('div.row', {}, [
        el('button.btn', { text: 'PLAY AGAIN', onclick: () => this.onPlay(mode) }),
        el('button.btn', { text: 'MENU', onclick: () => onDone() }),
      ]),
    );
  }

  confirm(text: string, yes: () => void, no: () => void) {
    this.screen(el('h2', { text }), el('div.row', {}, [el('button.btn', { text: 'YES', onclick: yes }), el('button.btn', { text: 'NO', onclick: no })]));
  }

  loading(done: number, total: number) {
    this.screen(el('h1.title', { html: 'FREE <span>KICKS</span>' }), el('div.subtitle', { text: `Loading ${done}/${total}…` }));
  }
}

function newTeam(): Team {
  return {
    id: `custom-${Date.now().toString(36)}`,
    name: 'My Team',
    short: 'MYT',
    kit: { pattern: 'stripes', shirt1: '#d01f2e', shirt2: '#ffffff', shorts: '#111111', socks: '#d01f2e', patternCount: 6 },
    keeper: { pattern: 'plain', shirt1: '#2bb04a', shirt2: '#2bb04a', shorts: '#111111', socks: '#2bb04a' },
  };
}
