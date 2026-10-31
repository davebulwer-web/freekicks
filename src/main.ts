import './styles.css';
import { AssetManager } from './assets/AssetManager';
import { Game } from './game/Game';
import { Menus } from './ui/Menus';

const canvas = document.getElementById('scene') as HTMLCanvasElement;
const ui = document.getElementById('ui') as HTMLElement;

async function boot() {
  const assets = new AssetManager();
  const loader = new Menus(ui, assets);
  await assets.load((d, t) => loader.loading(d, t));
  loader.root.remove();
  if (assets.placeholdersUsed.length) console.info('Generated placeholders for missing assets:', assets.placeholdersUsed);

  const game = new Game(canvas, ui, assets);
  (window as unknown as { game: Game }).game = game;

  const resize = () => game.world.resize(window.innerWidth, window.innerHeight);
  window.addEventListener('resize', resize);
  resize();

  bindInput(canvas.parentElement!, game);

  let last = performance.now();
  const frame = (now: number) => {
    requestAnimationFrame(frame);
    try {
      game.update((now - last) / 1000);
    } catch (e) {
      console.error(e);
    }
    last = now;
  };
  requestAnimationFrame(frame);
}

/** Tap = lock a ring segment; drag = orbit the camera; two-finger pinch = zoom. */
function bindInput(target: HTMLElement, game: Game) {
  const pointers = new Map<number, { x: number; y: number; sx: number; sy: number; t: number }>();
  let pinchDist = 0;
  let dragged = false;
  target.addEventListener('pointerdown', (e) => {
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: performance.now() });
    if (pointers.size === 1) dragged = false;
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
      dragged = true;
    }
  });
  target.addEventListener('pointermove', (e) => {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinchDist > 0) game.pinch(d / pinchDist);
      pinchDist = d;
      return;
    }
    if (Math.hypot(e.clientX - p.sx, e.clientY - p.sy) > 12) dragged = true;
    if (dragged) game.drag(dx, dy);
  });
  const up = (e: PointerEvent) => {
    const p = pointers.get(e.pointerId);
    pointers.delete(e.pointerId);
    if (p && !dragged && pointers.size === 0 && performance.now() - p.t < 600) game.tap();
  };
  target.addEventListener('pointerup', up);
  target.addEventListener('pointercancel', (e) => pointers.delete(e.pointerId));
  target.addEventListener('wheel', (e) => game.pinch(e.deltaY < 0 ? 1.08 : 0.93), { passive: true });
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space' || e.code === 'Enter') game.tap();
  });
}

void boot();
