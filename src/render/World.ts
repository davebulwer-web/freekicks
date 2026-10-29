import {
  AmbientLight,
  BackSide,
  Color,
  DirectionalLight,
  Fog,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PlaneGeometry,
  Quaternion,
  Scene,
  SphereGeometry,
  Vector3,
  WebGLRenderer,
} from 'three';
import type { AssetManager } from '../assets/AssetManager';
import { CameraDirector } from '../camera/CameraDirector';
import { PITCH } from '../config/rules';
import type { Team, WeatherKind } from '../config/types';
import { REFEREE_KIT } from '../game/Teams';
import { BALL_RADIUS } from '../physics/Ball';
import type { ReplayState } from '../replay/Recorder';
import type { Match } from '../sim/Match';
import { CharacterSprite, type CharacterPose } from './Characters';
import { GoalMesh } from './GoalMesh';
import { buildPitch } from './Pitch';
import { Stadium } from './Stadium';
import { Weather } from './Weather';

/** Owns the Three.js scene: pitch, goals, stadium, characters, ball and weather. */
export class World {
  readonly scene = new Scene();
  readonly renderer: WebGLRenderer;
  readonly director: CameraDirector;
  readonly goal: GoalMesh;
  readonly stadium: Stadium;
  readonly weather = new Weather();
  private shadowMat: MeshBasicMaterial;
  private ball: Mesh;
  private ballShadow: Mesh;
  private sprites: CharacterSprite[] = [];
  private hemi: HemisphereLight;
  private sun: DirectionalLight;
  private sky: Mesh;

  constructor(canvas: HTMLCanvasElement, private assets: AssetManager) {
    this.renderer = new WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.director = new CameraDirector(canvas.clientWidth / Math.max(1, canvas.clientHeight));

    this.hemi = new HemisphereLight(0xdfefff, 0x3a5a2a, 1.6);
    this.sun = new DirectionalLight(0xffffff, 1.6);
    this.sun.position.set(-30, 60, 40);
    this.scene.add(this.hemi, this.sun, new AmbientLight(0xffffff, 0.25));

    const skyTex = assets.texture(assets.manifest.textures.sky);
    this.sky = new Mesh(new SphereGeometry(600, 32, 16), new MeshBasicMaterial({ map: skyTex, side: BackSide, fog: false }));
    this.sky.position.set(0, 0, PITCH.length / 2);
    this.scene.add(this.sky);
    this.scene.fog = new Fog(0xc8d8e8, 250, 700);

    this.scene.add(buildPitch(assets));
    this.goal = new GoalMesh(assets);
    this.scene.add(this.goal.group);
    const farGoal = new GoalMesh(assets);
    farGoal.group.position.z = PITCH.length;
    farGoal.group.rotation.y = Math.PI;
    this.scene.add(farGoal.group);

    this.shadowMat = new MeshBasicMaterial({ map: assets.texture(assets.manifest.textures.shadow), transparent: true, depthWrite: false });
    this.stadium = new Stadium(assets, this.shadowMat);
    this.scene.add(this.stadium.group);

    const ballTex = assets.texture(assets.manifest.textures.ball);
    this.ball = new Mesh(new SphereGeometry(BALL_RADIUS, 24, 16), new MeshLambertMaterial({ map: ballTex }));
    this.ballShadow = new Mesh(new PlaneGeometry(1, 1).rotateX(-Math.PI / 2), this.shadowMat);
    this.ballShadow.renderOrder = 1;
    this.scene.add(this.ball, this.ballShadow, this.weather.group);
  }

  /** Create a sprite per person in the match, dressed in the right kit. */
  bindMatch(match: Match, home: Team, away: Team) {
    this.sprites.forEach((s) => this.scene.remove(s.group));
    this.sprites = match.people.map((p) => {
      const kit = p.role === 'referee' ? REFEREE_KIT : p.role === 'keeper' ? away.keeper : p.side === 'attack' ? home.kit : away.kit;
      const s = new CharacterSprite(this.assets.manifest.characters.people, this.assets, this.shadowMat, kit);
      this.scene.add(s.group);
      return s;
    });
    this.director.setFreeKick(match.ballStart);
    this.goal.reset();
    this.setWeather(match.setup.weather, match.env.wind);
  }

  setWeather(kind: WeatherKind, wind: Vector3) {
    this.weather.set(kind, wind);
    const dim = kind === 'rain' ? 0.72 : kind === 'snow' ? 0.9 : 1;
    this.hemi.intensity = 1.6 * dim;
    this.sun.intensity = kind === 'clear' ? 1.6 : 0.6;
    (this.scene.fog as Fog).color = new Color(kind === 'rain' ? 0x7a8590 : kind === 'snow' ? 0xe6ecf2 : 0xc8d8e8);
    (this.scene.fog as Fog).near = kind === 'clear' ? 250 : 40;
    (this.scene.fog as Fog).far = kind === 'clear' ? 700 : 260;
    (this.sky.material as MeshBasicMaterial).color = new Color(kind === 'rain' ? 0x8899aa : kind === 'snow' ? 0xdde4ea : 0xffffff);
    const tint = kind === 'rain' ? 0.75 : kind === 'snow' ? 0.95 : 1;
    this.sprites.forEach((s) => s.setTint(tint, tint, tint * (kind === 'snow' ? 1.05 : 1)));
  }

  private place(ballPos: Vector3, ballRot: Quaternion, people: CharacterPose[], keeper: Vector3, live: boolean, dt: number) {
    this.director.update(dt, ballPos, keeper, live);
    const cam = this.director.camera.position;
    this.ball.position.copy(ballPos);
    this.ball.quaternion.copy(ballRot);
    const h = Math.max(0, ballPos.y - BALL_RADIUS);
    const s = 0.32 * (1 + h * 0.08);
    this.ballShadow.position.set(ballPos.x, 0.012, ballPos.z);
    this.ballShadow.scale.set(s, 1, s);
    (this.ballShadow.material as MeshBasicMaterial).opacity = 1;
    people.forEach((p, i) => this.sprites[i]?.update(p, cam));
    this.stadium.update(dt, cam);
    this.goal.update(dt);
    this.weather.update(dt, this.director.camera.position);
  }

  renderLive(m: Match, dt: number) {
    if (m.netImpact) {
      this.goal.hit(m.netImpact.pos, m.netImpact.strength);
      m.netImpact = null;
    }
    this.place(m.ball.pos, m.ball.rot, m.people, m.keeper.pos, m.phase === 'live', dt);
    this.draw();
  }

  private lastReplayHit = -1;
  renderReplay(s: ReplayState, t: number, keeperIndex: number, dt: number) {
    const hit = s.netHits.findIndex((h) => h.t <= t && h.t > t - 0.05);
    if (hit >= 0 && hit !== this.lastReplayHit) {
      this.goal.hit(s.netHits[hit].pos, s.netHits[hit].strength);
      this.lastReplayHit = hit;
    }
    if (hit < 0) this.lastReplayHit = -1;
    this.place(s.ballPos, s.ballRot, s.people, s.people[keeperIndex]?.pos ?? new Vector3(), true, dt);
    this.draw();
  }

  draw() {
    this.renderer.render(this.scene, this.director.camera);
  }

  resize(w: number, h: number) {
    this.renderer.setSize(w, h, false);
    this.director.resize(w / Math.max(1, h));
  }
}
