import { CircleGeometry, CylinderGeometry, DoubleSide, Group, Mesh, MeshBasicMaterial, MeshLambertMaterial, Vector3 } from 'three';
import type { AssetManager } from '../assets/AssetManager';
import type { TargetBoard } from '../config/types';
import { BAR_Y, POST_Z } from '../physics/GoalFrame';

/** Depth behind the goal line where boards hang (inside the net). */
const BOARD_Z = -0.3;

interface Board {
  hinge: Group;
  index: number;
}

/**
 * Target Challenge boards: round targets hung on two ropes from the crossbar. A board the ball
 * passes through swings back into the net (driven by the match time, so replays match).
 */
export class Targets {
  readonly group = new Group();
  private boards: Board[] = [];
  private faceMat: MeshBasicMaterial;
  private ropeMat = new MeshLambertMaterial({ color: 0xe8e2c8 });

  constructor(assets: AssetManager) {
    this.faceMat = new MeshBasicMaterial({ map: assets.texture(assets.manifest.textures.target), side: DoubleSide });
  }

  set(targets: TargetBoard[] | undefined) {
    this.group.clear();
    this.boards = [];
    (targets ?? []).forEach((t, index) => {
      // Hinge along the top edge of the board.
      const hinge = new Group();
      hinge.position.set(t.x, t.y + t.r, BOARD_Z);
      const face = new Mesh(new CircleGeometry(t.r, 40), this.faceMat);
      face.position.y = -t.r;
      hinge.add(face);
      this.group.add(hinge);
      for (const sx of [-0.6, 0.6]) {
        const top = new Vector3(t.x + sx * t.r, BAR_Y, POST_Z);
        const bottom = new Vector3(t.x + sx * t.r, t.y + t.r * 0.8, BOARD_Z);
        const len = top.distanceTo(bottom);
        const rope = new Mesh(new CylinderGeometry(0.008, 0.008, len, 5), this.ropeMat);
        rope.position.copy(top).add(bottom).multiplyScalar(0.5);
        rope.lookAt(bottom);
        rope.rotateX(Math.PI / 2);
        this.group.add(rope);
      }
      this.boards.push({ hinge, index });
    });
  }

  /** hit = board index and the match time it was hit; t = current (or replay) time. */
  update(hit: { index: number; time: number } | null, t: number) {
    for (const b of this.boards) {
      let angle = 0;
      if (hit && hit.index === b.index && t >= hit.time) {
        const dt = t - hit.time;
        // Knocked back, then a damped swing.
        angle = 1.15 * (1 - Math.exp(-dt * 9)) + 0.35 * Math.exp(-dt * 2.2) * Math.sin(dt * 7);
      }
      b.hinge.rotation.x = angle;
    }
  }
}
