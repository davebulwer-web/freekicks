import { Camera, DoubleSide, Group, Mesh, MeshBasicMaterial, PlaneGeometry, ShaderMaterial, Texture, Vector2, Vector3 } from 'three';

/** Ring size around the ball (metres) and layout. */
export const RING = {
  inner: 1.55,
  outer: 2.15,
  /** Total arc (degrees); the opening is at the bottom, under the ball. */
  arc: 250,
  gapDeg: 5,
  segments: 4,
} as const;

const HALF = 2.9; // half-size of the quad, leaving room for the glow and icons

const vertex = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const fragment = /* glsl */ `
uniform float time;
uniform float activeSeg;     // index of the sweeping segment (4 = all locked)
uniform float values[4];   // 0..1 marker position per segment
uniform vec2 deadZone;     // Swerve dead zone (start, end) in 0..1, or (0,0)
uniform float rIn;
uniform float rOut;
uniform float halfSize;
uniform float arcRad;
uniform float gapRad;
varying vec2 vUv;

const vec3 FILL = vec3(0.93, 0.84, 0.97);
const vec3 EDGE = vec3(0.38, 0.17, 0.45);
const vec3 GLOW = vec3(1.0, 0.86, 1.0);

float sdRoundBox(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

float hash(float n) { return fract(sin(n) * 43758.5453); }
float noise1(float x) {
  float i = floor(x), f = fract(x);
  return mix(hash(i), hash(i + 1.0), f * f * (3.0 - 2.0 * f));
}

void main() {
  vec2 p = (vUv - 0.5) * 2.0 * halfSize;
  // Screen-facing: p.y is up, p.x is right; the arc is centred on 'up'.
  float r = length(p);
  float th = atan(p.x, p.y);
  float segW = (arcRad - 3.0 * gapRad) / 4.0;
  float u = th + arcRad * 0.5;
  float rMid = 0.5 * (rIn + rOut);
  float thick = 0.5 * (rOut - rIn);

  vec4 col = vec4(0.0);
  // Evaluate the nearest two segments so glows can spill across gaps.
  for (int k = 0; k < 4; k++) {
    float i = float(k);
    float start = i * (segW + gapRad);
    float centre = start + segW * 0.5;
    // Arc-length coordinates relative to this segment's centre.
    float da = (u - centre) * rMid;
    vec2 q = vec2(da, r - rMid);
    float sd = sdRoundBox(q, vec2(segW * 0.5 * rMid, thick), 0.12);
    float t = clamp((u - start) / segW, 0.0, 1.0);

    bool isActive = abs(i - activeSeg) < 0.5;
    bool locked = i < activeSeg - 0.5;
    float pulse = isActive ? 0.75 + 0.25 * sin(time * 7.0) : 1.0;

    // Spiky glow halo around the active segment (like electric fuzz).
    if (isActive && sd > 0.0) {
      float spikes = noise1(th * 70.0 + time * 11.0) * noise1(th * 27.0 - time * 6.0);
      float reach = 0.07 + 0.45 * spikes * spikes;
      float g = min(1.0, exp(-sd / reach) * (0.6 + 0.6 * pulse));
      col.rgb += GLOW * g * (1.0 - col.a);
      col.a = max(col.a, g);
    } else if (locked && sd > 0.0) {
      float g = exp(-sd / 0.05) * 0.35;
      col.rgb += GLOW * g * (1.0 - col.a);
      col.a = max(col.a, g * 0.6);
    }

    if (sd < 0.0) {
      vec3 fill = FILL;
      if (k == 0) fill = mix(vec3(0.80, 0.90, 1.0), vec3(1.0, 0.78, 0.86), t); // height: low -> high
      if (k == 2 && deadZone.y > deadZone.x && t > deadZone.x && t < deadZone.y) fill = mix(fill, vec3(1.0, 0.35, 0.4), 0.55);
      float a = isActive ? 1.0 : locked ? 0.95 : 0.5;
      vec3 c = fill * (isActive ? 0.9 + 0.1 * pulse : locked ? 0.95 : 0.7);
      // Centre "no spin" tick on swerve and dip.
      if ((k == 2 || k == 3) && abs(t - 0.5) * segW * rMid < 0.025) c = mix(c, EDGE, 0.7);
      // Outline
      float edge = smoothstep(-0.07, -0.03, sd);
      c = mix(c, EDGE, edge);
      // Value marker: bright notch (sweeping on the active segment, fixed when locked).
      if (isActive || locked) {
        float d = abs(t - values[k]) * segW * rMid;
        float notch = 1.0 - smoothstep(0.035, 0.06, d);
        c = mix(c, isActive ? vec3(1.0) : vec3(0.35, 0.1, 0.45), notch);
        if (isActive) a = max(a, notch);
      }
      col = vec4(c, a);
    }
  }
  if (col.a < 0.01) discard;
  gl_FragColor = col;
  #include <colorspace_fragment>
}
`;

/**
 * Glowing arched shot control around the ball, always facing the camera and drawn on top:
 * four segments (Height, Direction, Swerve, Dip) read left to right over the top of the ball.
 */
export class ShotRing {
  readonly group = new Group();
  private mat: ShaderMaterial;
  private time = 0;

  constructor(icons: Texture) {
    this.mat = new ShaderMaterial({
      uniforms: {
        time: { value: 0 },
        activeSeg: { value: 0 },
        values: { value: [0.5, 0.5, 0.5, 0.5] },
        deadZone: { value: new Vector2(0, 0) },
        rIn: { value: RING.inner },
        rOut: { value: RING.outer },
        halfSize: { value: HALF },
        arcRad: { value: (RING.arc * Math.PI) / 180 },
        gapRad: { value: (RING.gapDeg * Math.PI) / 180 },
      },
      vertexShader: vertex,
      fragmentShader: fragment,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      side: DoubleSide,
    });
    const quad = new Mesh(new PlaneGeometry(HALF * 2, HALF * 2), this.mat);
    quad.renderOrder = 20;
    this.group.add(quad);

    // Icons just outside each segment.
    const arc = (RING.arc * Math.PI) / 180;
    const gap = (RING.gapDeg * Math.PI) / 180;
    const segW = (arc - 3 * gap) / 4;
    for (let i = 0; i < RING.segments; i++) {
      const t = icons.clone();
      t.repeat.set(1 / 4, 1);
      t.offset.set(i / 4, 0);
      t.needsUpdate = true;
      const icon = new Mesh(new PlaneGeometry(0.85, 0.85), new MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, depthTest: false }));
      const th = -arc / 2 + i * (segW + gap) + segW / 2;
      const r = RING.outer + 0.5;
      icon.position.set(Math.sin(th) * r, Math.cos(th) * r, 0);
      icon.renderOrder = 21;
      this.group.add(icon);
    }
    this.group.visible = false;
  }

  /** Centre the ring on the ball. */
  place(ball: Vector3) {
    this.group.position.copy(ball);
  }

  /** Billboard: keep the ring square-on to the camera. */
  face(camera: Camera) {
    this.group.quaternion.copy(camera.quaternion);
  }

  update(dt: number, visible: boolean, active: number, values: number[], deadZone: [number, number] = [0, 0]) {
    this.group.visible = visible;
    if (!visible) return;
    this.time += dt;
    const u = this.mat.uniforms;
    u.time.value = this.time;
    u.activeSeg.value = active;
    (u.values.value as number[]).splice(0, 4, ...values);
    (u.deadZone.value as Vector2).set(deadZone[0], deadZone[1]);
  }
}
