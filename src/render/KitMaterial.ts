import { Color, ShaderMaterial, Texture, Vector3, Vector4 } from 'three';
import type { Kit, KitPattern } from '../config/types';

export const PATTERN_IDS: Record<KitPattern, number> = { plain: 0, stripes: 1, hoops: 2, halves: 3, sash: 4 };

/** Shared GLSL for kit patterns. Mirrored on the CPU in kitPreview.ts. */
export const PATTERN_GLSL = /* glsl */ `
float kitPattern(vec2 suv, float pattern, float count) {
  float u = suv.x;
  float v = suv.y;
  if (pattern < 0.5) return 0.0;
  if (pattern < 1.5) return step(0.5, fract(u * count * 2.0));
  if (pattern < 2.5) return step(0.5, fract(v * count * 0.5));
  if (pattern < 3.5) return step(0.5, u);
  float a = u * 6.2831853;
  float xf = sin(a);
  return step(abs(xf - (1.0 - 2.0 * v)), 0.38);
}
`;

const vertex = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const fragment = /* glsl */ `
uniform sampler2D map;
uniform sampler2D maskMap;
uniform sampler2D uvMap;
uniform vec4 frame;
uniform vec3 shirt1;
uniform vec3 shirt2;
uniform vec3 shorts;
uniform vec3 socks;
uniform float pattern;
uniform float patternCount;
uniform float hasKit;
uniform vec3 tint;
varying vec2 vUv;
${PATTERN_GLSL}
void main() {
  vec2 st = frame.xy + vUv * frame.zw;
  vec4 base = texture2D(map, st);
  if (base.a < 0.5) discard;
  vec3 col = base.rgb;
  if (hasKit > 0.5) {
    vec3 m = texture2D(maskMap, st).rgb;
    // Kit areas in the base layer are greyscale lighting; 0.8 sRGB grey (0.604 linear) = full colour.
    float lum = base.r / 0.604;
    if (m.r > 0.5) {
      float p = kitPattern(texture2D(uvMap, st).rg, pattern, patternCount);
      col = mix(shirt1, shirt2, p) * lum;
    } else if (m.g > 0.5) {
      col = shorts * lum;
    } else if (m.b > 0.5) {
      col = socks * lum;
    }
  }
  gl_FragColor = vec4(col * tint, 1.0);
  #include <colorspace_fragment>
}
`;

export function createKitMaterial(map: Texture, mask: Texture | null, uv: Texture | null): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      map: { value: map },
      maskMap: { value: mask ?? map },
      uvMap: { value: uv ?? map },
      frame: { value: new Vector4(0, 0, 1, 1) },
      shirt1: { value: new Color('#ffffff') },
      shirt2: { value: new Color('#ffffff') },
      shorts: { value: new Color('#ffffff') },
      socks: { value: new Color('#ffffff') },
      pattern: { value: 0 },
      patternCount: { value: 6 },
      hasKit: { value: mask ? 1 : 0 },
      tint: { value: new Vector3(1, 1, 1) },
    },
    vertexShader: vertex,
    fragmentShader: fragment,
  });
}

export function applyKit(mat: ShaderMaterial, kit: Kit) {
  const u = mat.uniforms;
  (u.shirt1.value as Color).set(kit.shirt1);
  (u.shirt2.value as Color).set(kit.shirt2);
  (u.shorts.value as Color).set(kit.shorts);
  (u.socks.value as Color).set(kit.socks);
  u.pattern.value = PATTERN_IDS[kit.pattern] ?? 0;
  u.patternCount.value = kit.patternCount ?? 6;
}
