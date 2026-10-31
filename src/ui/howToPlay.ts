import type { ModeConfig } from '../config/types';
import { ZONE_POINTS } from '../game/Scoring';
import { el } from './dom';

const FILL = '#f3e3fb';
const EDGE = '#5b2470';
const PITCH = '#2f7a34';

interface Page {
  title: string;
  art: string;
  body: string;
}

/** SVG arc segment path (angles in degrees, 0 = up, clockwise). */
function segment(cx: number, cy: number, r0: number, r1: number, a0: number, a1: number): string {
  const p = (r: number, a: number) => {
    const t = ((a - 90) * Math.PI) / 180;
    return `${(cx + r * Math.cos(t)).toFixed(1)},${(cy + r * Math.sin(t)).toFixed(1)}`;
  };
  const large = a1 - a0 > 180 ? 1 : 0;
  return `M${p(r1, a0)} A${r1},${r1} 0 ${large} 1 ${p(r1, a1)} L${p(r0, a1)} A${r0},${r0} 0 ${large} 0 ${p(r0, a0)} Z`;
}

const ball = (x: number, y: number, r: number) =>
  `<circle cx="${x}" cy="${y}" r="${r}" fill="#fff" stroke="#1d1726" stroke-width="${r * 0.18}"/><circle cx="${x}" cy="${y}" r="${r * 0.38}" fill="#1d1726"/>`;

const svg = (body: string, vb = '0 0 320 200') => `<svg viewBox="${vb}" xmlns="http://www.w3.org/2000/svg">${body}</svg>`;

function ringArt(): string {
  const names = ['HEIGHT', 'DIRECTION', 'SWERVE', 'DIP'];
  const start = -125, seg = 58, gap = 6;
  let s = '<defs><filter id="glow"><feGaussianBlur stdDeviation="4"/></filter></defs>';
  names.forEach((n, i) => {
    const a0 = start + i * (seg + gap), a1 = a0 + seg;
    const active = i === 2;
    if (active) s += `<path d="${segment(160, 128, 66, 96, a0, a1)}" fill="#ffd6ff" filter="url(#glow)"/>`;
    s += `<path d="${segment(160, 128, 66, 96, a0, a1)}" fill="${FILL}" fill-opacity="${i < 2 || active ? 1 : 0.45}" stroke="${EDGE}" stroke-width="4"/>`;
    const mid = ((a0 + a1) / 2 - 90) * (Math.PI / 180);
    s += `<text x="${(160 + 116 * Math.cos(mid)).toFixed(0)}" y="${(128 + 116 * Math.sin(mid) + 4).toFixed(0)}" font-size="13" text-anchor="middle" fill="#fff" font-weight="700">${n}</text>`;
  });
  s += ball(160, 128, 12);
  return svg(s, '0 0 320 200');
}

function flightArt(): string {
  // Side view: three flights over the wall from the same height setting.
  const wall = '<rect x="140" y="128" width="16" height="48" rx="6" fill="#d33"/><circle cx="148" cy="122" r="8" fill="#e0b090"/>';
  const goal = '<path d="M282 176 V84 H306" stroke="#fff" stroke-width="5" fill="none"/>';
  const arc = (d: string, col: string, label: string, ly: number) =>
    `<path d="${d}" stroke="${col}" stroke-width="5" fill="none" stroke-linecap="round" stroke-dasharray="${col === '#fff' ? '0' : '0'}"/><text x="214" y="${ly}" font-size="12" fill="${col}" font-weight="700">${label}</text>`;
  return svg(
    `<rect x="0" y="176" width="320" height="24" fill="${PITCH}"/>${wall}${goal}` +
      arc('M20 172 Q150 10 300 60', '#9ad0ff', 'FLOAT', 42) +
      arc('M20 172 Q150 40 300 112', '#ffffff', 'NO SPIN', 88) +
      arc('M20 172 Q140 20 290 150', '#ff9be0', 'DIP', 140) +
      ball(20, 168, 7),
  );
}

function swerveArt(): string {
  // Top view: curl around the wall into the corner.
  return svg(
    `<rect width="320" height="200" fill="${PITCH}"/>` +
      `<rect x="40" y="12" width="240" height="10" fill="#fff"/><path d="M110 22 V12 M210 22 V12" stroke="#ddd" stroke-width="4"/>` +
      `<g fill="#d33">${[0, 1, 2, 3].map((i) => `<circle cx="${128 + i * 16}" cy="96" r="7"/>`).join('')}</g>` +
      `<path d="M160 180 Q240 120 200 26" stroke="#ff9be0" stroke-width="5" fill="none" stroke-linecap="round"/>` +
      `<path d="M160 180 Q80 120 120 26" stroke="#9ad0ff" stroke-width="5" fill="none" stroke-linecap="round" stroke-dasharray="8 6"/>` +
      ball(160, 180, 8) +
      `<text x="236" y="150" font-size="12" fill="#fff" font-weight="700">SWERVE RIGHT</text><text x="16" y="150" font-size="12" fill="#fff" font-weight="700">SWERVE LEFT</text>`,
  );
}

function scoringArt(): string {
  const cols = ['side', 'centre', 'side'] as const;
  const rows = ['top', 'middle', 'bottom'] as const;
  let s = `<rect x="40" y="30" width="240" height="150" fill="#0003" stroke="#fff" stroke-width="6"/>`;
  rows.forEach((r, ri) =>
    cols.forEach((c, ci) => {
      const v = ZONE_POINTS[r][c];
      const x = 43 + ci * 78, y = 33 + ri * 49;
      s += `<rect x="${x}" y="${y}" width="76" height="47" fill="${v >= 500 ? '#ff9be0' : v >= 300 ? '#c89cf0' : '#7a5aa0'}" fill-opacity="0.55"/>`;
      s += `<text x="${x + 38}" y="${y + 30}" font-size="18" text-anchor="middle" fill="#fff" font-weight="800">${v}</text>`;
    }),
  );
  return svg(s);
}

function conditionsArt(): string {
  return svg(
    `<circle cx="70" cy="90" r="46" fill="#145a74" stroke="#a9bfd0" stroke-width="6"/><path d="M70 60 L84 104 L70 96 L56 104 Z" fill="#e0442e"/>` +
      `<text x="70" y="166" font-size="13" text-anchor="middle" fill="#fff" font-weight="700">WIND</text>` +
      `<g stroke="#b4c4d4" stroke-width="3">${[0, 1, 2, 3, 4, 5].map((i) => `<line x1="${140 + i * 12}" y1="${50 + (i % 2) * 14}" x2="${134 + i * 12}" y2="${70 + (i % 2) * 14}"/>`).join('')}</g>` +
      `<ellipse cx="170" cy="120" rx="32" ry="9" fill="#6f8494"/><text x="170" y="166" font-size="13" text-anchor="middle" fill="#fff" font-weight="700">RAIN</text>` +
      `<g fill="#fff">${[0, 1, 2, 3, 4, 5, 6].map((i) => `<circle cx="${240 + (i % 3) * 18 + (i > 3 ? 8 : 0)}" cy="${55 + Math.floor(i / 3) * 22}" r="4"/>`).join('')}</g>` +
      `<rect x="226" y="116" width="64" height="12" rx="6" fill="#eef3fa"/><text x="258" y="166" font-size="13" text-anchor="middle" fill="#fff" font-weight="700">SNOW</text>`,
  );
}

function cameraArt(): string {
  return svg(
    `<rect x="100" y="20" width="120" height="170" rx="18" fill="#1a1f2a" stroke="#a9bfd0" stroke-width="5"/>` +
      `<path d="M128 110 h64" stroke="#ff9be0" stroke-width="6" stroke-linecap="round"/><path d="M128 110 l12 -10 M128 110 l12 10 M192 110 l-12 -10 M192 110 l-12 10" stroke="#ff9be0" stroke-width="6" stroke-linecap="round"/>` +
      `<circle cx="160" cy="60" r="10" fill="none" stroke="#fff" stroke-width="4"/><text x="160" y="160" font-size="13" text-anchor="middle" fill="#fff" font-weight="700">DRAG · PINCH</text>`,
  );
}

function goalArt(): string {
  return svg(
    `<rect x="0" y="150" width="320" height="50" fill="${PITCH}"/><path d="M70 150 V50 H250 V150" stroke="#fff" stroke-width="7" fill="none"/>` +
      `<path d="M30 190 Q120 -10 228 70" stroke="#ff9be0" stroke-width="5" fill="none" stroke-linecap="round"/>` +
      ball(228, 72, 10) +
      [0, 1, 2].map((i) => ball(120 + i * 40, 178, 10)).join(''),
  );
}

export function pages(modes: ModeConfig[]): Page[] {
  return [
    {
      title: 'The aim',
      art: goalArt(),
      body: `Score from free kicks. You have <b>3 lives</b>. A goal refills them and takes you to a harder free kick: further out, wider angles, bigger walls and a better keeper. A miss costs a life and you retake the same kick.`,
    },
    {
      title: 'The shot ring',
      art: ringArt(),
      body: `A glowing ring appears around the ball. Its four segments light up in turn: <b>Height</b>, <b>Direction</b>, <b>Swerve</b> and <b>Dip</b>. A marker sweeps along the lit segment, so <b>tap</b> to lock it. After the fourth tap your player runs up and strikes. The markers get faster on later stages.`,
    },
    {
      title: 'Dip',
      art: flightArt(),
      body: `Dip is the secret of a great free kick. <b>Dip</b> (topspin) makes the ball dive late, so it clears the wall and still drops under the bar. <b>No spin</b> gives a plain arc. <b>Float</b> (backspin) holds the ball up so it carries. Lofted shots usually need plenty of dip.`,
    },
    {
      title: 'Swerve and direction',
      art: swerveArt(),
      body: `<b>Direction</b> picks a spot on the goal line from far left to far right. <b>Swerve</b> bends the ball in flight; the middle of the segment is straight. Aim outside the post and curl it back in, round the end of the wall.`,
    },
    {
      title: 'Scoring',
      art: scoringArt(),
      body: `Points depend on where the ball crosses the line, and the top corners score most. You also get a <b>swerve bonus</b>, and everything is multiplied by the difficulty of the kick. If the keeper or wall knocks it back out, a team-mate may score a <b>rebound</b>: that saves your life but only scores 100.`,
    },
    {
      title: 'Wind and weather',
      art: conditionsArt(),
      body: `The <b>wind gauge</b> arrow shows which way the wind is blowing, from your point of view. Allow for it. <b>Rain</b> makes the ball skid, puddles stop it dead and keepers fumble. <b>Snow</b> kills the bounce and the roll.`,
    },
    {
      title: 'Game modes',
      art: '',
      body: `<ul class="mode-list">${modes.map((m) => `<li><b>${m.name}</b>: ${m.description}</li>`).join('')}</ul>`,
    },
    {
      title: 'Camera and replays',
      art: cameraArt(),
      body: `While you aim, <b>drag</b> to look around and <b>pinch</b> to zoom (on a computer, use the mouse wheel). <b>VIEW</b> resets the camera. After every kick there's a replay: drag to orbit, <b>CAMERA</b> switches angle and <b>SKIP</b> moves on.`,
    },
  ];
}

/** Paged How to Play screen. */
export function howToPlay(modes: ModeConfig[], start: number, onBack: () => void): HTMLElement {
  const all = pages(modes);
  let i = Math.max(0, Math.min(start, all.length - 1));
  const art = el('div.htp-art');
  const title = el('h2.htp-title');
  const body = el('div.htp-body');
  const dots = el('div.htp-dots');
  const prev = el('button.btn.small', { text: '◀', onclick: () => go(i - 1) });
  const next = el('button.btn.small', { text: '▶', onclick: () => go(i + 1) });
  const render = () => {
    const p = all[i];
    title.textContent = `${i + 1}. ${p.title}`;
    art.innerHTML = p.art;
    art.style.display = p.art ? '' : 'none';
    body.innerHTML = p.body;
    dots.innerHTML = all.map((_, k) => `<span class="${k === i ? 'on' : ''}"></span>`).join('');
    (prev as HTMLButtonElement).disabled = i === 0;
    next.textContent = i === all.length - 1 ? 'DONE' : '▶';
  };
  const go = (k: number) => {
    if (k >= all.length) return onBack();
    i = Math.max(0, k);
    render();
  };
  render();
  return el('div.screen.htp', {}, [
    el('div.htp-head', {}, [el('div.label', { text: 'HOW TO PLAY' }), el('button.btn.small', { text: 'BACK', onclick: onBack })]),
    el('div.htp-page', {}, [art, el('div.htp-text', {}, [title, body])]),
    el('div.htp-nav', {}, [prev, dots, next]),
  ]);
}
