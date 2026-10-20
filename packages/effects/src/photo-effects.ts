import type { PhotoEffectDef } from './contract';

/**
 * Photo effects (PHO-10), applied to each still before the strip is composed (and usable in the live
 * preview). Each `frag` is a self-contained GLSL ES 3.00 fragment shader that follows the contract:
 * it reads `uSrc` at `vUv`, uses only the common uniforms (`uSrc`, `uResolution`, `uIntensity`,
 * `uSeed`) and writes an opaque `fragColor`.
 *
 * Conventions every effect keeps:
 *   - resolution independent: sizes are in "short-side units" (`toUnits`: origin at the centre, +x
 *     right, +y up, the short side of the frame spans -0.5..0.5), never in pixels, so a 256 px
 *     thumbnail and a 4000 px print are the same picture;
 *   - `uIntensity` 0 is the untouched image, exactly (the shared `main` returns early); in between,
 *     geometric effects scale their displacement and the rest cross-fade with the source;
 *   - deterministic: any randomness is a hash of the pixel/cell and `uSeed`, nothing else;
 *   - no loop with a non-constant bound, and a modest number of texture reads per pixel (the live
 *     preview runs these every frame on an iPad).
 *
 * Each effect only supplies `vec3 effect(vec2 uv, vec3 src)`; `src` is the untouched pixel at `uv`.
 */

const HEADER = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uSrc;
uniform vec2 uResolution;
uniform float uIntensity;
uniform float uSeed;
`;

const LIB = /* glsl */ `
const float PI = 3.14159265359;
const float TAU = 6.28318530718;
const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);

float luma(vec3 c) { return dot(c, LUMA); }
float shortSide() { return min(uResolution.x, uResolution.y); }
// uv (0..1, origin bottom-left) <-> short-side units (origin at the centre, short side = 1).
vec2 toUnits(vec2 uv) { return (uv - 0.5) * uResolution / shortSide(); }
vec2 fromUnits(vec2 p) { return p * shortSide() / uResolution + 0.5; }
vec3 tex(vec2 uv) { return texture(uSrc, uv).rgb; }
// Triangle-wave fold: sampling past the frame reflects instead of smearing the edge pixels.
vec2 mirrorRepeat(vec2 uv) { return 1.0 - abs(1.0 - mod(uv, 2.0)); }
// Counter-clockwise rotation.
mat2 rot(float a) { float c = cos(a); float s = sin(a); return mat2(c, s, -s, c); }
// atan that is defined (and 0) at the origin.
float angleOf(vec2 p) { return atan(p.y, p.x + 1e-6); }
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
vec2 hash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}
// The effect at full strength, cross-faded with the source by the chosen intensity.
vec3 amount(vec3 src, vec3 fx) { return mix(src, fx, uIntensity); }
`;

const MAIN = /* glsl */ `
void main() {
  vec3 src = texture(uSrc, vUv).rgb;
  if (uIntensity <= 0.0) {
    fragColor = vec4(src, 1.0);
    return;
  }
  fragColor = vec4(clamp(effect(vUv, src), 0.0, 1.0), 1.0);
}
`;

/** Sobel gradient of the luma, shared by the three outline effects. `e` is the tap spacing in uv. */
const SOBEL = /* glsl */ `
float sobel(vec2 uv, vec2 e) {
  float tl = luma(tex(uv + vec2(-e.x,  e.y)));
  float t  = luma(tex(uv + vec2( 0.0,  e.y)));
  float tr = luma(tex(uv + vec2( e.x,  e.y)));
  float l  = luma(tex(uv + vec2(-e.x,  0.0)));
  float r  = luma(tex(uv + vec2( e.x,  0.0)));
  float bl = luma(tex(uv + vec2(-e.x, -e.y)));
  float b  = luma(tex(uv + vec2( 0.0, -e.y)));
  float br = luma(tex(uv + vec2( e.x, -e.y)));
  float gx = (tr + 2.0 * r + br) - (tl + 2.0 * l + bl);
  float gy = (tl + 2.0 * t + tr) - (bl + 2.0 * b + br);
  return length(vec2(gx, gy));
}
// About one pixel at 700 px and below, growing with the resolution so outlines keep their weight.
vec2 edgeStep() { return vec2(max(1.0, shortSide() / 700.0)) / uResolution; }
`;

function effectDef(id: string, name: string, defaultIntensity: number, body: string): PhotoEffectDef {
  return { id, name, defaultIntensity, frag: `${HEADER}${LIB}${body}${MAIN}` };
}

const NONE: PhotoEffectDef = {
  id: 'none',
  name: 'None',
  defaultIntensity: 1,
  frag: `${HEADER}
void main() {
  fragColor = vec4(texture(uSrc, vUv).rgb, 1.0);
}
`,
};

const MIRROR = effectDef(
  'mirror',
  'Mirror',
  1,
  /* glsl */ `
// The left half is reflected onto the right half.
vec3 effect(vec2 uv, vec3 src) {
  vec2 m = vec2(uv.x > 0.5 ? 1.0 - uv.x : uv.x, uv.y);
  return amount(src, tex(m));
}
`,
);

const BULGE = effectDef(
  'bulge',
  'Bulge',
  0.8,
  /* glsl */ `
// Fisheye at the centre: the middle of the frame is magnified (up to 2.6x), the rim is untouched.
vec3 effect(vec2 uv, vec3 src) {
  vec2 p = toUnits(uv);
  float f = 1.0 - min(length(p) / 0.62, 1.0);
  p *= 1.0 - 0.62 * uIntensity * f * f;
  return tex(fromUnits(p));
}
`,
);

const PINCH = effectDef(
  'pinch',
  'Pinch',
  0.8,
  /* glsl */ `
// The opposite of the bulge: the centre shrinks towards the middle, the rim is untouched.
vec3 effect(vec2 uv, vec3 src) {
  vec2 p = toUnits(uv);
  float f = 1.0 - min(length(p) / 0.7, 1.0);
  p *= 1.0 + 0.9 * uIntensity * f * f;
  return tex(fromUnits(p));
}
`,
);

const SWIRL = effectDef(
  'swirl',
  'Swirl',
  0.8,
  /* glsl */ `
// The centre is twisted by up to 2.6 rad, fading to nothing at 0.75 of the short side.
vec3 effect(vec2 uv, vec3 src) {
  vec2 p = toUnits(uv);
  float f = 1.0 - min(length(p) / 0.75, 1.0);
  p = rot(2.6 * uIntensity * f * f) * p;
  return tex(fromUnits(p));
}
`,
);

const RIPPLE = effectDef(
  'ripple',
  'Ripple',
  1,
  /* glsl */ `
// Water rings spreading from the centre; the seed sets the phase. The light follows the slope.
vec3 effect(vec2 uv, vec3 src) {
  vec2 p = toUnits(uv);
  float r = length(p);
  float w = r * 55.0 - uSeed * 0.37;
  float fall = 1.0 - 0.6 * smoothstep(0.0, 0.8, r);
  p += (p / max(r, 1e-4)) * sin(w) * 0.018 * fall * uIntensity;
  return tex(fromUnits(p)) * (1.0 + 0.12 * cos(w) * fall * uIntensity);
}
`,
);

const GLASS = effectDef(
  'glass',
  'Glass',
  1,
  /* glsl */ `
// Frosted glass blocks: every tile is a little lens that shows a magnified, shifted piece of the
// scene, with a bevelled edge and a fine frosting jitter per pixel.
vec3 effect(vec2 uv, vec3 src) {
  const float CELL = 0.055;
  vec2 p = toUnits(uv);
  vec2 id = floor(p / CELL);
  vec2 local = p / CELL - id - 0.5;
  vec2 jitter = hash22(id + uSeed * 0.013) - 0.5;
  vec2 q = (id + 0.5) * CELL + local * CELL * 0.6 + jitter * CELL * 0.5;
  q += (hash22(gl_FragCoord.xy) - 0.5) * 0.007;
  vec3 g = tex(fromUnits(q));
  float edge = max(abs(local.x), abs(local.y));
  g *= 1.0 + 0.22 * smoothstep(0.34, 0.46, edge) - 0.35 * smoothstep(0.46, 0.5, edge);
  g = g * 0.96 + 0.04;
  return amount(src, g);
}
`,
);

const PRISM = effectDef(
  'prism',
  'Prism',
  1,
  /* glsl */ `
// Spectral dispersion that grows towards the edges (seven taps along the radius, each tap weighted
// towards red, green or blue), plus a rainbow flare streaking across the frame.
vec3 effect(vec2 uv, vec3 src) {
  vec2 p = toUnits(uv);
  float r = length(p);
  vec2 axis = p / max(r, 1e-4);
  float spread = 0.006 + 0.05 * r;
  vec3 acc = vec3(0.0);
  vec3 wsum = vec3(0.0);
  for (int i = 0; i < 7; i++) {
    float t = float(i) / 6.0;
    vec3 d = (vec3(t) - vec3(0.85, 0.5, 0.15)) / 0.18;
    vec3 w = exp(-d * d);
    acc += w * tex(fromUnits(p + axis * spread * (2.0 * t - 1.0)));
    wsum += w;
  }
  vec3 c = acc / wsum;
  vec2 dir = vec2(0.82, 0.57);
  float across = dot(p, vec2(-dir.y, dir.x)) - 0.12 + 0.1 * sin(uSeed);
  float along = dot(p, dir);
  float band = exp(-(across * across) / 0.0049);
  vec3 rainbow = 0.5 + 0.5 * cos(TAU * (along * 1.4 + vec3(0.0, 0.33, 0.67)));
  c += rainbow * band * 0.28;
  return amount(src, c);
}
`,
);

const KALEIDOSCOPE = effectDef(
  'kaleidoscope',
  'Kaleidoscope',
  1,
  /* glsl */ `
// Six mirrored wedges around the centre. The seed turns which part of the picture feeds them.
vec3 effect(vec2 uv, vec3 src) {
  vec2 p = toUnits(uv);
  float r = length(p);
  float seg = TAU / 6.0;
  float a = mod(angleOf(p), seg);
  a = abs(a - 0.5 * seg) + 0.35 + uSeed * 0.0063;
  vec2 q = r * 0.8 * vec2(cos(a), sin(a));
  return amount(src, tex(mirrorRepeat(fromUnits(q))));
}
`,
);

const OP_ART = effectDef(
  'op-art',
  'Op art',
  1,
  /* glsl */ `
// Concentric stripes that wobble round the frame and bend with the picture's brightness; the stripes
// are thick where the picture is dark and hairline where it is bright, so the face emerges from the rings.
vec3 effect(vec2 uv, vec3 src) {
  vec2 p = toUnits(uv);
  float l = luma(src);
  float s = length(p) * 26.0 + 0.7 * sin(angleOf(p) * 6.0 + uSeed * 0.1) + (l - 0.5) * 1.6;
  float t = abs(fract(s) * 2.0 - 1.0);
  float width = mix(0.96, 0.1, smoothstep(0.05, 0.95, l));
  float aa = clamp(fwidth(s) * 2.0, 0.03, 0.6);
  float ink = 1.0 - smoothstep(width - aa, width + aa, t);
  return amount(src, mix(vec3(0.97, 0.96, 0.93), vec3(0.05, 0.05, 0.08), ink));
}
`,
);

const HALFTONE = effectDef(
  'halftone',
  'Halftone',
  1,
  /* glsl */ `
// Four-colour print: cyan, magenta, yellow and black dot screens at the classic angles (15, 75, 0
// and 45 degrees), the dot area following the amount of each ink, mixed subtractively on paper.
// Coverage and mixing are in linear light so the tones match the photo.
const vec3 INK_C = vec3(0.0, 0.36, 0.84);
const vec3 INK_M = vec3(0.84, 0.02, 0.26);
const vec3 INK_Y = vec3(0.95, 0.85, 0.01);
const vec3 INK_K = vec3(0.012, 0.012, 0.016);

float screenCover(vec2 p, float angle, int channel) {
  const float CELL = 0.0155;
  mat2 R = rot(angle);
  vec2 q = (R * p) / CELL;
  vec2 id = floor(q);
  vec2 centre = (id + 0.5) * CELL;
  vec3 lin = pow(tex(fromUnits(centre * R)), vec3(2.2));
  float k = 1.0 - max(lin.r, max(lin.g, lin.b));
  vec3 cmy = (1.0 - lin - k) / max(1.0 - k, 1e-3);
  float a = channel == 0 ? cmy.x : (channel == 1 ? cmy.y : (channel == 2 ? cmy.z : k));
  a = clamp(a, 0.0, 1.0);
  // Area-true radius, opened up to cover the whole cell as the ink approaches 100%.
  float radius = mix(sqrt(a / PI), 0.7072, smoothstep(0.75, 1.0, a));
  float aa = 0.75 / (CELL * shortSide());
  return 1.0 - smoothstep(radius - aa, radius + aa, length(q - id - 0.5));
}

vec3 effect(vec2 uv, vec3 src) {
  vec2 p = toUnits(uv);
  vec3 c = vec3(0.97, 0.96, 0.93);
  c *= mix(vec3(1.0), INK_C, screenCover(p, 0.2618, 0));
  c *= mix(vec3(1.0), INK_M, screenCover(p, 1.3090, 1));
  c *= mix(vec3(1.0), INK_Y, screenCover(p, 0.0, 2));
  c *= mix(vec3(1.0), INK_K, screenCover(p, 0.7854, 3));
  return amount(src, pow(c, vec3(1.0 / 2.2)));
}
`,
);

const THERMAL = effectDef(
  'thermal',
  'Thermal',
  1,
  /* glsl */ `
// False-colour heat map of the (slightly softened) luminance: cold blue, violet, red, orange,
// yellow, white-hot.
vec3 heat(float t) {
  vec3 c = vec3(0.02, 0.0, 0.18);
  c = mix(c, vec3(0.32, 0.0, 0.58), smoothstep(0.0, 0.22, t));
  c = mix(c, vec3(0.86, 0.08, 0.22), smoothstep(0.2, 0.45, t));
  c = mix(c, vec3(1.0, 0.5, 0.0), smoothstep(0.42, 0.68, t));
  c = mix(c, vec3(1.0, 0.92, 0.12), smoothstep(0.65, 0.88, t));
  c = mix(c, vec3(1.0, 1.0, 0.92), smoothstep(0.85, 1.0, t));
  return c;
}

vec3 effect(vec2 uv, vec3 src) {
  vec2 o = 0.005 * shortSide() / uResolution;
  float l = 0.4 * luma(src) + 0.15 * (
    luma(tex(uv + vec2(o.x, 0.0))) + luma(tex(uv - vec2(o.x, 0.0))) +
    luma(tex(uv + vec2(0.0, o.y))) + luma(tex(uv - vec2(0.0, o.y))));
  return amount(src, heat(clamp((l - 0.06) / 0.88, 0.0, 1.0)));
}
`,
);

const POP_ART = effectDef(
  'pop-art',
  'Pop art',
  1,
  /* glsl */ `
// Four panels, each the whole picture reduced to three flat tones in its own bold palette.
vec3 tone(int panel, float l) {
  vec3 d;
  vec3 m;
  vec3 h;
  if (panel == 0) {
    d = vec3(0.07, 0.04, 0.12); m = vec3(0.93, 0.13, 0.2); h = vec3(1.0, 0.88, 0.22);
  } else if (panel == 1) {
    d = vec3(0.04, 0.07, 0.34); m = vec3(0.0, 0.72, 0.9); h = vec3(1.0, 0.95, 0.8);
  } else if (panel == 2) {
    d = vec3(0.3, 0.04, 0.45); m = vec3(1.0, 0.5, 0.06); h = vec3(1.0, 0.94, 0.56);
  } else {
    d = vec3(0.04, 0.05, 0.08); m = vec3(1.0, 0.22, 0.58); h = vec3(0.72, 0.96, 1.0);
  }
  return l < 0.34 ? d : (l < 0.67 ? m : h);
}

vec3 effect(vec2 uv, vec3 src) {
  vec2 cell = min(floor(uv * 2.0), vec2(1.0));
  vec2 local = uv * 2.0 - cell;
  int panel = int(cell.x + 2.0 * cell.y);
  vec2 o = 0.5 / uResolution;
  vec3 s = 0.25 * (tex(local + vec2(-o.x, -o.y)) + tex(local + vec2(o.x, -o.y)) +
                   tex(local + vec2(-o.x, o.y)) + tex(local + o));
  vec3 c = tone(panel, smoothstep(0.08, 0.92, luma(s)));
  vec2 edgePx = min(local, 1.0 - local) * 0.5 * uResolution;
  float gutter = max(1.0, 0.004 * shortSide());
  float inGutter = 1.0 - smoothstep(gutter, gutter + 1.0, min(edgePx.x, edgePx.y));
  return amount(src, mix(c, vec3(0.04, 0.04, 0.06), inGutter));
}
`,
);

const PIXELATE = effectDef(
  'pixelate',
  'Pixelate',
  1,
  /* glsl */ `
// Square mosaic blocks, 1/38 of the short side at full strength, each the average of four taps.
vec3 effect(vec2 uv, vec3 src) {
  float px = 1.0 / shortSide();
  float cell = max(px, mix(px, 0.026, uIntensity));
  vec2 o = 0.5 * uResolution / shortSide();
  vec2 centre = (floor((toUnits(uv) + o) / cell) + 0.5) * cell - o;
  float h = cell * 0.25;
  return 0.25 * (tex(fromUnits(centre + vec2(-h, -h))) + tex(fromUnits(centre + vec2(h, -h))) +
                 tex(fromUnits(centre + vec2(-h, h))) + tex(fromUnits(centre + vec2(h, h))));
}
`,
);

const SKETCH = effectDef(
  'sketch',
  'Sketch',
  1,
  /* glsl */ `${SOBEL}
// Pencil on paper: Sobel outlines plus two layers of diagonal hatching that come in as the tones darken.
float stroke(float c) {
  float aa = clamp(fwidth(c), 0.01, 0.2);
  return 1.0 - smoothstep(0.09 - aa, 0.09 + aa, abs(fract(c) - 0.5));
}

vec3 effect(vec2 uv, vec3 src) {
  float outline = smoothstep(0.12, 0.8, sobel(uv, edgeStep()));
  float l = luma(src);
  vec2 p = toUnits(uv);
  float hatch1 = stroke((p.x + p.y) / 0.012) * (1.0 - smoothstep(0.3, 0.62, l));
  float hatch2 = stroke((p.x - p.y) / 0.0138) * (1.0 - smoothstep(0.18, 0.42, l));
  float ink = clamp(outline * 0.95 + hatch1 * 0.55 + hatch2 * 0.6 + (1.0 - l) * 0.1, 0.0, 1.0);
  vec3 c = mix(vec3(0.965, 0.955, 0.92), vec3(0.16, 0.16, 0.2), ink);
  c *= 0.97 + 0.03 * hash12(gl_FragCoord.xy);
  return amount(src, c);
}
`,
);

const POSTERIZE = effectDef(
  'posterize',
  'Posterize',
  1,
  /* glsl */ `
// Five levels per channel after a small contrast lift, then a touch more colour.
vec3 effect(vec2 uv, vec3 src) {
  vec3 c = clamp((src - 0.5) * 1.12 + 0.5, 0.0, 1.0);
  c = floor(c * 4.0 + 0.5) / 4.0;
  return amount(src, mix(vec3(luma(c)), c, 1.25));
}
`,
);

const DUOTONE_POP = effectDef(
  'duotone-pop',
  'Duotone pop',
  1,
  /* glsl */ `
// Deep violet to hot pink with the brightest tones lifting to cream: a bold two-colour print.
vec3 effect(vec2 uv, vec3 src) {
  float t = smoothstep(0.1, 0.9, luma(src));
  vec3 c = mix(vec3(0.05, 0.02, 0.38), vec3(1.0, 0.36, 0.55), t);
  c = mix(c, vec3(1.0, 0.86, 0.8), smoothstep(0.82, 1.0, t) * 0.8);
  return amount(src, c);
}
`,
);

const COMIC = effectDef(
  'comic',
  'Comic',
  1,
  /* glsl */ `${SOBEL}
// Flat comic colour (four brightness bands, boosted saturation) under bold ink outlines.
vec3 effect(vec2 uv, vec3 src) {
  float l = luma(src);
  float band = floor(l * 3.0 + 0.5) / 3.0;
  vec3 colour = clamp(src / max(l, 0.04) * band, 0.0, 1.0);
  colour = clamp(mix(vec3(band), colour, 1.25), 0.0, 1.0);
  float line = smoothstep(0.35, 0.9, sobel(uv, edgeStep()));
  return amount(src, mix(colour, vec3(0.04, 0.03, 0.07), line));
}
`,
);

const NEON_EDGES = effectDef(
  'neon-edges',
  'Neon edges',
  1,
  /* glsl */ `${SOBEL}
// Glowing outlines in the picture's own (saturated) colours on a near-black ground.
vec3 effect(vec2 uv, vec3 src) {
  float g = sobel(uv, edgeStep());
  float peak = max(src.r, max(src.g, src.b));
  vec3 hue = src / max(peak, 0.25);
  hue = mix(vec3(luma(hue)), hue, 1.6);
  vec3 c = vec3(0.012, 0.014, 0.03) + src * 0.07 + hue * (smoothstep(0.06, 0.7, g) * 1.25 + smoothstep(0.0, 0.25, g) * 0.25);
  return amount(src, c);
}
`,
);

const GLITCH = effectDef(
  'glitch',
  'Glitch',
  0.9,
  /* glsl */ `
// Broken-signal look: horizontal bands slip sideways (a few wide, a few hairline), the colour
// channels separate, and the slipped bands pick up a magenta/cyan cast. The seed picks the damage.
vec3 effect(vec2 uv, vec3 src) {
  float seed = floor(uSeed);
  float row = floor(uv.y * 26.0);
  vec2 h = hash22(vec2(row, seed));
  float slip = step(0.74, h.x);
  float shift = (h.y - 0.5) * 0.18 * slip;
  float fineRow = floor(uv.y * 150.0);
  float fine = step(0.94, hash12(vec2(fineRow, seed + 5.0)));
  shift += (hash12(vec2(fineRow + 0.5, seed)) - 0.5) * 0.1 * fine;
  float split = (0.004 + 0.012 * slip + 0.01 * fine) * uIntensity;
  float x = fract(uv.x + shift * uIntensity);
  vec3 c = vec3(tex(vec2(fract(x + split), uv.y)).r, tex(vec2(x, uv.y)).g, tex(vec2(fract(x - split), uv.y)).b);
  c += slip * vec3(0.1, -0.02, 0.12) * (0.5 + h.y) * uIntensity;
  return c;
}
`,
);

/** `none` first (identity), then the effects. */
export const PHOTO_EFFECTS: readonly PhotoEffectDef[] = Object.freeze([
  NONE,
  MIRROR,
  BULGE,
  PINCH,
  GLASS,
  PRISM,
  KALEIDOSCOPE,
  OP_ART,
  HALFTONE,
  THERMAL,
  POP_ART,
  PIXELATE,
  SKETCH,
  POSTERIZE,
  SWIRL,
  DUOTONE_POP,
  COMIC,
  NEON_EDGES,
  RIPPLE,
  GLITCH,
]);

const BY_ID = new Map(PHOTO_EFFECTS.map((e) => [e.id, e]));

/** The photo effect with this id, or undefined. */
export function findPhotoEffect(id: string): PhotoEffectDef | undefined {
  return BY_ID.get(id);
}
