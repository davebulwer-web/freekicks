import { Group, Mesh, MeshBasicMaterial, PlaneGeometry, ShaderMaterial, Vector3, Vector4 } from 'three';
import type { AssetManager } from '../assets/AssetManager';
import type { CharacterSet } from '../assets/manifest';
import type { Kit } from '../config/types';
import { wrapAngle } from '../core/math';
import { applyKit, createKitMaterial } from './KitMaterial';

const plane = new PlaneGeometry(1, 1).translate(0, 0.5, 0);
const shadowPlane = new PlaneGeometry(1, 1).rotateX(-Math.PI / 2);

export interface CharacterPose {
  pos: Vector3;
  jumpY: number;
  heading: number;
  anim: string;
  animTime: number;
}

/**
 * A billboard character: a camera-facing quad that picks the sprite row from the angle between
 * the character's heading and the camera, and the column from its animation.
 */
export class CharacterSprite {
  readonly group = new Group();
  readonly mesh: Mesh;
  readonly shadow: Mesh;
  private materials: Record<string, ShaderMaterial> = {};
  private current = '';

  constructor(
    private set: CharacterSet,
    assets: AssetManager,
    shadowMat: MeshBasicMaterial,
    kit?: Kit,
  ) {
    for (const [name, sh] of Object.entries(set.sheets)) {
      const mat = createKitMaterial(
        assets.texture(sh.base),
        sh.mask ? assets.texture(sh.mask, { data: true }) : null,
        sh.uv ? assets.texture(sh.uv, { data: true }) : null,
      );
      if (kit) applyKit(mat, kit);
      this.materials[name] = mat;
    }
    this.mesh = new Mesh(plane, Object.values(this.materials)[0]);
    this.mesh.frustumCulled = false;
    this.shadow = new Mesh(shadowPlane, shadowMat);
    this.shadow.position.y = 0.015;
    this.shadow.scale.set(0.9, 1, 0.6);
    this.shadow.renderOrder = 1;
    this.group.add(this.mesh, this.shadow);
  }

  setKit(kit: Kit) {
    Object.values(this.materials).forEach((m) => applyKit(m, kit));
  }

  setTint(r: number, g: number, b: number) {
    Object.values(this.materials).forEach((m) => (m.uniforms.tint.value as Vector3).set(r, g, b));
  }

  update(p: CharacterPose, camPos: Vector3) {
    const def = this.set.anims[p.anim] ?? this.set.anims.idle;
    const sheet = this.set.sheets[def.sheet];
    if (this.current !== def.sheet) {
      this.current = def.sheet;
      this.mesh.material = this.materials[def.sheet];
      this.mesh.scale.set(sheet.frameW / this.set.pixelsPerMetre, sheet.frameH / this.set.pixelsPerMetre, 1);
    }
    const ppm = this.set.pixelsPerMetre;
    this.group.position.set(p.pos.x, 0, p.pos.z);
    this.mesh.position.y = p.jumpY - this.set.footY / ppm;
    const toCam = Math.atan2(camPos.x - p.pos.x, camPos.z - p.pos.z);
    this.mesh.rotation.y = toCam;
    const step = (Math.PI * 2) / this.set.directions;
    const row = ((Math.round(wrapAngle(p.heading - toCam) / step) % this.set.directions) + this.set.directions) % this.set.directions;
    const n = Math.floor(p.animTime * def.fps);
    const f = def.loop ? n % def.count : Math.min(n, def.count - 1);
    const col = def.start + f;
    const W = sheet.frameW * sheet.columns;
    const H = sheet.frameH * sheet.rows;
    const fr = this.materials[def.sheet].uniforms.frame.value as Vector4;
    fr.set((col * sheet.frameW) / W, 1 - ((row + 1) * sheet.frameH) / H, sheet.frameW / W, sheet.frameH / H);
    const s = Math.max(0.4, 1 - p.jumpY * 0.4);
    this.shadow.scale.set(0.9 * s, 1, 0.6 * s);
    if (p.anim.startsWith('dive')) this.shadow.scale.set(1.6, 1, 0.8);
  }
}
