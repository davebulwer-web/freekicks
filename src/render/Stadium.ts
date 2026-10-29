import {
  BoxGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Object3D,
  PlaneGeometry,
  ShaderMaterial,
  Vector3,
} from 'three';
import type { AssetManager } from '../assets/AssetManager';
import type { StandDef } from '../assets/stadium';
import type { Kit } from '../config/types';
import { DEG } from '../core/math';
import { Rng } from '../core/Rng';
import { PITCH } from '../config/rules';
import { CharacterSprite } from './Characters';

const PRESS_KITS: Kit[] = [
  { pattern: 'plain', shirt1: '#f08a24', shirt2: '#f08a24', shorts: '#2b2b2b', socks: '#2b2b2b' },
  { pattern: 'plain', shirt1: '#e8e03a', shirt2: '#e8e03a', shorts: '#3a3a5a', socks: '#222222' },
  { pattern: 'plain', shirt1: '#7fb3e0', shirt2: '#7fb3e0', shorts: '#2b2b2b', socks: '#222222' },
];

/**
 * Stadium dressing built from the stadium layout: stands with crowd, advertising hoardings,
 * cameramen, dugouts, corner flags and any extra glTF models.
 */
export class Stadium {
  readonly group = new Group();
  readonly cameramen: CharacterSprite[] = [];
  private crowdMats: ShaderMaterial[] = [];
  private cameramanPos: Vector3[] = [];
  private time = 0;
  excitement = 0;

  constructor(private assets: AssetManager, shadowMat: MeshBasicMaterial) {
    const layout = assets.stadium;
    layout.stands.forEach((s, i) => this.buildStand(s, i));
    this.buildHoardings();
    layout.cameramen.forEach((c, i) => {
      const cm = new CharacterSprite(assets.manifest.characters.cameraman, assets, shadowMat, PRESS_KITS[i % PRESS_KITS.length]);
      this.cameramen.push(cm);
      this.cameramanPos.push(new Vector3(c.x, 0, c.z));
      this.group.add(cm.group);
    });
    layout.dugouts.forEach((d) => this.buildDugout(d.x, d.z, d.rotationDeg ?? 0));
    if (layout.cornerFlags) this.buildCornerFlags();
    void this.loadModels();
  }

  private buildStand(s: StandDef, index: number) {
    const g = new Group();
    g.position.set(s.x, 0, s.z);
    g.rotation.y = s.rotationDeg * DEG;
    const tex = this.assets.texture(this.assets.manifest.textures.stand, { repeat: true });
    const t = tex.clone();
    t.repeat.set(s.width / 4, 1);
    t.needsUpdate = true;
    const faceMat = new MeshLambertMaterial({ map: t });
    const plain = new MeshLambertMaterial({ color: 0x4a525c });
    // Rows step up and back (away from the pitch = -z in stand space).
    for (let r = 0; r < s.rows; r++) {
      const h = 1.2 + r * s.rowHeight;
      const box = new Mesh(new BoxGeometry(s.width, h, s.rowDepth), [plain, plain, plain, plain, faceMat, plain]);
      box.position.set(0, h / 2, -r * s.rowDepth - s.rowDepth / 2);
      g.add(box);
    }
    // Back wall
    const backH = 1.2 + s.rows * s.rowHeight + 3;
    const back = new Mesh(new BoxGeometry(s.width, backH, 0.5), plain);
    back.position.set(0, backH / 2, -s.rows * s.rowDepth - 0.25);
    g.add(back);
    // Roof
    const roof = new Mesh(new BoxGeometry(s.width, 0.3, s.rows * s.rowDepth * 0.8), new MeshLambertMaterial({ color: 0x2c3138 }));
    roof.position.set(0, backH, -s.rows * s.rowDepth * 0.55);
    g.add(roof);

    // Crowd
    const c = this.assets.manifest.crowd;
    const aspect = c.frameW / c.frameH;
    const quad = new PlaneGeometry(c.worldHeight * aspect, c.worldHeight).translate(0, c.worldHeight / 2, 0);
    const spacing = 0.58;
    const perRow = Math.floor(s.width / spacing);
    const rng = new Rng(1000 + index);
    const mats: Matrix4[] = [];
    const variant: number[] = [];
    const phase: number[] = [];
    const o = new Object3D();
    for (let r = 0; r < s.rows; r++) {
      for (let i = 0; i < perRow; i++) {
        if (!rng.chance(s.crowdDensity)) continue;
        o.position.set(-s.width / 2 + (i + 0.5) * spacing + rng.range(-0.08, 0.08), 1.2 + r * s.rowHeight - 0.05, -r * s.rowDepth - s.rowDepth * 0.55);
        o.updateMatrix();
        mats.push(o.matrix.clone());
        variant.push(rng.int(0, c.variants - 1));
        phase.push(rng.range(0, Math.PI * 2));
      }
    }
    const mat = new ShaderMaterial({
      uniforms: {
        atlas: { value: this.assets.texture(c.atlas) },
        variants: { value: c.variants },
        frames: { value: c.frames },
        time: { value: 0 },
        excite: { value: 0 },
      },
      vertexShader: /* glsl */ `
        attribute float variant;
        attribute float phase;
        uniform float time;
        uniform float excite;
        uniform float variants;
        uniform float frames;
        varying vec2 vUv;
        void main() {
          float wave = sin(time * (2.0 + excite * 7.0) + phase);
          float up = step(0.6 - excite * 0.9, wave) * step(0.05, excite);
          vec4 p = instanceMatrix * vec4(position, 1.0);
          p.y += up * 0.18 + wave * 0.015;
          vUv = vec2((uv.x + variant) / variants, (uv.y + (frames - 1.0 - up)) / frames);
          gl_Position = projectionMatrix * viewMatrix * modelMatrix * p;
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D atlas;
        varying vec2 vUv;
        void main() {
          vec4 c = texture2D(atlas, vUv);
          if (c.a < 0.5) discard;
          gl_FragColor = c;
          #include <colorspace_fragment>
        }`,
      side: DoubleSide,
    });
    const inst = new InstancedMesh(quad, mat, mats.length);
    mats.forEach((m, i) => inst.setMatrixAt(i, m));
    inst.geometry = quad.clone();
    inst.geometry.setAttribute('variant', new InstancedBufferAttribute(new Float32Array(variant), 1));
    inst.geometry.setAttribute('phase', new InstancedBufferAttribute(new Float32Array(phase), 1));
    inst.frustumCulled = false;
    g.add(inst);
    this.crowdMats.push(mat);
    this.group.add(g);
  }

  private buildHoardings() {
    const hoardings = this.assets.stadium.hoardings;
    const runs = hoardings.runs;
    const textures = this.assets.manifest.hoardings.map((p) => this.assets.texture(p));
    const mats = textures.map((t) => new MeshBasicMaterial({ map: t }));
    const backMat = new MeshLambertMaterial({ color: 0x30343a });
    let k = 0;
    for (const run of runs) {
      const a = new Vector3(run.from[0], 0, run.from[1]);
      const b = new Vector3(run.to[0], 0, run.to[1]);
      const len = a.distanceTo(b);
      const n = Math.max(1, Math.round(len / hoardings.panelWidth));
      const w = len / n;
      const dir = b.clone().sub(a).normalize();
      // Advert faces (-dir.z, dir.x): runs go anticlockwise round the pitch seen from above.
      const ang = Math.atan2(-dir.z, dir.x);
      for (let i = 0; i < n; i++) {
        const m = mats[k++ % mats.length];
        const box = new Mesh(new BoxGeometry(w - 0.05, hoardings.height, 0.12), [backMat, backMat, backMat, backMat, m, backMat]);
        const c = a.clone().addScaledVector(dir, (i + 0.5) * w);
        box.position.set(c.x, hoardings.height / 2, c.z);
        box.rotation.y = ang;
        this.group.add(box);
      }
    }
  }

  private buildDugout(x: number, z: number, rot: number) {
    const tex = this.assets.texture(this.assets.manifest.textures.dugout);
    const shell = new MeshLambertMaterial({ color: 0x252a31 });
    const front = new MeshBasicMaterial({ map: tex });
    const box = new Mesh(new BoxGeometry(6, 2.2, 1.8), [shell, shell, shell, shell, front, shell]);
    box.position.set(x, 1.1, z);
    box.rotation.y = rot * DEG;
    this.group.add(box);
  }

  private buildCornerFlags() {
    const pole = new MeshLambertMaterial({ color: 0xeeeeee });
    const flag = new MeshBasicMaterial({ color: 0xf2d21c, side: DoubleSide });
    const HW = PITCH.width / 2;
    for (const z of [0, PITCH.length])
      for (const sx of [-1, 1]) {
        const p = new Mesh(new CylinderGeometry(0.02, 0.02, 1.5, 6), pole);
        p.position.set(sx * HW, 0.75, z);
        const f = new Mesh(new PlaneGeometry(0.35, 0.25), flag);
        f.position.set(sx * HW + 0.17, 1.37, z);
        this.group.add(p, f);
      }
  }

  private async loadModels() {
    const models = this.assets.stadium.models;
    if (!models.length) return;
    const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
    const loader = new GLTFLoader();
    for (const m of models) {
      loader.load(
        './assets/' + m.file,
        (gltf) => {
          gltf.scene.position.set(m.x, m.y ?? 0, m.z);
          gltf.scene.rotation.y = (m.rotationDeg ?? 0) * DEG;
          gltf.scene.scale.setScalar(m.scale ?? 1);
          this.group.add(gltf.scene);
        },
        undefined,
        () => console.warn('Model failed to load:', m.file),
      );
    }
  }

  update(dt: number, camPos: Vector3) {
    this.time += dt;
    this.excitement = Math.max(0, this.excitement - dt * 0.15);
    for (const m of this.crowdMats) {
      m.uniforms.time.value = this.time;
      m.uniforms.excite.value = this.excitement;
    }
    this.cameramen.forEach((c, i) => {
      const pos = this.cameramanPos[i];
      c.update({ pos, jumpY: 0, heading: Math.atan2(-pos.x * 0.3, 20 - pos.z), anim: 'idle', animTime: this.time + i }, camPos);
    });
  }
}
