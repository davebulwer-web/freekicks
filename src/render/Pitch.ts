import { BufferGeometry, Float32BufferAttribute, Group, Mesh, MeshBasicMaterial, MeshLambertMaterial, PlaneGeometry, CircleGeometry } from 'three';
import type { AssetManager } from '../assets/AssetManager';
import { PITCH } from '../config/rules';

type P2 = [number, number];

/**
 * Pitch surface and markings, generated from the real IFAB dimensions on a single flat plane,
 * so the perspective is always geometrically correct.
 */
export function buildPitch(assets: AssetManager): Group {
  const g = new Group();
  const L = PITCH.length;
  const W = PITCH.width;

  const surround = assets.texture(assets.manifest.textures.surround, { repeat: true });
  surround.repeat.set(40, 40);
  const outer = new Mesh(new PlaneGeometry(260, 300).rotateX(-Math.PI / 2), new MeshLambertMaterial({ map: surround }));
  outer.position.set(0, -0.02, L / 2);
  g.add(outer);

  const grass = assets.texture(assets.manifest.textures.grass, { repeat: true });
  const gw = W + 12, gl = L + 12;
  grass.repeat.set(gw / 10.5, gl / 10.5);
  // Align stripe boundaries with the goal lines.
  grass.offset.set(0, (6 % 10.5) / 10.5);
  const field = new Mesh(new PlaneGeometry(gw, gl).rotateX(-Math.PI / 2), new MeshLambertMaterial({ map: grass }));
  field.position.set(0, 0, L / 2);
  field.receiveShadow = true;
  g.add(field);

  const lines = new Mesh(buildLines(), new MeshBasicMaterial({ color: 0xf4f4f4, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
  lines.position.y = 0.006;
  lines.name = 'lines';
  g.add(lines);

  // Penalty and centre spots
  const spotMat = lines.material as MeshBasicMaterial;
  for (const z of [PITCH.penaltySpot, L - PITCH.penaltySpot, L / 2]) {
    const s = new Mesh(new CircleGeometry(0.11, 16).rotateX(-Math.PI / 2), spotMat);
    s.position.set(0, 0.007, z);
    g.add(s);
  }
  return g;
}

export function buildLines(): BufferGeometry {
  const pos: number[] = [];
  const w = PITCH.lineWidth;
  const L = PITCH.length;
  const HW = PITCH.width / 2;

  // Each marking is a polyline; the line's width lies inside the measured area as the Laws require.
  const strip = (pts: P2[], closed = false) => {
    const n = pts.length;
    const segs = closed ? n : n - 1;
    for (let i = 0; i < segs; i++) {
      const [x1, z1] = pts[i];
      const [x2, z2] = pts[(i + 1) % n];
      const dx = x2 - x1, dz = z2 - z1;
      const len = Math.hypot(dx, dz);
      const nx = (-dz / len) * (w / 2), nz = (dx / len) * (w / 2);
      // extend a little so joints overlap without gaps
      const ex = (dx / len) * (w / 2), ez = (dz / len) * (w / 2);
      const a = [x1 - ex + nx, z1 - ez + nz], b = [x1 - ex - nx, z1 - ez - nz];
      const c = [x2 + ex - nx, z2 + ez - nz], d = [x2 + ex + nx, z2 + ez + nz];
      pos.push(a[0], 0, a[1], b[0], 0, b[1], c[0], 0, c[1], a[0], 0, a[1], c[0], 0, c[1], d[0], 0, d[1]);
    }
  };
  const arc = (cx: number, cz: number, r: number, a0: number, a1: number, n = 48): P2[] => {
    const pts: P2[] = [];
    for (let i = 0; i <= n; i++) {
      const a = a0 + ((a1 - a0) * i) / n;
      pts.push([cx + r * Math.sin(a), cz + r * Math.cos(a)]);
    }
    return pts;
  };
  const half = w / 2;

  // Boundary (inside edge of line on the boundary)
  strip([[-HW + half, half], [HW - half, half], [HW - half, L - half], [-HW + half, L - half]], true);
  strip([[-HW, L / 2], [HW, L / 2]]);
  strip(arc(0, L / 2, PITCH.centreCircleRadius - half, 0, Math.PI * 2, 96), true);

  for (const end of [0, 1]) {
    const Z = (z: number) => (end === 0 ? z : L - z);
    const box = (bw: number, bd: number) => {
      const hx = bw / 2 - half;
      strip([[-hx, Z(0)], [-hx, Z(bd - half)], [hx, Z(bd - half)], [hx, Z(0)]]);
    };
    box(PITCH.penaltyAreaWidth, PITCH.penaltyAreaDepth);
    box(PITCH.goalAreaWidth, PITCH.goalAreaDepth);
    // Penalty arc: the part of the 9.15 m circle round the spot outside the area.
    const r = PITCH.arcRadius - half;
    const lim = Math.acos((PITCH.penaltyAreaDepth - PITCH.penaltySpot) / r);
    const pts = arc(0, PITCH.penaltySpot, r, -lim, lim).map(([x, z]) => [x, Z(z)] as P2);
    strip(pts);
    // Corner arcs (1 m)
    const cr = PITCH.cornerArcRadius;
    for (const sx of [-1, 1]) {
      const cpts = arc(sx * HW, 0, cr, sx < 0 ? 0 : -Math.PI / 2, sx < 0 ? Math.PI / 2 : 0, 12).map(([x, z]) => [x, Z(z)] as P2);
      strip(cpts);
    }
  }

  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
  // Make all triangles face up regardless of winding.
  const p = geo.attributes.position.array as Float32Array;
  for (let i = 0; i < p.length; i += 9) {
    const ax = p[i], az = p[i + 2], bx = p[i + 3], bz = p[i + 5], cx = p[i + 6], cz = p[i + 8];
    const cross = (bx - ax) * (cz - az) - (bz - az) * (cx - ax);
    if (cross > 0) {
      for (let k = 0; k < 3; k++) [p[i + 3 + k], p[i + 6 + k]] = [p[i + 6 + k], p[i + 3 + k]];
    }
  }
  geo.computeVertexNormals();
  return geo;
}
