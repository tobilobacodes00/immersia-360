import type { LookDef, LookParams } from './contract';

/**
 * Colour looks (VID-11). A look is a `LookParams` record for ONE shared shader, `LOOK_FRAG`, so adding
 * a look never adds a program and previews, the live preview, stills and rendered video run identical
 * maths. Hosts compile `LOOK_FRAG` once and set `lookUniforms(look.params, intensity)` per look.
 *
 * Order of operations in LOOK_FRAG (each step is skipped at its neutral value, so `none` is cheap):
 *
 *   1. exposure, then white balance (temperature, tint)   in LINEAR light (sRGB decoded, then re-encoded)
 *   2. lift / gamma / gain                                 per channel, display-referred
 *   3. contrast                                            symmetric S-curve around mid-grey (0.5)
 *   4. saturation                                          mix with Rec.709 luma
 *   5. split toning                                        luma-preserving chroma shift, weighted by tone
 *   6. duotone                                             luma mapped from `dark` to `light`
 *   7. fade                                                raises the blacks, whites stay put
 *   8. vignette                                            elliptical, aspect-aware (uResolution)
 *   9. grain                                               triangular noise, mid-tone weighted
 *  10. mix with the source by uIntensity (0 is the untouched source, exactly)
 *
 * Why steps 2-7 are not in linear light: the contract's ranges (lift ±0.2, gamma 0.5..2, fade up to
 * 0.3, contrast around mid-grey) are display-referred numbers. In linear light a lift of 0.1 is a
 * washed-out grey and a contrast pivot of 0.18 clips highlights hard; here a fade of 0.08 is the
 * film fade it sounds like. Only exposure and white balance are physically linear operations.
 *
 * Grain is a hash of gl_FragCoord (so the same input renders to the same pixels), the render seed
 * and, when the host provides it, `uTime` (a new pattern every 1/24 s; static when the host leaves
 * the uniform at 0). The grain cell grows with the resolution so it looks the same at any size.
 */
export const LOOK_FRAG = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uSrc;
uniform vec2 uResolution;
uniform float uIntensity;
uniform float uSeed;
uniform float uTime;

uniform float uExposure;
uniform float uContrast;
uniform float uSaturation;
uniform float uTemperature;
uniform float uTint;
uniform vec3 uLift;
uniform vec3 uGamma;
uniform vec3 uGain;
uniform vec3 uShadows;
uniform vec3 uHighlights;
uniform float uSplit;
uniform float uFade;
uniform float uVignette;
uniform float uGrain;
uniform float uDuotone;
uniform vec3 uDark;
uniform vec3 uLight;

const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);

vec3 srgbToLinear(vec3 c) {
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), c));
}

vec3 linearToSrgb(vec3 c) {
  c = max(c, 0.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c));
}

// Symmetric power S-curve: identity at k = 1, steeper through the mid-tones above 1, flatter below,
// always inside 0..1 (no hard clipping, unlike a straight line around the pivot).
vec3 contrastCurve(vec3 x, float k) {
  x = clamp(x, 0.0, 1.0);
  k = max(k, 0.01);
  vec3 lo = 0.5 * pow(2.0 * x, vec3(k));
  vec3 hi = 1.0 - 0.5 * pow(2.0 * (1.0 - x), vec3(k));
  return mix(hi, lo, vec3(lessThan(x, vec3(0.5))));
}

// Hash without sin(): stable on every GPU and cheap. One value in 0..1 per 2-D cell.
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void main() {
  vec3 src = texture(uSrc, vUv).rgb;
  float amount = clamp(uIntensity, 0.0, 1.0);
  if (amount <= 0.0) {
    fragColor = vec4(src, 1.0);
    return;
  }
  vec3 c = src;

  // 1. Exposure (stops) and white balance, in linear light.
  if (uExposure != 0.0 || uTemperature != 0.0 || uTint != 0.0) {
    vec3 balance = vec3(
      1.0 + 0.30 * uTemperature + 0.06 * uTint,
      1.0 - 0.20 * uTint,
      1.0 - 0.30 * uTemperature + 0.06 * uTint
    );
    c = linearToSrgb(clamp(srgbToLinear(c) * exp2(uExposure) * balance, 0.0, 1.0));
  }

  // 2. Lift (moves black, white stays), gain, then gamma (above 1 brightens the mid-tones).
  c = c * (1.0 - uLift) + uLift;
  c = c * uGain;
  c = pow(max(c, 0.0), 1.0 / uGamma);

  // 3. Contrast around mid-grey.
  if (uContrast != 1.0) c = contrastCurve(c, uContrast);

  // 4. Saturation towards the pixel's own luma (0 = monochrome).
  float luma = dot(c, LUMA);
  c = clamp(mix(vec3(luma), c, uSaturation), 0.0, 1.0);

  // 5. Split toning. Each tint contributes its chroma (colour minus its luma), so brightness is
  //    untouched and a grey tint does nothing. Shadows fade out by 65% luma, highlights fade in from 35%.
  if (uSplit > 0.0) {
    luma = dot(c, LUMA);
    float inShadows = 1.0 - smoothstep(0.0, 0.65, luma);
    float inHighlights = smoothstep(0.35, 1.0, luma);
    vec3 shadowChroma = uShadows - dot(uShadows, LUMA);
    vec3 highlightChroma = uHighlights - dot(uHighlights, LUMA);
    c = clamp(c + (shadowChroma * inShadows + highlightChroma * inHighlights) * uSplit, 0.0, 1.0);
  }

  // 6. Duotone: the luma picks a colour on the dark to light ramp.
  if (uDuotone > 0.0) {
    luma = dot(c, LUMA);
    c = mix(c, mix(uDark, uLight, luma), uDuotone);
  }

  // 7. Fade lifts the blacks (1 stays 1).
  c = c * (1.0 - uFade) + uFade;

  // 8. Vignette. The ellipse is halfway between the frame's own shape and a circle, normalised so
  //    the corners always get the full strength whatever the aspect ratio.
  if (uVignette > 0.0) {
    float aspect = uResolution.x / max(uResolution.y, 1.0);
    vec2 shape = vec2(sqrt(aspect), 1.0);
    float d = length((vUv - 0.5) * shape) / (0.5 * length(shape));
    c *= 1.0 - uVignette * smoothstep(0.4, 1.05, d);
  }

  // 9. Grain: triangular noise (two hashes), strongest in the mid-tones, one value for all channels.
  if (uGrain > 0.0) {
    // The grain is sized for a 720 px short side: bigger grains above it, and below it the
    // strength falls off (a thumbnail of a grainy picture is smoother, not noisier).
    float shortSide = min(uResolution.x, uResolution.y);
    float cell = max(1.0, shortSide / 720.0);
    vec2 gp = floor(gl_FragCoord.xy / cell);
    float frame = uSeed * 7.0 + floor(uTime * 24.0);
    float n = hash12(gp + vec2(37.0, 17.0) * frame) + hash12(gp.yx + vec2(19.0, 43.0) * frame + 211.0) - 1.0;
    float l = dot(c, LUMA);
    float weight = 0.35 + 0.65 * 4.0 * l * (1.0 - l);
    c += n * uGrain * weight * 0.7 * min(1.0, shortSide / 720.0);
  }

  fragColor = vec4(mix(src, clamp(c, 0.0, 1.0), amount), 1.0);
}
`;

// -----------------------------------------------------------------------------------------------
// Uniform mapping

/**
 * LookParams -> the uniforms LOOK_FRAG declares. Scalars stay numbers, RGB triples stay 3-arrays:
 *
 *   exposure -> uExposure     contrast -> uContrast       saturation -> uSaturation
 *   temperature -> uTemperature   tint -> uTint           lift -> uLift      gamma -> uGamma
 *   gain -> uGain             shadows -> uShadows         highlights -> uHighlights
 *   split -> uSplit           fade -> uFade               vignette -> uVignette
 *   grain -> uGrain           duotone -> uDuotone         dark -> uDark      light -> uLight
 *   (the strength argument)   -> uIntensity
 *
 * The host adds the common uniforms (uSrc, uResolution, uSeed) and, where it has time, `uTime`.
 */
export function lookUniforms(params: LookParams, intensity: number): Record<string, number | number[]> {
  return {
    uIntensity: intensity,
    uExposure: params.exposure,
    uContrast: params.contrast,
    uSaturation: params.saturation,
    uTemperature: params.temperature,
    uTint: params.tint,
    uLift: [...params.lift],
    uGamma: [...params.gamma],
    uGain: [...params.gain],
    uShadows: [...params.shadows],
    uHighlights: [...params.highlights],
    uSplit: params.split,
    uFade: params.fade,
    uVignette: params.vignette,
    uGrain: params.grain,
    uDuotone: params.duotone,
    uDark: [...params.dark],
    uLight: [...params.light],
  };
}

// -----------------------------------------------------------------------------------------------
// The looks

const NEUTRAL: LookParams = {
  exposure: 0,
  contrast: 1,
  saturation: 1,
  temperature: 0,
  tint: 0,
  lift: [0, 0, 0],
  gamma: [1, 1, 1],
  gain: [1, 1, 1],
  shadows: [0.5, 0.5, 0.5],
  highlights: [0.5, 0.5, 0.5],
  split: 0,
  fade: 0,
  vignette: 0,
  grain: 0,
  duotone: 0,
  dark: [0, 0, 0],
  light: [1, 1, 1],
};

type RGB = [number, number, number];

/** A frozen copy of an RGB triple (the type stays the mutable tuple the contract declares). */
function triple(v: readonly number[]): RGB {
  return Object.freeze([v[0] ?? 0, v[1] ?? 0, v[2] ?? 0]) as unknown as RGB;
}

/** A look from the neutral grade plus overrides. Everything is copied and frozen: looks are shared. */
function look(id: string, name: string, overrides: Partial<LookParams> = {}): LookDef {
  const p = { ...NEUTRAL, ...overrides };
  const params: LookParams = Object.freeze({
    ...p,
    lift: triple(p.lift),
    gamma: triple(p.gamma),
    gain: triple(p.gain),
    shadows: triple(p.shadows),
    highlights: triple(p.highlights),
    dark: triple(p.dark),
    light: triple(p.light),
  });
  return Object.freeze({ id, name, params });
}

/** `none` first (identity), then the colour looks, plain and classic ones before the stylised. */
export const LOOKS: readonly LookDef[] = Object.freeze([
  look('none', 'Original'),

  // Black and white
  look('mono', 'Mono', { saturation: 0, contrast: 1.08 }),
  look('noir', 'Noir', {
    saturation: 0,
    contrast: 1.55,
    exposure: -0.12,
    gamma: [0.9, 0.9, 0.9],
    vignette: 0.5,
    grain: 0.07,
  }),
  look('silver', 'Silver', {
    saturation: 0.15,
    contrast: 1.18,
    temperature: -0.2,
    fade: 0.02,
    shadows: [0.2, 0.26, 0.4],
    highlights: [0.9, 0.95, 1],
    split: 0.18,
    vignette: 0.25,
  }),
  look('sepia', 'Sepia', {
    contrast: 1.05,
    fade: 0.03,
    duotone: 0.88,
    dark: [0.16, 0.09, 0.04],
    light: [1, 0.92, 0.76],
    vignette: 0.3,
    grain: 0.04,
  }),

  // Colour
  look('vivid', 'Vivid', { saturation: 1.45, contrast: 1.14, exposure: 0.05 }),
  look('cinematic', 'Cinematic', {
    contrast: 1.14,
    saturation: 0.94,
    temperature: 0.04,
    gamma: [0.96, 0.96, 0.96],
    lift: [0, 0.008, 0.016],
    shadows: [0.05, 0.4, 0.45],
    highlights: [1, 0.62, 0.3],
    split: 0.4,
    vignette: 0.28,
  }),
  look('film', 'Film', {
    contrast: 1.06,
    saturation: 0.86,
    temperature: 0.12,
    fade: 0.07,
    shadows: [0.2, 0.4, 0.4],
    highlights: [1, 0.85, 0.6],
    split: 0.2,
    vignette: 0.22,
    grain: 0.11,
  }),
  look('golden-hour', 'Golden hour', {
    exposure: 0.1,
    contrast: 1.05,
    saturation: 1.12,
    temperature: 0.55,
    tint: 0.04,
    shadows: [0.55, 0.3, 0.2],
    highlights: [1, 0.78, 0.45],
    split: 0.32,
    vignette: 0.18,
  }),
  look('soft-pastel', 'Soft pastel', {
    exposure: 0.14,
    contrast: 0.86,
    saturation: 0.78,
    temperature: 0.04,
    gamma: [1.06, 1.06, 1.06],
    shadows: [0.55, 0.55, 0.85],
    highlights: [1, 0.78, 0.85],
    split: 0.3,
    fade: 0.07,
  }),
  look('cool-breeze', 'Cool breeze', {
    exposure: 0.05,
    contrast: 1.05,
    saturation: 1.05,
    temperature: -0.45,
    tint: -0.05,
    shadows: [0.15, 0.3, 0.6],
    highlights: [0.85, 0.95, 1],
    split: 0.25,
  }),
  look('warm-portrait', 'Warm portrait', {
    exposure: 0.1,
    contrast: 0.95,
    saturation: 0.96,
    temperature: 0.22,
    tint: 0.06,
    gamma: [1.04, 1.02, 1],
    highlights: [1, 0.9, 0.8],
    split: 0.18,
    fade: 0.02,
    vignette: 0.2,
  }),
  look('matte', 'Matte', {
    contrast: 0.9,
    saturation: 0.88,
    gain: [0.96, 0.96, 0.96],
    fade: 0.12,
  }),
  look('bleach-bypass', 'Bleach bypass', {
    exposure: 0.04,
    contrast: 1.45,
    saturation: 0.5,
    vignette: 0.25,
    grain: 0.07,
  }),
  look('cross-process', 'Cross process', {
    contrast: 1.2,
    saturation: 1.25,
    tint: -0.1,
    gamma: [0.9, 1.04, 1.12],
    lift: [0, 0.02, 0.05],
    shadows: [0.1, 0.5, 0.45],
    highlights: [1, 0.85, 0.35],
    split: 0.45,
  }),
  look('retro-70s', 'Retro 70s', {
    contrast: 0.95,
    saturation: 0.85,
    temperature: 0.35,
    tint: 0.1,
    lift: [0.02, 0.005, -0.01],
    shadows: [0.5, 0.25, 0.15],
    highlights: [1, 0.75, 0.4],
    split: 0.4,
    fade: 0.1,
    vignette: 0.35,
    grain: 0.08,
  }),
  look('night-neon', 'Night neon', {
    exposure: -0.08,
    contrast: 1.28,
    saturation: 1.35,
    shadows: [0.25, 0.1, 0.85],
    highlights: [1, 0.3, 0.72],
    split: 0.5,
    vignette: 0.4,
  }),
  look('rose-gold', 'Rose gold', {
    exposure: 0.08,
    contrast: 1.02,
    saturation: 0.9,
    temperature: 0.2,
    tint: 0.28,
    shadows: [0.55, 0.28, 0.32],
    highlights: [1, 0.82, 0.76],
    split: 0.35,
    fade: 0.04,
  }),
  look('emerald', 'Emerald', {
    contrast: 1.1,
    saturation: 1.05,
    temperature: -0.1,
    tint: -0.3,
    shadows: [0, 0.35, 0.25],
    highlights: [0.85, 1, 0.9],
    split: 0.35,
    duotone: 0.2,
    dark: [0, 0.1, 0.07],
    light: [0.85, 1, 0.9],
  }),
  look('high-key', 'High key', {
    exposure: 0.28,
    contrast: 0.9,
    saturation: 0.9,
    gamma: [1.1, 1.1, 1.1],
    fade: 0.03,
  }),
  look('blue-hour', 'Blue hour', {
    exposure: -0.12,
    contrast: 1.1,
    saturation: 1.05,
    temperature: -0.3,
    tint: 0.15,
    shadows: [0.1, 0.15, 0.5],
    highlights: [0.85, 0.7, 1],
    split: 0.4,
    vignette: 0.3,
  }),

  // Duotones and metals
  look('duotone-midnight', 'Midnight duotone', {
    contrast: 1.12,
    duotone: 1,
    dark: [0.07, 0.05, 0.3],
    light: [1, 0.8, 0.66],
    vignette: 0.2,
  }),
  look('duotone-sunset', 'Sunset duotone', {
    contrast: 1.1,
    duotone: 1,
    dark: [0.28, 0.03, 0.33],
    light: [1, 0.76, 0.25],
  }),
  look('duotone-ocean', 'Ocean duotone', {
    contrast: 1.1,
    duotone: 1,
    dark: [0, 0.08, 0.28],
    light: [0.62, 0.95, 0.95],
  }),
  look('black-gold', 'Black & gold', {
    contrast: 1.3,
    duotone: 0.92,
    dark: [0.03, 0.025, 0.02],
    light: [0.97, 0.78, 0.36],
    vignette: 0.3,
  }),
]);

const BY_ID = new Map(LOOKS.map((l) => [l.id, l]));

/** The look with this id, or undefined. */
export function findLook(id: string): LookDef | undefined {
  return BY_ID.get(id);
}
