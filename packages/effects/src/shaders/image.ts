import { defineEffect } from '../glsl';

/**
 * Effects that work on the picture itself: haze over it, a glow found from its edges, and copies of
 * earlier frames. The history effects read uPrev1..4 (newest first); the builder derives `history`
 * from the samplers actually read, so it can never be overstated.
 */

const ALL_MODES = ['colour', 'white', 'silver', 'gold'] as const;

// -------------------------------------------------------------------------------------------------
// Smoke: soft haze rolling up from the bottom, three-octave fbm warped once. It thickens a little on
// the beat (a slow change in density, never a flash).

export const SMOKE = defineEffect(
  { id: 'smoke', name: 'Smoke', defaultIntensity: 0.8 },
  {
    helpers: ['noise'],
    blend: 'mix',
    code: /* glsl */ `
vec3 effect(vec2 p, vec3 src) {
  float t = uTime;
  vec2 q = p * 1.25;
  float warp = fbm(q + vec2(0.04 * t, 0.025 * t), uSeed);
  float d = fbm(q * 1.35 + 1.6 * vec2(warp, 0.8 * warp) + vec2(-0.05 * t, 0.07 * t), uSeed + 3.0);
  float density = smoothstep(0.32, 0.88, d);
  float lowness = 1.0 - 0.55 * smoothstep(0.0, 1.0, vUv.y);
  density *= lowness * (0.90 + 0.20 * uPulse);
  vec3 haze = mix(vec3(0.62, 0.65, 0.74), vec3(0.96, 0.96, 1.0), smoothstep(0.35, 0.9, d));
  return mix(src, haze, clamp(density * 0.62, 0.0, 0.7));
}
`,
  },
);

// -------------------------------------------------------------------------------------------------
// Aura: a glow along high-contrast edges. Eight taps spread over a disc around the pixel measure how much
// of the neighbourhood differs from it in luminance: 0 away from edges, peaking on an edge and falling off
// over the disc's radius, in every direction (axis-only differences give a plus-shaped halo around round
// things). Colour follows the edge direction. Eight taps plus the source read: nine texture reads.

export const AURA = defineEffect(
  { id: 'aura', name: 'Aura', defaultIntensity: 0.85, colorModes: ALL_MODES },
  {
    helpers: ['color'],
    blend: 'mix',
    code: /* glsl */ `
// 4x4 ordered dither, 0..1: fixed per pixel, so it never shimmers from frame to frame.
float bayer4(vec2 pixel) {
  const float M[16] = float[16](0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);
  ivec2 i = ivec2(mod(floor(pixel), 4.0));
  return (M[i.x + 4 * i.y] + 0.5) / 16.0;
}

vec3 effect(vec2 p, vec3 src) {
  float ms = min(uResolution.x, uResolution.y);
  // The taps are spread evenly over a disc (a golden-angle spiral), so the mean difference is the share of
  // the disc that lies across an edge: a smooth tent around the edge. Eight taps still leave steps; a
  // fixed per-pixel turn of the spiral breaks them up so they read as soft grain, not bands.
  float reach = 0.034 + 0.010 * uPulse;
  float turn0 = bayer4(vUv * uResolution) * TAU;
  float l0 = luma(src);
  float spread = 0.0;
  vec2 lean = vec2(0.0);
  for (int i = 0; i < 8; i++) {
    float a = float(i) * 2.399963 + turn0;
    vec2 d = vec2(cos(a), sin(a)) * sqrt((float(i) + 0.5) / 8.0);
    float dl = luma(texture(uSrc, clamp(vUv + d * reach * ms / uResolution, 0.0, 1.0)).rgb) - l0;
    spread += abs(dl);
    lean += d * dl;
  }
  float halo = smoothstep(0.03, 0.24, spread / 8.0);

  // The edge direction nudges the hue, so the glow shades from one colour into its neighbour; no atan,
  // so a flat region (zero lean) cannot go NaN.
  vec2 dir = lean / max(length(lean), 1e-3);
  float turn = uTime * 0.35;
  float facing = 0.5 + 0.5 * dot(dir, vec2(cos(turn), sin(turn)));
  vec3 base = uColorMode == 0 ? rainbow(uTime * 0.06 + 0.30 * facing) : uColor;
  vec3 tint = shadeColor(uColorMode, base, facing);

  float glow = halo * (0.75 + 0.5 * uPulse);
  return screenBlend(src * (1.0 - 0.15 * halo), tint * glow);
}
`,
  },
);

// -------------------------------------------------------------------------------------------------
// Echo trail: ghosts of the last four frames trail behind whatever moves. Each ghost adds only its
// DIFFERENCE from the current frame, so still areas stay untouched and older ghosts take a cooler tint.
// The trail lengthens on the beat.

export const ECHO_TRAIL = defineEffect(
  { id: 'echo-trail', name: 'Echo trail', defaultIntensity: 0.9 },
  {
    blend: 'mix',
    code: /* glsl */ `
vec3 effect(vec2 p, vec3 src) {
  float decay = 0.50 + 0.16 * uPulse;
  float w1 = decay;
  float w2 = w1 * decay;
  float w3 = w2 * decay;
  float w4 = w3 * decay;
  vec3 g1 = (texture(uPrev1, vUv).rgb - src) * w1 * vec3(1.00, 0.97, 1.00);
  vec3 g2 = (texture(uPrev2, vUv).rgb - src) * w2 * vec3(0.96, 0.99, 1.06);
  vec3 g3 = (texture(uPrev3, vUv).rgb - src) * w3 * vec3(0.92, 0.99, 1.12);
  vec3 g4 = (texture(uPrev4, vUv).rgb - src) * w4 * vec3(0.88, 0.99, 1.18);
  return src + (g1 + g2 + g3 + g4) / (1.0 + w1 + w2 + w3 + w4);
}
`,
  },
);

// -------------------------------------------------------------------------------------------------
// Clones: translucent copies of the middle of earlier frames stand either side of the subject
// (nearest the newest frame). Each copy is a soft-edged ellipse cut from the frame's centre, so the
// background is not duplicated. The copies drift apart a little on the beat.

export const CLONES = defineEffect(
  { id: 'clones', name: 'Clones', defaultIntensity: 0.9 },
  {
    helpers: ['geom'],
    blend: 'mix',
    code: /* glsl */ `
vec3 cloneCopy(sampler2D tex, vec3 col, vec2 p, vec2 shift, vec2 centre, vec2 radii, float alpha, vec3 tint) {
  vec2 q = p - shift;
  float m = 1.0 - smoothstep(0.55, 1.0, length((q - centre) / radii));
  if (m <= 0.0) return col;
  vec3 c = textureLod(tex, clamp(toUv(q, uResolution), 0.0, 1.0), 0.0).rgb;
  c = mix(vec3(luma(c)), c, 0.85) * tint;
  return mix(col, c, m * alpha);
}

vec3 effect(vec2 p, vec3 src) {
  vec2 res = uResolution / min(uResolution.x, uResolution.y);
  vec2 centre = 0.5 * res;
  vec2 radii = vec2(0.115 * res.x, 0.30 * res.y);
  float spread = (1.0 + 0.10 * uPulse) * res.x;
  float a = 0.78 + 0.30 * uPulse;
  vec3 col = src;
  col = cloneCopy(uPrev4, col, p, vec2(-0.44 * spread, 0.0), centre, radii, 0.34 * a, vec3(0.90, 0.98, 1.10));
  col = cloneCopy(uPrev3, col, p, vec2(0.44 * spread, 0.0), centre, radii, 0.34 * a, vec3(0.90, 0.98, 1.10));
  col = cloneCopy(uPrev2, col, p, vec2(-0.22 * spread, 0.0), centre, radii, 0.50 * a, vec3(0.95, 0.99, 1.06));
  col = cloneCopy(uPrev1, col, p, vec2(0.22 * spread, 0.0), centre, radii, 0.50 * a, vec3(0.95, 0.99, 1.06));
  return col;
}
`,
  },
);
