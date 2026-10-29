import { CylinderGeometry, DoubleSide, Group, Mesh, MeshBasicMaterial, MeshLambertMaterial, PlaneGeometry, Vector3 } from 'three';
import type { AssetManager } from '../assets/AssetManager';
import { HALF_GOAL, PITCH } from '../config/rules';
import { POST_X, POST_Z, BAR_Y, NET_BACK_Z } from '../physics/GoalFrame';

interface NetPanel {
  mesh: Mesh;
  rest: Float32Array;
  normal: Vector3;
}

/** Goal frame and net, matching the physics geometry in GoalFrame.ts. Supports net ripples. */
export class GoalMesh {
  readonly group = new Group();
  private panels: NetPanel[] = [];
  private impact: { pos: Vector3; strength: number; t: number } | null = null;

  constructor(assets: AssetManager) {
    const white = new MeshLambertMaterial({ color: 0xffffff });
    const R = PITCH.postRadius;
    for (const sx of [-1, 1]) {
      const post = new Mesh(new CylinderGeometry(R, R, BAR_Y + R, 12), white);
      post.position.set(sx * POST_X, (BAR_Y + R) / 2, POST_Z);
      this.group.add(post);
      const back = new Mesh(new CylinderGeometry(0.03, 0.03, PITCH.goalHeight, 8), white);
      back.position.set(sx * POST_X, PITCH.goalHeight / 2, NET_BACK_Z);
      this.group.add(back);
      const top = new Mesh(new CylinderGeometry(0.03, 0.03, -NET_BACK_Z, 8).rotateX(Math.PI / 2), white);
      top.position.set(sx * POST_X, PITCH.goalHeight, NET_BACK_Z / 2);
      this.group.add(top);
    }
    const bar = new Mesh(new CylinderGeometry(R, R, POST_X * 2 + R * 2, 12).rotateZ(Math.PI / 2), white);
    bar.position.set(0, BAR_Y, POST_Z);
    this.group.add(bar);

    const netTex = assets.texture(assets.manifest.textures.net, { repeat: true });
    const cell = 0.6; // metres per texture tile (4 meshes of 15 cm)
    const mk = (w: number, h: number, segW: number, segH: number) => {
      const t = netTex.clone();
      t.repeat.set(w / cell, h / cell);
      t.needsUpdate = true;
      return new Mesh(
        new PlaneGeometry(w, h, segW, segH),
        new MeshBasicMaterial({ map: t, transparent: true, alphaTest: 0.3, side: DoubleSide, depthWrite: false, opacity: 0.9 }),
      );
    };
    const gw = HALF_GOAL * 2 + 0.12;
    const back = mk(gw, PITCH.goalHeight, 36, 12);
    back.position.set(0, PITCH.goalHeight / 2, NET_BACK_Z);
    this.addPanel(back, new Vector3(0, 0, -1));
    const roof = mk(gw, -NET_BACK_Z, 36, 10);
    roof.rotation.x = -Math.PI / 2;
    roof.position.set(0, PITCH.goalHeight, NET_BACK_Z / 2);
    this.addPanel(roof, new Vector3(0, 1, 0));
    for (const sx of [-1, 1]) {
      const side = mk(-NET_BACK_Z, PITCH.goalHeight, 10, 12);
      side.rotation.y = Math.PI / 2;
      side.position.set(sx * POST_X, PITCH.goalHeight / 2, NET_BACK_Z / 2);
      this.addPanel(side, new Vector3(sx, 0, 0));
    }
  }

  private addPanel(mesh: Mesh, normal: Vector3) {
    mesh.updateMatrixWorld();
    this.group.add(mesh);
    const rest = (mesh.geometry.attributes.position.array as Float32Array).slice();
    this.panels.push({ mesh, rest, normal });
  }

  /** Impact position in goal-local coordinates. */
  hit(pos: Vector3, strength: number) {
    this.impact = { pos: pos.clone(), strength, t: 0 };
  }

  reset() {
    this.impact = null;
    for (const p of this.panels) {
      (p.mesh.geometry.attributes.position.array as Float32Array).set(p.rest);
      p.mesh.geometry.attributes.position.needsUpdate = true;
    }
  }

  update(dt: number) {
    if (!this.impact) return;
    const im = this.impact;
    im.t += dt;
    const amp = im.strength * 0.35 * Math.exp(-im.t * 3) * Math.cos(im.t * 11);
    const v = new Vector3();
    for (const p of this.panels) {
      const arr = p.mesh.geometry.attributes.position.array as Float32Array;
      p.mesh.updateMatrixWorld();
      for (let i = 0; i < arr.length; i += 3) {
        v.set(p.rest[i], p.rest[i + 1], p.rest[i + 2]);
        const w = v.clone().applyMatrix4(p.mesh.matrix);
        const d2 = w.distanceToSquared(im.pos);
        // displacement along local +z of the plane (its normal), outward
        arr[i + 2] = p.rest[i + 2] + amp * Math.exp(-d2 / 0.5) * (p.normal.z !== 0 ? -p.normal.z * -1 : 1) * (p.normal.x < 0 ? -1 : 1);
      }
      p.mesh.geometry.attributes.position.needsUpdate = true;
    }
    if (im.t > 2.5) this.reset();
  }
}
