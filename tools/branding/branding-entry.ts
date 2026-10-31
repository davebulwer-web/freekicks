/**
 * Dip & Drive branding: logo wordmark, key art (rendered by the game itself around a real
 * simulated dipping free kick), app icons and splash screens. Driven by tools/branding/render.cjs.
 */
import {
  AdditiveBlending,
  CatmullRomCurve3,
  DoubleSide,
  Mesh,
  ShaderMaterial,
  TubeGeometry,
  Vector3,
} from 'three';
import { AssetManager } from '../../src/assets/AssetManager';
import modes from '../../src/config/modes.json';
import { makeStage } from '../../src/config/stages';
import type { ModeConfig } from '../../src/config/types';
import { Teams } from '../../src/game/Teams';
import { World } from '../../src/render/World';
import type { ShotInput } from '../../src/sim/Kick';
import { Match, SIM_DT } from '../../src/sim/Match';

declare global {
  interface Window {
    __branding?: Record<string, string>;
  }
}

const INK = '#2a0f36';
const LILAC = '#e9d2f7';
const PINK = '#ff9be0';
const GLOW = 'rgba(255, 214, 255, 0.95)';

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

async function loadFonts() {
  for (const [family, file] of [['Luckiest Guy', 'LuckiestGuy-Regular.woff2'], ['Lilita One', 'LilitaOne-Regular.woff2']]) {
    const f = new FontFace(family, `url(../hoardings/fonts/${file})`);
    document.fonts.add(await f.load());
  }
}

// ------------------------------------------------------------------ shared drawing

/** A classic black-and-white football. */
function drawBall(g: CanvasRenderingContext2D, x: number, y: number, r: number, rot = 0.3) {
  g.save();
  g.translate(x, y);
  g.rotate(rot);
  const shade = g.createRadialGradient(-r * 0.35, -r * 0.4, r * 0.1, 0, 0, r);
  shade.addColorStop(0, '#ffffff');
  shade.addColorStop(0.7, '#e7e2ec');
  shade.addColorStop(1, '#a99fb4');
  g.fillStyle = shade;
  g.beginPath();
  g.arc(0, 0, r, 0, Math.PI * 2);
  g.fill();
  g.save();
  g.clip();
  const pent = (cx: number, cy: number, s: number, a0: number) => {
    g.beginPath();
    for (let i = 0; i < 5; i++) {
      const a = a0 + (i * Math.PI * 2) / 5;
      g.lineTo(cx + Math.cos(a) * s, cy + Math.sin(a) * s);
    }
    g.closePath();
    g.fill();
  };
  g.fillStyle = '#1d1726';
  pent(0, 0, r * 0.3, -Math.PI / 2);
  for (let i = 0; i < 5; i++) {
    const a = -Math.PI / 2 + (i * Math.PI * 2) / 5;
    pent(Math.cos(a) * r * 0.86, Math.sin(a) * r * 0.86, r * 0.28, a + Math.PI);
  }
  g.strokeStyle = 'rgba(29,23,38,0.55)';
  g.lineWidth = Math.max(1, r * 0.035);
  for (let i = 0; i < 5; i++) {
    const a = -Math.PI / 2 + (i * Math.PI * 2) / 5;
    g.beginPath();
    g.moveTo(Math.cos(a) * r * 0.3, Math.sin(a) * r * 0.3);
    g.lineTo(Math.cos(a) * r * 0.62, Math.sin(a) * r * 0.62);
    g.stroke();
  }
  g.restore();
  g.lineWidth = Math.max(1.5, r * 0.06);
  g.strokeStyle = INK;
  g.beginPath();
  g.arc(0, 0, r, 0, Math.PI * 2);
  g.stroke();
  g.restore();
}

/** Glowing tapered trail along a quadratic curve (thin at the tail, full width at the ball). */
function drawTrail(g: CanvasRenderingContext2D, p0: [number, number], c: [number, number], p1: [number, number], width: number) {
  const N = 60;
  const pt = (t: number): [number, number] => [
    (1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * c[0] + t * t * p1[0],
    (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * c[1] + t * t * p1[1],
  ];
  for (const [w, col, blur] of [[2.4, 'rgba(201, 120, 255, 0.35)', width * 1.2], [1.3, 'rgba(255, 190, 245, 0.75)', width * 0.5], [0.45, 'rgba(255, 255, 255, 1)', 0]] as const) {
    g.save();
    g.shadowColor = GLOW;
    g.shadowBlur = blur;
    g.strokeStyle = col;
    g.lineCap = 'round';
    for (let i = 0; i < N; i++) {
      const t0 = i / N, t1 = (i + 1) / N;
      g.lineWidth = width * w * (0.08 + 0.92 * t1 ** 1.3);
      g.beginPath();
      g.moveTo(...pt(t0));
      g.lineTo(...pt(t1));
      g.stroke();
    }
    g.restore();
  }
}

/** Outlined, gradient-filled display text with a drop shadow. */
function outlinedText(g: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, opts: { font?: string; skew?: number; fill?: [string, string, string] } = {}) {
  g.save();
  g.translate(x, y);
  if (opts.skew) g.transform(1, 0, opts.skew, 1, 0, 0);
  g.font = `${size}px "${opts.font ?? 'Luckiest Guy'}"`;
  g.textBaseline = 'alphabetic';
  g.lineJoin = 'round';
  // drop shadow
  g.fillStyle = 'rgba(10, 2, 16, 0.55)';
  g.strokeStyle = 'rgba(10, 2, 16, 0.55)';
  g.lineWidth = size * 0.16;
  g.strokeText(text, size * 0.035, size * 0.06);
  // outer outline
  g.strokeStyle = INK;
  g.lineWidth = size * 0.16;
  g.strokeText(text, 0, 0);
  // fill gradient
  const [a, b, c] = opts.fill ?? ['#ffffff', LILAC, '#b47fe6'];
  const grd = g.createLinearGradient(0, -size * 0.8, 0, 0);
  grd.addColorStop(0, a);
  grd.addColorStop(0.55, b);
  grd.addColorStop(1, c);
  g.fillStyle = grd;
  g.fillText(text, 0, 0);
  // inner highlight line
  g.strokeStyle = 'rgba(255,255,255,0.35)';
  g.lineWidth = size * 0.018;
  g.strokeText(text, -size * 0.01, -size * 0.015);
  g.restore();
}

// ------------------------------------------------------------------ logo

/** Transparent wordmark: DIP & DRIVE with a dipping free-kick swoosh ending in a ball. */
function makeLogo(): HTMLCanvasElement {
  const [c, g] = canvas(1800, 720);
  // Swoosh: rises from the left, arcs over the wordmark and dips down onto the ball.
  drawTrail(g, [120, 300], [760, -170], [1610, 210], 30);
  drawBall(g, 1625, 230, 78, 0.5);
  outlinedText(g, 'DIP', 150, 520, 330, { skew: -0.12 });
  outlinedText(g, '&', 735, 460, 190, { font: 'Lilita One', skew: -0.12, fill: ['#ffd9f5', PINK, '#d457b8'] });
  outlinedText(g, 'DRIVE', 930, 640, 330, { skew: -0.12 });
  return trim(c, 24);
}

/** Crop transparent margins (keeping `pad` px). */
function trim(src: HTMLCanvasElement, pad: number): HTMLCanvasElement {
  const g = src.getContext('2d')!;
  const { data, width, height } = g.getImageData(0, 0, src.width, src.height);
  let x0 = width, y0 = height, x1 = 0, y1 = 0;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      if (data[(y * width + x) * 4 + 3] > 8) {
        x0 = Math.min(x0, x); x1 = Math.max(x1, x);
        y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      }
  const [c, o] = canvas(x1 - x0 + 1 + pad * 2, y1 - y0 + 1 + pad * 2);
  o.drawImage(src, x0, y0, x1 - x0 + 1, y1 - y0 + 1, pad, pad, x1 - x0 + 1, y1 - y0 + 1);
  return c;
}

// ------------------------------------------------------------------ icon

function iconBackground(size: number): HTMLCanvasElement {
  const [c, g] = canvas(size, size);
  const grd = g.createRadialGradient(size * 0.55, size * 0.42, size * 0.05, size * 0.5, size * 0.5, size * 0.75);
  grd.addColorStop(0, '#6a2a8c');
  grd.addColorStop(0.55, '#35114a');
  grd.addColorStop(1, '#14061f');
  g.fillStyle = grd;
  g.fillRect(0, 0, size, size);
  // faint goal-net grid in the top right
  g.strokeStyle = 'rgba(255, 220, 255, 0.07)';
  g.lineWidth = size * 0.004;
  for (let i = 0; i <= 12; i++) {
    const p = size * 0.45 + i * size * 0.05;
    g.beginPath(); g.moveTo(p, 0); g.lineTo(p, size * 0.5); g.stroke();
    g.beginPath(); g.moveTo(size * 0.45, i * size * 0.045); g.lineTo(size, i * size * 0.045); g.stroke();
  }
  return c;
}

/** Icon artwork (no background) on a transparent square. */
function iconForeground(size: number): HTMLCanvasElement {
  const [c, g] = canvas(size, size);
  const s = size / 1024;
  const cx = 512 * s, cy = 560 * s, r = 330 * s;
  // Shot ring segments (as in the game), glowing.
  g.save();
  g.shadowColor = GLOW;
  g.shadowBlur = 40 * s;
  const arcs: [number, number][] = [[200, 262], [268, 330], [336, 398]];
  for (const [a0, a1] of arcs) {
    g.beginPath();
    g.arc(cx, cy, r, (a0 * Math.PI) / 180, (a1 * Math.PI) / 180);
    g.arc(cx, cy, r - 78 * s, (a1 * Math.PI) / 180, (a0 * Math.PI) / 180, true);
    g.closePath();
    g.fillStyle = '#f3e3fb';
    g.fill();
    g.lineWidth = 16 * s;
    g.strokeStyle = '#5b2470';
    g.stroke();
  }
  g.restore();
  // Dipping trail into the ball
  drawTrail(g, [150 * s, 760 * s], [330 * s, 40 * s], [600 * s, 560 * s], 64 * s);
  drawBall(g, 640 * s, 640 * s, 175 * s, 0.4);
  return c;
}

function makeIcon(size: number, shape: 'square' | 'round'): HTMLCanvasElement {
  const [c, g] = canvas(size, size);
  g.save();
  g.beginPath();
  if (shape === 'round') g.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
  else g.roundRect(0, 0, size, size, size * 0.2);
  g.clip();
  g.drawImage(iconBackground(size), 0, 0);
  g.drawImage(iconForeground(size), 0, 0);
  g.restore();
  return c;
}

/** Adaptive icon foreground: artwork scaled into the 72dp visible area of the 108dp canvas. */
function adaptiveForeground(size: number): HTMLCanvasElement {
  const [c, g] = canvas(size, size);
  const art = iconForeground(1024);
  const k = 0.7;
  g.drawImage(art, (size * (1 - k)) / 2, (size * (1 - k)) / 2, size * k, size * k);
  return c;
}

// ------------------------------------------------------------------ key art

/** Find a seed + shot that dips over the wall into a top corner, and the frame to freeze on. */
function findHeroShot(): { stage: ReturnType<typeof makeStage>; shot: ShotInput } {
  const arcade = modes[0] as ModeConfig;
  for (let seed = 1; seed < 60; seed++) {
    const stage = { ...makeStage(4, arcade, seed), weather: 'clear' as const };
    if (Math.abs(stage.ballPos.x) > 8) continue;
    for (const swerve of [0.55, -0.55, 0.75, -0.75])
      for (const dip of [0.95, 0.8])
        for (let h = 0.66; h <= 0.86; h += 0.04)
          for (let d = 0.1; d <= 0.9; d += 0.05) {
            const shot = { height: h, direction: d, swerve, dip };
            const m = new Match(stage);
            m.takeKick(shot);
            for (let i = 0; i < 120 * 8 && !m.finished; i++) m.step();
            const o = m.outcome;
            if (o?.goal && !o.rebound && o.crossing && o.crossing.y > 1.7 && Math.abs(o.crossing.x) > 2.4) return { stage, shot };
          }
  }
  throw new Error('no hero shot found');
}

function trailMesh(points: Vector3[], radius: number, color: [number, number, number], alpha: number): Mesh {
  const curve = new CatmullRomCurve3(points);
  const geo = new TubeGeometry(curve, Math.max(40, points.length * 2), radius, 12, false);
  const mat = new ShaderMaterial({
    uniforms: { color: { value: color }, alpha: { value: alpha } },
    vertexShader: `
      varying float vAlong; varying vec3 vN; varying vec3 vV;
      void main() {
        vAlong = uv.x;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform vec3 color; uniform float alpha;
      varying float vAlong; varying vec3 vN; varying vec3 vV;
      void main() {
        float edge = pow(abs(dot(vN, vV)), 1.5);
        float fade = smoothstep(0.0, 0.85, vAlong);
        gl_FragColor = vec4(color, alpha * edge * fade);
      }`,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    side: DoubleSide,
  });
  return new Mesh(geo, mat);
}

async function makeKeyArt(assets: AssetManager): Promise<HTMLCanvasElement> {
  const { stage, shot } = findHeroShot();
  const glCanvas = document.getElementById('scene') as HTMLCanvasElement;
  const world = new World(glCanvas, assets);
  world.renderer.setPixelRatio(1);
  world.resize(1920, 1080);

  // Re-run the shot, recording the ball path, and freeze when the keeper is mid-dive.
  const m = new Match(stage);
  const sel = Teams.selection();
  world.bindMatch(m, Teams.get(sel.home), Teams.get(sel.away));
  world.setNight(true);
  m.takeKick(shot);
  const path: Vector3[] = [];
  let freeze = -1;
  for (let i = 0; i < 120 * 6 && m.phase !== 'done'; i++) {
    m.step(SIM_DT);
    // Start the visible trail a few metres out so it doesn't streak past the camera.
    if (m.phase === 'live' && i % 2 === 0 && m.ballStart.distanceTo(m.ball.pos) > 3.5) path.push(m.ball.pos.clone());
    const travelled = m.ballStart.distanceTo(m.ball.pos);
    const total = Math.hypot(m.ballStart.x, m.ballStart.z);
    if (freeze < 0 && m.phase === 'live' && travelled > total * 0.5) {
      freeze = path.length;
      break;
    }
  }
  const ballNow = m.ball.pos.clone();

  // Glowing trail behind the ball (core + soft halo).
  world.scene.add(trailMesh(path, 0.07, [1, 0.95, 1], 0.95));
  world.scene.add(trailMesh(path, 0.24, [0.85, 0.45, 1], 0.55));
  world.scene.add(trailMesh(path, 0.6, [0.6, 0.25, 0.9], 0.22));
  // Key-art licence: a bigger ball reads better at title-screen size.
  (world as unknown as { ball: Mesh }).ball.scale.setScalar(1.7);

  // Low camera behind and beside the kicker, looking up past the wall at the ball and goal.
  const toGoal = new Vector3(-stage.ballPos.x, 0, -stage.ballPos.z).normalize();
  const right = new Vector3(-toGoal.z, 0, toGoal.x);
  const side = shot.swerve > 0 ? -1 : 1;
  // Just behind the wall, low, looking up as the ball curls over it towards goal.
  const camPos = m.ballStart.clone().addScaledVector(toGoal, 5.0).addScaledVector(right, side * 3.6).setY(0.8);
  const target = ballNow.clone().lerp(new Vector3(0, 1.6, 0), 0.45);
  target.y = Math.max(2.2, ballNow.y * 0.75);
  world.director.camera.fov = 58;
  world.director.setFixed(camPos, target);
  for (let i = 0; i < 4; i++) {
    world.stadium.holdExcitement(0.75);
    world.renderLive(m, 1 / 30);
  }

  // Composite: scene + colour grade + vignette + logo.
  const [c, g] = canvas(1920, 1080);
  g.drawImage(glCanvas, 0, 0);
  const tint = g.createLinearGradient(0, 0, 0, 1080);
  tint.addColorStop(0, 'rgba(70, 20, 110, 0.35)');
  tint.addColorStop(0.5, 'rgba(70, 20, 110, 0.0)');
  tint.addColorStop(1, 'rgba(20, 5, 30, 0.55)');
  g.fillStyle = tint;
  g.fillRect(0, 0, 1920, 1080);
  const vig = g.createRadialGradient(960, 540, 400, 960, 540, 1150);
  vig.addColorStop(0, 'rgba(0,0,0,0)');
  vig.addColorStop(1, 'rgba(8, 0, 16, 0.75)');
  g.fillStyle = vig;
  g.fillRect(0, 0, 1920, 1080);
  return c;
}

function withLogo(art: HTMLCanvasElement, logo: HTMLCanvasElement, w: number, h: number, logoFrac: number, logoY: number, logoX = 0.5): HTMLCanvasElement {
  const [c, g] = canvas(w, h);
  // Cover-crop the art.
  const s = Math.max(w / art.width, h / art.height);
  g.drawImage(art, (w - art.width * s) / 2, (h - art.height * s) / 2, art.width * s, art.height * s);
  const lw = w * logoFrac;
  const lh = (logo.height / logo.width) * lw;
  g.drawImage(logo, w * logoX - lw / 2, h * logoY - lh / 2, lw, lh);
  return c;
}

/** High-quality downscale (repeated halving). */
function resize(src: HTMLCanvasElement, w: number, h: number): HTMLCanvasElement {
  let cur = src;
  while (cur.width / 2 >= w && cur.height / 2 >= h) {
    const [c, g] = canvas(Math.round(cur.width / 2), Math.round(cur.height / 2));
    g.imageSmoothingQuality = 'high';
    g.drawImage(cur, 0, 0, c.width, c.height);
    cur = c;
  }
  const [c, g] = canvas(w, h);
  g.imageSmoothingQuality = 'high';
  g.drawImage(cur, 0, 0, w, h);
  return c;
}

// ------------------------------------------------------------------ main

async function main() {
  await loadFonts();
  const assets = new AssetManager('/assets/');
  await assets.load();

  const out: Record<string, HTMLCanvasElement> = {};
  const logo = makeLogo();
  out['public/assets/ui/logo.png'] = logo;

  const art = await makeKeyArt(assets);
  out['public/assets/ui/title.png'] = withLogo(art, logo, 1920, 1080, 0.44, 0.2, 0.27);
  out['art/branding/key_art_clean.png'] = art;

  // App icon
  const master = makeIcon(1024, 'square');
  out['art/branding/icon_1024.png'] = master;
  out['public/icon-512.png'] = resize(master, 512, 512);
  out['public/favicon.png'] = resize(makeIcon(256, 'round'), 64, 64);
  const dens: [string, number][] = [['mdpi', 1], ['hdpi', 1.5], ['xhdpi', 2], ['xxhdpi', 3], ['xxxhdpi', 4]];
  const res = 'android/app/src/main/res';
  const roundMaster = makeIcon(1024, 'round');
  const fg = adaptiveForeground(1024);
  const bg = iconBackground(1024);
  for (const [d, k] of dens) {
    const legacy = Math.round(48 * k), adaptive = Math.round(108 * k);
    out[`${res}/mipmap-${d}/ic_launcher.png`] = resize(master, legacy, legacy);
    out[`${res}/mipmap-${d}/ic_launcher_round.png`] = resize(roundMaster, legacy, legacy);
    out[`${res}/mipmap-${d}/ic_launcher_foreground.png`] = resize(fg, adaptive, adaptive);
    out[`${res}/mipmap-${d}/ic_launcher_background.png`] = resize(bg, adaptive, adaptive);
  }

  // Launch splash (landscape and portrait), logo over the key art.
  const splash: [string, number, number][] = [
    ['drawable', 480, 320],
    ['drawable-land-mdpi', 480, 320], ['drawable-land-hdpi', 800, 480], ['drawable-land-xhdpi', 1280, 720],
    ['drawable-land-xxhdpi', 1600, 960], ['drawable-land-xxxhdpi', 1920, 1280],
    ['drawable-port-mdpi', 320, 480], ['drawable-port-hdpi', 480, 800], ['drawable-port-xhdpi', 720, 1280],
    ['drawable-port-xxhdpi', 960, 1600], ['drawable-port-xxxhdpi', 1280, 1920],
  ];
  for (const [d, w, h] of splash) {
    const portrait = h > w;
    out[`${res}/${d}/splash.png`] = withLogo(art, logo, w, h, portrait ? 0.86 : 0.6, portrait ? 0.4 : 0.42);
  }

  const urls: Record<string, string> = {};
  const gallery = document.getElementById('gallery')!;
  for (const [p, cv] of Object.entries(out)) {
    urls[p] = cv.toDataURL('image/png');
    if (p.includes('mipmap-') && !p.includes('xxxhdpi')) continue;
    if (p.includes('drawable') && !p.includes('xxhdpi')) continue;
    const fig = document.createElement('figure');
    fig.innerHTML = `<img src="${urls[p]}" alt="${p}"><figcaption>${p} (${cv.width}x${cv.height})</figcaption>`;
    gallery.appendChild(fig);
  }
  window.__branding = urls;
  document.getElementById('status')!.textContent = `Rendered ${Object.keys(urls).length} files.`;
}

main().catch((e) => {
  document.getElementById('status')!.textContent = 'Error: ' + e;
  console.error(e);
});
