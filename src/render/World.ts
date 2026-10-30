import {
  AmbientLight,
  BoxGeometry,
  CylinderGeometry,
  Group,
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
import { buildPitch, type PitchView } from './Pitch';
import { Stadium } from './Stadium';
import { Targets } from './Targets';
import { Weather } from './Weather';

/** Owns the Three.js scene: pitch, goals, stadium, characters, ball and weather. */
export class World {
  readonly scene = new Scene();
  readonly renderer: WebGLRenderer;
  readonly director: CameraDirector;
  readonly goal: GoalMesh;
  readonly stadium: Stadium;
  readonly weather = new Weather();
  readonly targets: Targets;
  private night = false;
  private weatherKind: WeatherKind = 'clear';
  private windVec = new Vector3();
  private flood: DirectionalLight[] = [];
  private ambient = new AmbientLight(0xffffff, 0.25);
  private floodlights: Group;
  private pitch: PitchView;
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
    this.scene.add(this.hemi, this.sun, this.ambient);
    // Extra key lights from the floodlight corners (night only).
    for (const [x, z] of [[48, -16], [-48, PITCH.length + 16]]) {
      const f = new DirectionalLight(0xfff4e0, 0);
      f.position.set(x, 35, z);
      f.target.position.set(0, 0, PITCH.length / 2);
      this.scene.add(f, f.target);
      this.flood.push(f);
    }

    const skyTex = assets.texture(assets.manifest.textures.sky);
    this.sky = new Mesh(new SphereGeometry(600, 32, 16), new MeshBasicMaterial({ map: skyTex, side: BackSide, fog: false }));
    this.sky.position.set(0, 0, PITCH.length / 2);
    this.scene.add(this.sky);
    this.scene.fog = new Fog(0xc8d8e8, 250, 700);

    this.pitch = buildPitch(assets);
    this.scene.add(this.pitch.group);
    this.goal = new GoalMesh(assets);
    this.scene.add(this.goal.group);
    const farGoal = new GoalMesh(assets);
    farGoal.group.position.z = PITCH.length;
    farGoal.group.rotation.y = Math.PI;
    this.scene.add(farGoal.group);

    this.shadowMat = new MeshBasicMaterial({ map: assets.texture(assets.manifest.textures.shadow), transparent: true, depthWrite: false });
    this.stadium = new Stadium(assets, this.shadowMat);
    this.scene.add(this.stadium.group);
    this.floodlights = this.buildFloodlights();
    this.targets = new Targets(assets);
    this.scene.add(this.floodlights, this.targets.group);

    const ballTex = assets.texture(assets.manifest.textures.ball);
    this.ball = new Mesh(new SphereGeometry(BALL_RADIUS, 24, 16), new MeshLambertMaterial({ map: ballTex }));
    this.ballShadow = new Mesh(new PlaneGeometry(1, 1).rotateX(-Math.PI / 2), this.shadowMat);
    this.ballShadow.renderOrder = 1;
    this.scene.add(this.ball, this.ballShadow, this.weather.group, this.weather.bursts);
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
    this.targets.set(match.setup.targets);
    this.setWeather(match.setup.weather, match.env.wind);
  }

  /** Floodlit evening match (applied together with the weather). */
  setNight(on: boolean) {
    this.night = on;
    this.floodlights.visible = on;
    this.setWeather(this.weatherKind, this.windVec);
  }

  setWeather(kind: WeatherKind, wind: Vector3) {
    this.weatherKind = kind;
    this.windVec.copy(wind);
    this.weather.set(kind, wind);
    this.pitch.setSurface(kind);
    const n = this.night;
    const dim = kind === 'rain' ? 0.72 : kind === 'snow' ? 0.9 : 1;
    // Night: dim blue moonlight plus warm floodlights from the corner towers.
    this.hemi.intensity = (n ? 0.32 : 1.6) * dim;
    this.hemi.color.set(n ? 0x8fa6d8 : 0xdfefff);
    this.ambient.intensity = n ? 0.04 : 0.25;
    this.sun.intensity = n ? 0.25 : kind === 'clear' ? 1.6 : 0.6;
    this.sun.color.set(n ? 0xaabbff : 0xffffff);
    this.flood.forEach((f) => (f.intensity = n ? 0.85 * dim : 0));
    const fog = this.scene.fog as Fog;
    fog.color = new Color(n ? (kind === 'rain' ? 0x1a2028 : 0x0b1020) : kind === 'rain' ? 0x7a8590 : kind === 'snow' ? 0xe6ecf2 : 0xc8d8e8);
    fog.near = kind === 'clear' ? (n ? 160 : 250) : 40;
    fog.far = kind === 'clear' ? (n ? 520 : 700) : 260;
    (this.sky.material as MeshBasicMaterial).color = new Color(n ? 0x1c2440 : kind === 'rain' ? 0x8899aa : kind === 'snow' ? 0xdde4ea : 0xffffff);
    const tint = (kind === 'rain' ? 0.75 : kind === 'snow' ? 0.95 : 1) * (n ? 0.62 : 1);
    this.sprites.forEach((s) => s.setTint(tint * (n ? 0.95 : 1), tint, tint * (kind === 'snow' || n ? 1.05 : 1)));
    this.stadium.setCrowdTint((n ? 0.2 : 1) * (kind === 'rain' ? 0.8 : 1));
  }

  private buildFloodlights(): Group {
    const g = new Group();
    const steel = new MeshLambertMaterial({ color: 0x8a9099 });
    const lamp = new MeshBasicMaterial({ map: this.assets.texture(this.assets.manifest.textures.floodlight) });
    const back = new MeshLambertMaterial({ color: 0x30343a });
    for (const [x, z] of [[-48, -16], [48, -16], [-48, PITCH.length + 16], [48, PITCH.length + 16]]) {
      const pole = new Mesh(new CylinderGeometry(0.5, 0.9, 34, 8), steel);
      pole.position.set(x, 17, z);
      const head = new Mesh(new BoxGeometry(9, 4.5, 0.8), [back, back, back, back, lamp, back]);
      head.position.set(x, 35, z);
      head.lookAt(0, 0, PITCH.length / 2);
      g.add(pole, head);
    }
    g.visible = false;
    return g;
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
    this.targets.update(m.targetHit, m.time);
    this.place(m.ball.pos, m.ball.rot, m.people, m.keeper.pos, m.phase === 'live', dt);
    this.draw();
  }

  private lastReplayHit = -1;
  renderReplay(s: ReplayState, t: number, keeperIndex: number, dt: number, targetHit: { index: number; time: number } | null = null) {
    this.targets.update(targetHit, t);
    const hit = s.netHits.findIndex((h) => h.t <= t && h.t > t - 0.05);
    if (hit >= 0 && hit !== this.lastReplayHit) {
      this.goal.hit(s.netHits[hit].pos, s.netHits[hit].strength);
      this.lastReplayHit = hit;
    }
    if (hit < 0) this.lastReplayHit = -1;
    this.stadium.holdExcitement(s.excitement);
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
