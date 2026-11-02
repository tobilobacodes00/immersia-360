import type { ColorMode, EffectDef, EffectUniforms } from './contract';

/**
 * Shared GLSL for the video effects, and the builder that turns an effect's body into a complete
 * fragment shader.
 *
 * GLSL ES 3.00 has no #include, so helpers are string snippets inlined into every frag that asks for
 * them (by name; dependencies are resolved here). The builder also writes the uniform declarations:
 * it scans the finished shader and declares exactly the contract uniforms that are used, so a frag can
 * neither forget a declaration nor carry a dead one, and it derives `history` from the `uPrev*`
 * samplers the code really reads, so the metadata cannot overstate or understate it.
 *
 * Conventions every effect follows:
 *  - `vUv` is 0..1 with the origin at the bottom-left (the contract); "down" is decreasing y.
 *  - `p` handed to `effect()` is vUv in units of the SHORT side of the output (so a size of 0.1 is
 *    10 % of the short side at any resolution); x runs 0..aspect on landscape, y 0..1.
 *  - Everything is stateless: pure functions of uTime, uSeed, uBeat, uPulse and the bound frames.
 *  - Randomness is an integer hash of a grid cell (bit-exact on every GPU), never sin()-based.
 */

/** GLSL type of every uniform of the effect contract. Typed against the contract so a change there is a compile error here. */
export const UNIFORM_TYPES: EffectUniforms = {
  uSrc: 'sampler2D',
  uResolution: 'vec2',
  uIntensity: 'float',
  uSeed: 'float',
  uTime: 'float',
  uDuration: 'float',
  uBeat: 'float',
  uPulse: 'float',
  uColor: 'vec3',
  uColorMode: 'int',
  uPrev1: 'sampler2D',
  uPrev2: 'sampler2D',
  uPrev3: 'sampler2D',
  uPrev4: 'sampler2D',
};

export type UniformName = keyof EffectUniforms;
export const UNIFORM_NAMES = Object.keys(UNIFORM_TYPES) as UniformName[];

export type HelperName = 'geom' | 'hash' | 'noise' | 'color';

interface Helper {
  requires: readonly HelperName[];
  code: string;
}

const HELPERS: Record<HelperName, Helper> = {
  // ---------------------------------------------------------------------------------------------
  geom: {
    requires: [],
    code: /* glsl */ `
const float TAU = 6.28318530718;
const float PI = 3.14159265359;
mat2 rot2(float a) { float c = cos(a); float s = sin(a); return mat2(c, s, -s, c); }
float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
// atan() is undefined at the origin on some GPUs; this one is not.
float safeAtan(vec2 d) { return atan(d.y, abs(d.x) < 1e-6 ? 1e-6 : d.x); }
// Reflect uv back into 0..1 (displacement near an edge shows mirrored picture, not smeared edge pixels).
vec2 mirrorUv(vec2 uv) { return 1.0 - abs(1.0 - mod(uv, 2.0)); }
// Short-side units back to texture coordinates.
vec2 toUv(vec2 p, vec2 res) { return p * min(res.x, res.y) / res; }
vec3 screenBlend(vec3 base, vec3 light) { return 1.0 - (1.0 - base) * (1.0 - clamp(light, 0.0, 1.0)); }
`,
  },

  // ---------------------------------------------------------------------------------------------
  hash: {
    requires: [],
    code: /* glsl */ `
// Integer hash (the murmur3 finaliser): identical bits on every GPU, so a preview and a render agree.
uint hmix(uint h) {
  h ^= h >> 16;
  h *= 0x85ebca6bU;
  h ^= h >> 13;
  h *= 0xc2b2ae35U;
  h ^= h >> 16;
  return h;
}
// Hash of an integer grid cell (p is floored) and a seed. The bias keeps the int -> uint step non-negative.
uint hcell(vec2 p, float seed) {
  uvec2 q = uvec2(ivec2(floor(p)) + ivec2(1048576));
  uint s = hmix(floatBitsToUint(seed) ^ 0x9e3779b9U);
  return hmix(q.x * 0x27d4eb2fU + hmix(q.y + s));
}
float u01(uint h) { return float(h >> 8) * (1.0 / 16777216.0); }
float hash21(vec2 p, float seed) { return u01(hcell(p, seed)); }
float hash11(float x, float seed) { return hash21(vec2(x, 0.0), seed); }
vec2 hash22(vec2 p, float seed) {
  uint h = hcell(p, seed);
  return vec2(u01(h), u01(hmix(h ^ 0x68e31da4U)));
}
vec3 hash23(vec2 p, float seed) {
  uint h = hcell(p, seed);
  uint h2 = hmix(h ^ 0x68e31da4U);
  return vec3(u01(h), u01(h2), u01(hmix(h2 ^ 0xb5297a4dU)));
}
`,
  },

  // ---------------------------------------------------------------------------------------------
  noise: {
    requires: ['hash'],
    code: /* glsl */ `
// Value noise on the integer lattice with a quintic fade, 0..1.
float vnoise(vec2 p, float seed) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float a = hash21(i, seed);
  float b = hash21(i + vec2(1.0, 0.0), seed);
  float c = hash21(i + vec2(0.0, 1.0), seed);
  float d = hash21(i + vec2(1.0, 1.0), seed);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
// Three octaves, normalised to 0..1. Deliberately low: haze needs softness, not detail.
float fbm(vec2 p, float seed) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 3; i++) {
    v += a * vnoise(p, seed + float(i));
    p = p * 2.03 + vec2(17.1, 9.7);
    a *= 0.5;
  }
  return v / 0.875;
}
`,
  },

  // ---------------------------------------------------------------------------------------------
  color: {
    requires: ['geom'],
    code: /* glsl */ `
const vec3 FESTIVE[7] = vec3[7](
  vec3(0.98, 0.35, 0.55), // pink
  vec3(1.00, 0.72, 0.22), // amber
  vec3(0.30, 0.78, 0.86), // aqua
  vec3(0.58, 0.45, 0.95), // violet
  vec3(0.45, 0.85, 0.50), // mint
  vec3(1.00, 0.50, 0.30), // coral
  vec3(0.98, 0.92, 0.45)  // lemon
);
const vec3 ROMANTIC[6] = vec3[6](
  vec3(0.93, 0.18, 0.32), // red
  vec3(1.00, 0.42, 0.58), // rose
  vec3(1.00, 0.62, 0.72), // blush
  vec3(0.86, 0.20, 0.55), // raspberry
  vec3(1.00, 0.55, 0.45), // coral
  vec3(1.00, 0.86, 0.90)  // pearl
);
// h is a hash in 0..1.
vec3 festive(float h) { return FESTIVE[min(int(h * 7.0), 6)]; }
vec3 romantic(float h) { return ROMANTIC[min(int(h * 6.0), 5)]; }
// Soft full-spectrum colour for h (wraps).
vec3 rainbow(float h) { return 0.5 + 0.5 * cos(TAU * (h + vec3(0.0, 0.3333, 0.6667))); }
// The same, pushed to stage-light saturation.
vec3 lightHue(float h) { return clamp((rainbow(h) - 0.5) * 1.5 + 0.5, 0.0, 1.0); }
// Colour of a particle: a palette pick in colour mode (0), the operator's colour otherwise.
vec3 pickColor(int mode, vec3 base, float h) { return mode == 0 ? festive(h) : base; }
vec3 pickRomantic(int mode, vec3 base, float h) { return mode == 0 ? romantic(h) : base; }
// Subtle shading by how directly the surface faces the viewer (0..1): colour keeps a gentle gradient,
// white stays nearly flat, silver and gold get a metallic falloff plus a glint on the bright side.
vec3 shadeColor(int mode, vec3 c, float facing) {
  float f = clamp(facing, 0.0, 1.0);
  if (mode == 0) return c * (0.82 + 0.26 * f);
  if (mode == 1) return c * (0.90 + 0.10 * f);
  float glint = f * f * f * f * f * f;
  return c * (0.66 + 0.46 * f) + vec3(0.30) * glint;
}
`,
  },
};

// -------------------------------------------------------------------------------------------------

/** Remove comments, for analysis only (the emitted shader keeps them so compile errors stay readable). */
export function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
}

const usesUniform = (code: string, name: string) => new RegExp(`\\b${name}\\b`).test(code);

export interface FragmentSpec {
  /** Shared snippets to inline (their own dependencies are added automatically). */
  helpers?: readonly HelperName[];
  /** Effect-specific functions, ending with `vec3 effect(vec2 p, vec3 src)`. Uniforms are in scope. */
  code: string;
  /**
   * 'mix': the wrapper blends effect() with the source by uIntensity (0 reproduces the input exactly).
   * 'self': effect() applies uIntensity itself (displacement effects scale their amplitude, which looks
   * better than cross-fading two displaced pictures) and must return the source at uIntensity 0.
   */
  blend: 'mix' | 'self';
}

export interface BuiltFragment {
  frag: string;
  /** Highest uPrevN the code reads (0 when none). */
  history: number;
  /** Contract uniforms the shader uses, in declaration order. */
  uniforms: readonly UniformName[];
}

/** Marker the wrapper writes around the final clamp; tests strip it to look at unclamped values. */
const FINAL_CLAMP = 'clamp(outColor, 0.0, 1.0)';

function mainFor(blend: FragmentSpec['blend']): string {
  const result = blend === 'mix' ? 'mix(src, fx, uIntensity)' : 'fx';
  return `
void main() {
  vec3 src = texture(uSrc, vUv).rgb;
  vec2 p = vUv * uResolution / min(uResolution.x, uResolution.y);
  vec3 fx = effect(p, src);
  vec3 outColor = ${result};
  fragColor = vec4(${FINAL_CLAMP}, 1.0);
}
`;
}

/** The frag with its final clamp removed (tests use this to catch NaN, Inf and runaway values). */
export function withoutFinalClamp(frag: string): string {
  if (!frag.includes(FINAL_CLAMP)) throw new Error('fragment was not built by buildFragment');
  return frag.replace(FINAL_CLAMP, 'outColor');
}

function resolveHelpers(wanted: readonly HelperName[]): HelperName[] {
  const order: HelperName[] = [];
  const visit = (name: HelperName) => {
    if (order.includes(name)) return;
    for (const dep of HELPERS[name].requires) visit(dep);
    order.push(name);
  };
  wanted.forEach(visit);
  return order;
}

export function buildFragment(spec: FragmentSpec): BuiltFragment {
  const helpers = resolveHelpers(spec.helpers ?? []);
  for (const name of helpers) {
    const body = stripComments(HELPERS[name].code);
    const leaked = UNIFORM_NAMES.find((u) => usesUniform(body, u));
    if (leaked) throw new Error(`helper '${name}' must be pure but reads ${leaked}; pass it as a parameter`);
  }
  const helperCode = helpers.map((name) => HELPERS[name].code).join('\n');
  const main = mainFor(spec.blend);
  const analysed = stripComments(`${helperCode}\n${spec.code}\n${main}`);
  const uniforms = UNIFORM_NAMES.filter((name) => usesUniform(analysed, name));
  const declarations = uniforms.map((name) => `uniform ${UNIFORM_TYPES[name]} ${name};`).join('\n');

  const frag = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
in vec2 vUv;
out vec4 fragColor;
${declarations}
${helperCode}
${spec.code}
${main}`;

  let history = 0;
  for (let i = 1; i <= 4; i++) if (uniforms.includes(`uPrev${i}` as UniformName)) history = i;
  return { frag, history, uniforms };
}

export interface EffectMeta {
  id: string;
  name: string;
  defaultIntensity: number;
  /** Declare only when the shader really branches on uColorMode; enforced below. */
  colorModes?: readonly ColorMode[];
}

export function defineEffect(meta: EffectMeta, spec: FragmentSpec): EffectDef {
  const { frag, history, uniforms } = buildFragment(spec);
  const usesMode = uniforms.includes('uColorMode');
  if (meta.colorModes && !usesMode) throw new Error(`${meta.id}: declares colorModes but never reads uColorMode`);
  if (!meta.colorModes && usesMode) throw new Error(`${meta.id}: reads uColorMode but declares no colorModes`);
  return {
    id: meta.id,
    name: meta.name,
    ...(meta.colorModes ? { colorModes: meta.colorModes } : {}),
    history,
    defaultIntensity: meta.defaultIntensity,
    frag,
  };
}
