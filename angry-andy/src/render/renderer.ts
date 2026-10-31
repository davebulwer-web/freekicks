import type { Assets } from '../core/assets';
import type { Input } from '../core/input';
import type { Audio } from '../core/audio';
import { Game, carModalButtons, type Task } from '../game/game';
import type { Person } from '../entities/person';
import type { Car } from '../entities/car';
import { MOODS, moodIndex } from '../game/meters';
import { fmtDate } from '../game/permit';

export const VIEW_W = 800;
export const VIEW_H = 424;
export const HUD_H = 40;
export const WORLD_W = 640;
export const PANEL_X = 640;
export const MUTE_RECT = { x: 770, y: 10, w: 22, h: 20 };

const FONT = '"VT323", ui-monospace, monospace';
const TITLE_FONT = '"Press Start 2P", ui-monospace, monospace';

const C = {
  hud: '#1c1a26',
  panel: '#24212f',
  card: '#2f2b3d',
  text: '#f2efe6',
  dim: '#a39fb4',
  anger: '#e0483a',
  bladder: '#e8c840',
  thirst: '#8a5a32',
  good: '#5ccf6a',
  warn: '#f0c030',
  bad: '#ff4a3a',
};

export class Renderer {
  readonly ctx: CanvasRenderingContext2D;
  scale = 1;
  offX = 0;
  offY = 0;
  private floor: HTMLCanvasElement | null = null;
  private t = 0;

  constructor(readonly canvas: HTMLCanvasElement, private readonly assets: Assets) {
    this.ctx = canvas.getContext('2d')!;
    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    const w = window.innerWidth, h = window.innerHeight;
    this.scale = Math.min(w / VIEW_W, h / VIEW_H);
    const cw = Math.floor(VIEW_W * this.scale), ch = Math.floor(VIEW_H * this.scale);
    this.canvas.style.width = `${cw}px`;
    this.canvas.style.height = `${ch}px`;
    this.canvas.width = Math.floor(cw * dpr);
    this.canvas.height = Math.floor(ch * dpr);
    this.offX = (w - cw) / 2;
    this.offY = (h - ch) / 2;
  }

  toLogical(cx: number, cy: number) {
    const r = this.canvas.getBoundingClientRect();
    return { x: ((cx - r.left) / r.width) * VIEW_W, y: ((cy - r.top) / r.height) * VIEW_H };
  }

  // ---------------------------------------------------------------- frame

  draw(g: Game, input: Input, audio: Audio, dt: number) {
    this.t += dt;
    const ctx = this.ctx;
    const k = this.canvas.width / VIEW_W;
    ctx.setTransform(k, 0, 0, k, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);

    ctx.save();
    ctx.translate(0, HUD_H);
    ctx.beginPath();
    ctx.rect(0, 0, WORLD_W, VIEW_H - HUD_H);
    ctx.clip();
    this.drawWorld(g, input);
    ctx.restore();

    this.drawHud(g, audio);
    this.drawPanel(g);
    this.drawOverlays(g);
  }

  // ---------------------------------------------------------------- world

  private buildFloor(g: Game) {
    const m = g.map, ts = m.ts;
    const c = document.createElement('canvas');
    c.width = m.w * ts;
    c.height = m.h * ts;
    const x = c.getContext('2d')!;
    const tiles = this.assets.img(this.assets.manifest.tiles.file);
    const names = this.assets.manifest.tiles.names;
    const tile = (name: string, tx: number, ty: number) => {
      const i = names.indexOf(name);
      if (i >= 0) x.drawImage(tiles, i * ts, 0, ts, ts, tx * ts, ty * ts, ts, ts);
    };
    for (let ty = 0; ty < m.h; ty++)
      for (let tx = 0; tx < m.w; tx++) {
        const ch = m.char(tx, ty);
        if (ch === '#') {
          const below = m.char(tx, ty + 1);
          tile(below !== '#' && ty + 1 <= 15 && below === '.' ? 'wall_front' : 'wall_top', tx, ty);
        } else if (ch === '.') {
          const r = m.room[ty * m.w + tx];
          tile(r ? r.floor : 'door', tx, ty);
        } else tile(m.data.legend[ch] ?? 'tarmac', tx, ty);
      }
    // bay markings and road centre line
    x.fillStyle = '#e8e8e0';
    for (const b of m.data.bays) {
      x.fillRect(b.x * ts, b.y * ts, 1, ts * 3);
      x.fillRect((b.x + 2) * ts - 1, b.y * ts, 1, ts * 3);
    }
    for (let px = 4; px < m.w * ts; px += 20) x.fillRect(px, 21 * ts + 7, 10, 2);
    x.fillStyle = '#d0b030';
    x.fillRect(0, 20 * ts, m.w * ts, 1);
    // stairs arrow decal
    const objs = this.assets.manifest.objects.frames;
    const objImg = this.assets.img(this.assets.manifest.objects.file);
    const arrow = objs.stairs_up;
    if (arrow) x.drawImage(objImg, arrow.x, arrow.y, arrow.w, arrow.h, 23.5 * ts, 8 * ts, arrow.w, arrow.h);
    this.floor = c;
  }

  private drawWorld(g: Game, input: Input) {
    const ctx = this.ctx, ts = g.map.ts;
    if (!this.floor) this.buildFloor(g);
    ctx.drawImage(this.floor!, 0, 0);

    // room labels
    ctx.font = `10px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    for (const r of g.map.data.rooms) {
      if (r.id === 'corridor') continue;
      const cx = ((r.x0 + r.x1 + 1) / 2) * ts;
      const y = r.id === 'carpark' ? 22.6 * ts : r.id === 'kitchen' || r.id === 'shower' || r.id === 'toilet' ? r.y0 * ts + 1 : r.id === 'stairs' ? r.y0 * ts + 2 : r.y1 * ts + 4;
      ctx.fillText(r.name.toUpperCase(), cx, y);
    }
    ctx.fillText('BOSS UPSTAIRS', 24.5 * ts, 9.9 * ts);

    // out of order
    const objImg = this.assets.img(this.assets.manifest.objects.file);
    const frames = this.assets.manifest.objects.frames;
    const obj = (name: string, px: number, py: number) => {
      const f = frames[name];
      if (f) ctx.drawImage(objImg, f.x, f.y, f.w, f.h, Math.round(px + f.ox), Math.round(py + f.oy), f.w, f.h);
    };
    if (g.toiletOutOfOrder > 0) obj('mess', 28 * ts, 11 * ts);

    // y-sorted drawables
    const items: { y: number; draw: () => void }[] = [];
    for (const o of g.map.data.objects) {
      if (o.type === 'stairs_up') continue;
      if (o.type === 'shower') { items.push({ y: o.y * ts, draw: () => obj('shower', (o.x - 0.5) * ts, (o.y - 0.4) * ts) }); continue; }
      items.push({ y: (o.y + 1) * ts, draw: () => obj(o.type, o.x * ts, o.y * ts) });
    }
    for (const d of g.map.data.desks) {
      items.push({
        y: (d.y + 1) * ts,
        draw: () => {
          obj('desk', d.x * ts, d.y * ts);
          obj(`screen_${this.screenFor(g, d.id)}`, d.x * ts + 10, d.y * ts - 8 + 1);
        },
      });
    }
    for (const n of g.npcs) if (!n.hidden) items.push({ y: n.y, draw: () => this.drawPerson(n, n.id, n.activity === 'game' || n.activity === 'football' ? 8 : 3) });
    if (!g.andy.hidden) items.push({ y: g.andy.y, draw: () => this.drawAndy(g) });
    for (const c of g.cars) items.push({ y: c.y + 12, draw: () => this.drawCar(c) });
    if (g.toiletOutOfOrder > 0) items.push({ y: 13 * ts + 4, draw: () => obj('out_of_order', 29 * ts, 12.6 * ts) });
    items.sort((a, b) => a.y - b.y);
    for (const it of items) it.draw();

    if (g.modal?.kind === 'darts') this.drawDarts(g, obj);

    // task markers
    for (const { task, pos } of g.liveTargets()) this.drawMarker(task, pos);
    for (const t of g.tasks) if (t.phase === 'upcoming') { const p = t.target(); if (p) this.drawMarker(t, p, true); }

    // speech bubbles (on top of everything)
    for (const n of g.npcs) if (!n.hidden && n.bubble) this.drawBubble(n);
    if (!g.andy.hidden && g.andy.bubble) this.drawBubble(g.andy);

    // interaction prompt
    if (g.near && !g.andy.hidden && !g.modal) this.drawPrompt(g, input);

    // toasts
    ctx.font = `12px ${FONT}`;
    ctx.textAlign = 'center';
    for (const t of g.toasts) {
      ctx.globalAlpha = Math.min(1, t.t * 2);
      this.outlinedText(t.text, Math.max(70, Math.min(WORLD_W - 70, t.x)), t.y, t.colour);
    }
    ctx.globalAlpha = 1;

    // need warnings
    if (g.slowed && g.screen === 'playing' && Math.floor(this.t * 2) % 2 === 0) {
      ctx.font = `12px ${FONT}`;
      ctx.textAlign = 'center';
      this.outlinedText(g.meters.bladder >= 100 ? 'BURSTING! Find the loo!' : 'PARCHED! Need tea!', WORLD_W / 2, 370, C.bad);
    }
  }

  private screenFor(g: Game, deskId: string): string {
    if (g.deskScreens[deskId]) return g.deskScreens[deskId];
    if (deskId === 'andy') return 'work';
    const owner = g.npcs.find((n) => n.deskId === deskId);
    return owner && owner.seated && !owner.path ? 'work' : 'off';
  }

  private drawPerson(p: Person, sheetId: string, workFps = 6, fileOverride?: string) {
    const m = this.assets.manifest;
    const L = m.characterLayout;
    const file = fileOverride ?? m.characters[sheetId]?.file;
    if (!file || !this.assets.has(file)) return;
    const img = this.assets.img(file);
    let row = L.anims[p.dir].row;
    let frame = L.standFrame;
    if (p.pose === 'walk') frame = L.anims[p.dir].frames[Math.floor(p.animT * 8) % 4];
    else if (p.pose === 'work' && p.dir === 'up') {
      row = L.anims.work.row;
      frame = L.anims.work.frames[Math.floor(p.animT * workFps) % 4];
    } else if (p.pose === 'shout') {
      row = L.anims.shout.row;
      frame = L.anims.shout.frames[Math.floor(p.animT * 6) % 4];
    }
    const x = Math.round(p.x - L.frameW / 2), y = Math.round(p.y - L.frameH);
    // shadow
    this.ctx.fillStyle = 'rgba(0,0,0,0.25)';
    this.ctx.beginPath();
    this.ctx.ellipse(p.x, p.y - 1, 6, 2, 0, 0, Math.PI * 2);
    this.ctx.fill();
    this.ctx.drawImage(img, frame * L.frameW, row * L.frameH, L.frameW, L.frameH, x, y, L.frameW, L.frameH);
  }

  private drawAndy(g: Game) {
    const a = g.andy;
    const c = this.assets.manifest.characters.andy;
    const anger = g.meters.anger;
    const file = anger >= 80 && c.furious ? c.furious : anger >= 50 && c.angry ? c.angry : c.file;
    this.drawPerson(a, 'andy', 6, file);
    if (anger >= 67) {
      const ctx = this.ctx;
      ctx.fillStyle = 'rgba(230,230,230,0.8)';
      for (let i = 0; i < 3; i++) {
        const ph = (this.t * 1.5 + i / 3) % 1;
        ctx.fillRect(Math.round(a.x - 7 + i * 7 + Math.sin(ph * 6 + i) * 2), Math.round(a.y - 26 - ph * 10), 2, 2);
      }
    }
  }

  private drawCar(c: Car) {
    const m = this.assets.manifest.cars;
    const img = this.assets.img(m.file);
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(Math.round(c.x), Math.round(c.y));
    ctx.rotate(c.angle);
    ctx.drawImage(img, (c.colour % m.count) * m.frameW, 0, m.frameW, m.frameH, -m.frameW / 2, -m.frameH / 2, m.frameW, m.frameH);
    ctx.restore();
  }

  private drawMarker(task: Task, pos: { x: number; y: number }, upcoming = false) {
    const ctx = this.ctx;
    const frac = upcoming ? 1 : task.timeLeft / task.timeLimit;
    const col = upcoming ? '#7aa8ff' : frac < 0.33 ? C.bad : C.warn;
    const bob = Math.sin(this.t * 6) * 2;
    const y = pos.y - (task.type === 'car' ? 30 : 34) + bob;
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.moveTo(pos.x - 6, y - 1); ctx.lineTo(pos.x + 6, y - 1); ctx.lineTo(pos.x, y + 7); ctx.closePath();
    ctx.fill();
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.moveTo(pos.x - 4, y); ctx.lineTo(pos.x + 4, y); ctx.lineTo(pos.x, y + 5); ctx.closePath();
    ctx.fill();
    this.icon(task.icon, pos.x - 8, y - 17);
    if (task.npc && task.type === 'rant') {
      ctx.font = `10px ${FONT}`;
      ctx.textAlign = 'center';
      this.outlinedText(task.npc.name, pos.x, y - 26, col);
    }
  }

  private drawBubble(p: Person) {
    const ctx = this.ctx;
    const b = p.bubble!;
    ctx.font = `11px ${FONT}`;
    const lines = wrap(ctx, b.text, 120);
    const w = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 8;
    const h = lines.length * 10 + 5;
    let x = Math.round(p.x - w / 2);
    x = Math.max(2, Math.min(WORLD_W - w - 2, x));
    const y = Math.round(p.y - 30 - h);
    const bg = b.tone === 'andy' ? '#fff3d0' : b.tone === 'fun' ? '#d8f0ff' : '#ffffff';
    ctx.fillStyle = '#1a1420';
    ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
    ctx.fillStyle = bg;
    ctx.fillRect(x, y, w, h);
    ctx.fillRect(Math.round(p.x) - 2, y + h, 4, 3);
    ctx.fillStyle = b.tone === 'andy' ? '#8a1010' : '#1a1420';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    lines.forEach((l, i) => ctx.fillText(l, x + 4, y + 2 + i * 10));
  }

  private drawPrompt(g: Game, input: Input) {
    const ctx = this.ctx;
    const n = g.near!;
    const a = g.andy;
    const key = input.touchMode ? 'Hold ACT' : 'Hold E';
    const text = `${key}: ${n.label}`;
    ctx.font = `11px ${FONT}`;
    const w = ctx.measureText(text).width + 10;
    const x = Math.max(2, Math.min(WORLD_W - w - 2, Math.round(a.x - w / 2)));
    const y = Math.round(a.y + 4);
    ctx.fillStyle = 'rgba(20,16,30,0.85)';
    ctx.fillRect(x, y, w, 14);
    ctx.fillStyle = C.text;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(text, x + 5, y + 2);
    if (n.progress > 0) {
      ctx.fillStyle = '#000';
      ctx.fillRect(x, y + 14, w, 4);
      ctx.fillStyle = C.good;
      ctx.fillRect(x + 1, y + 15, Math.round((w - 2) * Math.min(1, n.progress)), 2);
    }
  }

  // ---------------------------------------------------------------- HUD + panel

  private drawHud(g: Game, audio: Audio) {
    const ctx = this.ctx;
    ctx.fillStyle = C.hud;
    ctx.fillRect(0, 0, VIEW_W, HUD_H);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, HUD_H - 1, VIEW_W, 1);
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    ctx.fillStyle = C.dim;
    ctx.font = `11px ${FONT}`;
    ctx.fillText(`DAY ${g.day}  ${g.dateLabel().toUpperCase()}`, 8, 4);
    ctx.fillStyle = C.text;
    ctx.font = `14px ${TITLE_FONT}`;
    ctx.fillText(g.clockLabel(), 8, 18);

    // anger
    const mood = MOODS[moodIndex(g.meters.anger)];
    this.portrait(`andy_${mood}`, 104, 4, 32);
    this.bar(140, 8, 130, 10, g.meters.anger / 100, C.anger, 'ANGER');
    ctx.fillStyle = C.dim;
    ctx.font = `10px ${FONT}`;
    ctx.fillText(mood.toUpperCase(), 140, 21);

    this.icon('bladder', 290, 4);
    this.bar(308, 6, 80, 8, g.meters.bladder / 100, C.bladder, 'BLADDER');
    this.icon('tea', 290, 21);
    this.bar(308, 23, 80, 8, g.meters.thirst / 100, C.thirst, 'THIRST');

    ctx.textAlign = 'right';
    ctx.fillStyle = C.text;
    ctx.font = `12px ${TITLE_FONT}`;
    ctx.fillText(String(g.score).padStart(6, '0'), 750, 8);
    ctx.font = `10px ${FONT}`;
    ctx.fillStyle = C.dim;
    ctx.fillText(`BEST ${g.best}`, 750, 25);
    ctx.textAlign = 'left';
    ctx.fillStyle = C.dim;
    ctx.fillText(`DONE ${g.stats.done}  MISSED ${g.stats.failed}`, 420, 25);
    ctx.fillStyle = C.text;
    ctx.font = `12px ${FONT}`;
    ctx.fillText(g.screen === 'playing' ? 'P = pause' : '', 420, 6);
    this.icon(audio.muted ? 'sound_off' : 'sound_on', MUTE_RECT.x + 3, MUTE_RECT.y + 2);
  }

  private bar(x: number, y: number, w: number, h: number, v: number, col: string, label: string) {
    const ctx = this.ctx;
    ctx.fillStyle = '#000';
    ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
    ctx.fillStyle = '#3a3648';
    ctx.fillRect(x, y, w, h);
    const full = v >= 1;
    ctx.fillStyle = full && Math.floor(this.t * 4) % 2 ? '#fff' : col;
    ctx.fillRect(x, y, Math.round(w * Math.max(0, Math.min(1, v))), h);
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.fillRect(x, y, Math.round(w * Math.max(0, Math.min(1, v))), 1);
    if (h >= 8) {
      ctx.font = `9px ${FONT}`;
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(label, x + 2, y - 1 + (h - 8) / 2);
    }
  }

  private drawPanel(g: Game) {
    const ctx = this.ctx;
    ctx.fillStyle = C.panel;
    ctx.fillRect(PANEL_X, HUD_H, VIEW_W - PANEL_X, VIEW_H - HUD_H);
    ctx.fillStyle = '#000';
    ctx.fillRect(PANEL_X, HUD_H, 1, VIEW_H - HUD_H);
    ctx.font = `10px ${TITLE_FONT}`;
    ctx.fillStyle = C.text;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('TASKS', PANEL_X + 8, HUD_H + 8);
    const sorted = [...g.tasks].sort((a, b) => (a.phase === 'upcoming' ? 1 : 0) - (b.phase === 'upcoming' ? 1 : 0) || a.timeLeft - b.timeLeft);
    let y = HUD_H + 24;
    if (!sorted.length) {
      ctx.font = `11px ${FONT}`;
      ctx.fillStyle = C.dim;
      ctx.fillText('All quiet. For now...', PANEL_X + 8, y);
    }
    for (const t of sorted.slice(0, 7)) {
      this.card(t, PANEL_X + 4, y);
      y += 48;
    }
    // controls reminder
    ctx.font = `10px ${FONT}`;
    ctx.fillStyle = C.dim;
    ctx.fillText('Move: WASD/arrows', PANEL_X + 8, VIEW_H - 26);
    ctx.fillText('Act: hold E/Space  Mute: M', PANEL_X + 8, VIEW_H - 15);
  }

  private card(t: Task, x: number, y: number) {
    const ctx = this.ctx;
    const w = VIEW_W - x - 4, h = 44;
    const frac = t.phase === 'upcoming' ? 1 : Math.max(0, t.timeLeft / t.timeLimit);
    const urgent = t.phase === 'live' && frac < 0.33;
    ctx.fillStyle = urgent && Math.floor(this.t * 3) % 2 ? '#4a2a30' : C.card;
    ctx.fillRect(x, y, w, h);
    if (t.portrait) this.portrait(t.portrait, x + 3, y + 3, 24);
    else { ctx.fillStyle = '#1c1a26'; ctx.fillRect(x + 3, y + 3, 24, 24); this.icon(t.icon, x + 7, y + 7); }
    if (t.portrait) this.icon(t.icon, x + 17, y + 17);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.font = `12px ${FONT}`;
    ctx.fillStyle = C.text;
    ctx.fillText(clip(ctx, t.title, w - 34), x + 31, y + 3);
    ctx.font = `10px ${FONT}`;
    ctx.fillStyle = C.dim;
    ctx.fillText(clip(ctx, t.detail, w - 34), x + 31, y + 16);
    // timer bar
    const bx = x + 3, by = y + 33, bw = w - 6;
    ctx.fillStyle = '#000';
    ctx.fillRect(bx, by, bw, 7);
    if (t.phase === 'upcoming') {
      ctx.fillStyle = '#7aa8ff';
      ctx.font = `10px ${FONT}`;
      ctx.fillText(`Starts in ${Math.ceil(t.startsIn)}s`, bx + 2, by - 2);
    } else {
      ctx.fillStyle = frac < 0.33 ? C.bad : frac < 0.66 ? C.warn : C.good;
      ctx.fillRect(bx + 1, by + 1, Math.round((bw - 2) * frac), 5);
      ctx.fillStyle = '#fff';
      ctx.font = `9px ${FONT}`;
      ctx.textAlign = 'right';
      ctx.fillText(`${Math.ceil(t.timeLeft)}s`, bx + bw - 2, by - 2);
      ctx.textAlign = 'left';
    }
    if (t.progress > 0 && t.progress < 1) {
      ctx.fillStyle = '#7aa8ff';
      ctx.fillRect(bx + 1, by + 5, Math.round((bw - 2) * t.progress), 1);
    }
  }

  // ---------------------------------------------------------------- overlays

  private drawOverlays(g: Game) {
    const ctx = this.ctx;
    if (g.banner && g.screen === 'playing') {
      ctx.font = `10px ${TITLE_FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      const w = ctx.measureText(g.banner.text).width + 20;
      ctx.globalAlpha = Math.min(1, g.banner.t * 2);
      ctx.fillStyle = 'rgba(20,16,30,0.9)';
      ctx.fillRect(WORLD_W / 2 - w / 2, HUD_H + 6, w, 20);
      ctx.fillStyle = C.warn;
      ctx.fillText(g.banner.text, WORLD_W / 2, HUD_H + 11);
      ctx.globalAlpha = 1;
    }
    if (g.modal?.kind === 'car') this.drawCarModal(g);
    if (g.modal?.kind === 'boss') this.drawBossModal(g);
    if (g.modal?.kind === 'darts') this.drawDartsBoard(g);
    if (g.screen === 'title') this.drawTitle(g);
    if (g.screen === 'paused') this.drawCentre(['PAUSED', '', 'Press P or tap to carry on']);
    if (g.screen === 'dayEnd') this.drawDayEnd(g);
    if (g.screen === 'gameover') this.drawGameOver(g);
  }

  private dim(a = 0.65) {
    this.ctx.fillStyle = `rgba(10,8,16,${a})`;
    this.ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  }

  private box(x: number, y: number, w: number, h: number) {
    const ctx = this.ctx;
    ctx.fillStyle = '#000';
    ctx.fillRect(x - 2, y - 2, w + 4, h + 4);
    ctx.fillStyle = '#2f2b3d';
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = '#4a4560';
    ctx.fillRect(x, y, w, 2);
  }

  private drawCarModal(g: Game) {
    const ctx = this.ctx;
    const m = g.modal as Extract<typeof g.modal, { kind: 'car' }>;
    const chk = m.car.check;
    this.dim(0.55);
    this.box(170, 90, 380, 274);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.font = `12px ${TITLE_FONT}`;
    ctx.fillStyle = C.warn;
    ctx.fillText('PARKING CHECK', 360, 102);
    ctx.font = `12px ${FONT}`;
    ctx.fillStyle = C.dim;
    ctx.fillText(`Today is ${g.dateLabel()} ${fmtDate(g.today())}`, 360, 122);
    // number plate
    ctx.fillStyle = '#f4d23a';
    ctx.fillRect(290, 140, 140, 30);
    ctx.fillStyle = '#2a50b0';
    ctx.fillRect(290, 140, 12, 30);
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 2;
    ctx.strokeRect(290, 140, 140, 30);
    ctx.fillStyle = '#111';
    ctx.font = `14px ${TITLE_FONT}`;
    ctx.fillText(chk.plate, 366, 149);
    // permit
    const p = chk.permit;
    ctx.fillStyle = p.kind === 'none' ? '#3a3648' : p.kind === 'staff' ? '#e8f0ff' : '#fff0e0';
    ctx.fillRect(230, 182, 260, 108);
    ctx.textAlign = 'left';
    if (p.kind === 'none') {
      ctx.fillStyle = C.dim;
      ctx.font = `14px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.fillText('Nothing on the dashboard.', 360, 220);
      ctx.fillText('Just a sandwich wrapper.', 360, 240);
    } else {
      ctx.fillStyle = p.kind === 'staff' ? '#2a50b0' : '#c06020';
      ctx.fillRect(230, 182, 260, 22);
      ctx.fillStyle = '#fff';
      ctx.font = `10px ${TITLE_FONT}`;
      ctx.fillText(p.kind === 'staff' ? 'STAFF PARKING PERMIT' : 'VISITOR PASS', 240, 188);
      ctx.fillStyle = '#111';
      ctx.font = `16px ${FONT}`;
      ctx.fillText(`Vehicle reg:  ${p.plate}`, 240, 212);
      ctx.fillText(`Name:         ${p.name}`, 240, 234);
      ctx.fillText(`Valid until:  ${p.expires ? fmtDate(p.expires) : '-'}`, 240, 256);
    }
    const b = carModalButtons();
    this.button(b.allow, 'ALLOW  [A]', '#2a8a3a');
    this.button(b.deny, 'SEND AWAY [D]', '#b03030');
    ctx.textAlign = 'center';
    ctx.font = `10px ${FONT}`;
    ctx.fillStyle = C.dim;
    ctx.fillText('Plate must match and the date must not have passed.', 360, 298);
  }

  private button(r: { x: number; y: number; w: number; h: number }, label: string, col: string) {
    const ctx = this.ctx;
    ctx.fillStyle = '#000';
    ctx.fillRect(r.x - 2, r.y - 2, r.w + 4, r.h + 4);
    ctx.fillStyle = col;
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.fillRect(r.x, r.y, r.w, 3);
    ctx.fillStyle = '#fff';
    ctx.font = `10px ${TITLE_FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, r.x + r.w / 2, r.y + r.h / 2 + 1);
    ctx.textBaseline = 'top';
  }

  /** Darts stuck in the board, plus the one in flight. */
  private drawDarts(g: Game, obj: (name: string, px: number, py: number) => void) {
    const m = g.modal as Extract<typeof g.modal, { kind: 'darts' }>;
    const ts = g.map.ts;
    const board = g.map.data.objects.find((o) => o.type === 'dartboard');
    if (!board) return;
    const bx = board.x * ts + 8, by = board.y * ts + 10;
    const shown = g.dartsShown(m);
    for (let i = 0; i < shown; i++) obj('dart', bx + m.throws[i].dx - 1, by + m.throws[i].dy - 6);
    if (shown < 6) {
      const seg = m.total / 7.5;
      const f = (((m.total - m.t) % seg) / seg);
      if (f > 0.4) {
        const k = (f - 0.4) / 0.6;
        const th = m.throws[shown];
        const from = th.who === 'andy' ? g.andy : g.npc('dave');
        const x = from.x + (bx + th.dx - from.x) * k, y = from.y - 18 + (by + th.dy - (from.y - 18)) * k - Math.sin(k * Math.PI) * 6;
        obj('dart', x - 1, y - 6);
      }
    }
  }

  private drawDartsBoard(g: Game) {
    const ctx = this.ctx;
    const m = g.modal as Extract<typeof g.modal, { kind: 'darts' }>;
    const shown = g.dartsShown(m);
    const x = 440, y = HUD_H + 8, w = 192, h = 92;
    this.box(x, y, w, h);
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    ctx.font = `10px ${TITLE_FONT}`;
    ctx.fillStyle = C.warn;
    ctx.fillText('DARTS', x + 8, y + 7);
    this.icon('darts', x + w - 24, y + 4);
    const rowFor = (who: 'andy' | 'dave', yy: number, label: string) => {
      const mine = m.throws.map((t, i) => ({ t, i })).filter(({ t }) => t.who === who);
      const vis = mine.filter(({ i }) => i < shown);
      const total = vis.reduce((s2, { t }) => s2 + t.score, 0);
      ctx.font = `14px ${FONT}`;
      ctx.fillStyle = C.text;
      ctx.fillText(label, x + 8, yy);
      mine.forEach(({ t, i }, k) => {
        ctx.fillStyle = i < shown ? C.text : C.dim;
        ctx.fillText(i < shown ? String(t.score) : '-', x + 84 + k * 26, yy);
      });
      ctx.fillStyle = C.warn;
      ctx.textAlign = 'right';
      ctx.fillText(String(total), x + w - 8, yy);
      ctx.textAlign = 'left';
    };
    rowFor('andy', y + 26, 'Andy');
    rowFor('dave', y + 44, 'Big Toe Dave');
    ctx.font = `12px ${FONT}`;
    if (shown >= 6) {
      ctx.fillStyle = m.win ? C.good : C.bad;
      ctx.fillText(m.win ? 'GAME SHOT! Andy wins.' : 'Dave wins. Andy is fuming.', x + 8, y + 68);
    } else {
      ctx.fillStyle = C.dim;
      ctx.fillText(`${m.throws[shown].who === 'andy' ? 'Andy' : 'Dave'} to throw...`, x + 8, y + 68);
    }
  }

  private drawBossModal(g: Game) {
    const ctx = this.ctx;
    const m = g.modal as Extract<typeof g.modal, { kind: 'boss' }>;
    ctx.fillStyle = 'rgba(10,8,16,0.6)';
    ctx.fillRect(0, HUD_H, WORLD_W, VIEW_H - HUD_H);
    this.box(150, 130, 340, 150);
    this.portrait('boss', 166, 150, 64);
    this.portrait(`andy_${MOODS[Math.min(5, moodIndex(g.meters.anger) + 1)]}`, 410, 190, 64);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.font = `10px ${TITLE_FONT}`;
    ctx.fillStyle = C.warn;
    ctx.fillText('UPSTAIRS WITH THE BOSS', 244, 144);
    ctx.font = `14px ${FONT}`;
    ctx.fillStyle = C.text;
    wrap(ctx, `"${m.line}"`, 230).forEach((l, i) => ctx.fillText(l, 244, 166 + i * 14));
    ctx.fillStyle = C.dim;
    ctx.font = `11px ${FONT}`;
    ctx.fillText(`Back in ${Math.ceil(m.t)}s... (tasks keep ticking!)`, 166, 262);
  }

  private drawCentre(lines: string[], startY = 150) {
    const ctx = this.ctx;
    this.dim();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    lines.forEach((l, i) => {
      ctx.font = i === 0 ? `16px ${TITLE_FONT}` : `14px ${FONT}`;
      ctx.fillStyle = i === 0 ? C.warn : C.text;
      ctx.fillText(l, VIEW_W / 2, startY + i * 18 + (i ? 10 : 0));
    });
  }

  private drawTitle(g: Game) {
    const ctx = this.ctx;
    this.dim(0.72);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.font = `22px ${TITLE_FONT}`;
    ctx.fillStyle = '#000';
    ctx.fillText('ANGRY ANDY', VIEW_W / 2 + 2, 52);
    ctx.fillStyle = C.anger;
    ctx.fillText('ANGRY ANDY', VIEW_W / 2, 50);
    ctx.font = `12px ${TITLE_FONT}`;
    ctx.fillStyle = C.text;
    ctx.fillText('GETS THE GIG', VIEW_W / 2, 82);
    const moods = ['neutral', 'annoyed', 'irritated', 'angry', 'furious', 'shouting'];
    moods.forEach((m, i) => this.portrait(`andy_${m}`, VIEW_W / 2 - 3 * 44 + i * 44 + 4, 108, 36));
    ctx.font = `14px ${FONT}`;
    ctx.fillStyle = C.text;
    const lines = [
      'Andy is the IT Manager. He is permanently annoyed.',
      'Deal with each task before its timer runs out or his ANGER rises.',
      'Check cars, chase people out of the loo, rant at the usual suspects,',
      'stop the IT lads having fun, sign invoices, take video calls, beat',
      'Big Toe Dave at darts and go upstairs when the boss calls.',
      'Keep BLADDER (loo) and THIRST (tea in the kitchen) under control.',
      'Survive until 5 o\'clock. If anger hits 100%... MELTDOWN.',
    ];
    lines.forEach((l, i) => ctx.fillText(l, VIEW_W / 2, 160 + i * 16));
    ctx.fillStyle = C.dim;
    ctx.fillText('Move: WASD / arrows / joystick     Act: hold E or Space / ACT button', VIEW_W / 2, 284);
    ctx.fillText('A / D to allow or send away cars     P pause     M mute', VIEW_W / 2, 300);
    if (Math.floor(this.t * 2) % 2 === 0) {
      ctx.font = `12px ${TITLE_FONT}`;
      ctx.fillStyle = C.warn;
      ctx.fillText('PRESS SPACE OR TAP TO START', VIEW_W / 2, 336);
    }
    ctx.font = `12px ${FONT}`;
    ctx.fillStyle = C.dim;
    if (g.best) ctx.fillText(`Best score: ${g.best}`, VIEW_W / 2, 366);
    ctx.fillText('"You don\'t get the gig."', VIEW_W / 2, 390);
  }

  private drawDayEnd(g: Game) {
    this.drawCentre([
      "5 O'CLOCK!",
      `Day ${g.day} survived. Andy is going home.`,
      `Tasks done: ${g.stats.done}    Missed: ${g.stats.failed}`,
      `Day score: ${g.stats.score} (incl. ${g.tuning.dayEndBonus} bonus)`,
      `Total: ${g.score}`,
      '',
      `Press SPACE or tap for Day ${g.day + 1} (${['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'][g.day % 5]})`,
    ], 120);
    this.portrait(`andy_${MOODS[moodIndex(g.meters.anger)]}`, VIEW_W / 2 - 24, 290, 48);
  }

  private drawGameOver(g: Game) {
    const ctx = this.ctx;
    this.dim(0.75);
    this.portrait('andy_shouting', VIEW_W / 2 - 48, 70, 96);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.font = `24px ${TITLE_FONT}`;
    ctx.fillStyle = C.bad;
    ctx.fillText('MELTDOWN!', VIEW_W / 2, 182);
    ctx.font = `16px ${FONT}`;
    ctx.fillStyle = C.text;
    ctx.fillText(`"${g.lastPhrase || "You don't get the gig!"}"`, VIEW_W / 2, 220);
    ctx.fillText(`Andy lost it on Day ${g.day} at ${g.clockLabel()}.`, VIEW_W / 2, 248);
    ctx.fillText(`Score: ${g.score}     Best: ${g.best}`, VIEW_W / 2, 270);
    ctx.fillStyle = C.warn;
    ctx.font = `12px ${TITLE_FONT}`;
    if (Math.floor(this.t * 2) % 2 === 0) ctx.fillText('SPACE OR TAP TO TRY AGAIN', VIEW_W / 2, 320);
  }

  // ---------------------------------------------------------------- primitives

  icon(name: string, x: number, y: number) {
    const m = this.assets.manifest.icons;
    const i = m.names.indexOf(name);
    if (i < 0) return;
    this.ctx.drawImage(this.assets.img(m.file), i * m.size, 0, m.size, m.size, Math.round(x), Math.round(y), m.size, m.size);
  }

  portrait(id: string, x: number, y: number, size: number) {
    const f = this.assets.manifest.portraits[id];
    if (!f || !this.assets.has(f)) return;
    const img = this.assets.img(f);
    this.ctx.drawImage(img, 0, 0, img.width, img.height, x, y, size, size);
  }

  private outlinedText(text: string, x: number, y: number, col: string) {
    const ctx = this.ctx;
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#000';
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) ctx.fillText(text, x + dx, y + dy);
    ctx.fillStyle = col;
    ctx.fillText(text, x, y);
  }
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const t = cur ? `${cur} ${w}` : w;
    if (ctx.measureText(t).width > maxW && cur) {
      lines.push(cur);
      cur = w;
    } else cur = t;
  }
  if (cur) lines.push(cur);
  return lines;
}

function clip(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (ctx.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(t + '…').width > maxW) t = t.slice(0, -1);
  return t + '…';
}

