import { defineEffect } from '../glsl';

/**
 * Effects that move the picture's channels or rows around. They scale their displacement by
 * uIntensity (blend 'self') instead of cross-fading with the source, and at intensity 0 every
 * displacement is exactly zero, so the source comes back unchanged. Sampling goes through mirrorUv so
 * a shift past the edge shows mirrored picture and not a smear of edge pixels.
 */

// -------------------------------------------------------------------------------------------------
// Glitch: horizontal tears, thin tears and displaced blocks, with the colour channels pulled apart.
// A little of it is always happening; on each beat the tearing spikes and decays with the pulse.
// The pattern re-rolls 14 times a second (a hash of the time slice), so it is deterministic.

export const GLITCH = defineEffect(
  { id: 'glitch', name: 'Glitch', defaultIntensity: 0.8 },
  {
    helpers: ['hash', 'geom'],
    blend: 'self',
    code: /* glsl */ `
vec3 effect(vec2 p, vec3 src) {
  float k = uIntensity;
  float ms = min(uResolution.x, uResolution.y);
  float slice = floor(uTime * 14.0);
  float spike = uPulse * uPulse;
  float tearRate = 0.04 + 0.26 * spike;

  float bandA = floor(vUv.y * 20.0);
  float tornA = step(hash21(vec2(bandA, slice), uSeed), tearRate);
  float shiftA = (hash21(vec2(bandA + 50.0, slice), uSeed) - 0.5) * (0.08 + 0.12 * spike);

  float bandB = floor(vUv.y * 74.0);
  float tornB = step(hash21(vec2(bandB, slice + 31.0), uSeed + 1.0), tearRate * 0.5);
  float shiftB = (hash21(vec2(bandB + 90.0, slice), uSeed + 1.0) - 0.5) * (0.05 + 0.08 * spike);

  vec2 cellB = floor(vUv * vec2(10.0, 7.0));
  float block = step(hash21(cellB + 200.0, uSeed + 2.0 + slice), tearRate * 0.45);
  vec2 blockShift = (hash22(cellB + 300.0, uSeed + 3.0 + slice) - 0.5) * vec2(0.12, 0.08) * (0.5 + spike);

  float torn = max(tornA, tornB);
  vec2 off = vec2(tornA * shiftA + tornB * shiftB, 0.0) + block * blockShift;
  float split = (0.002 + 0.010 * spike + 0.012 * torn * (0.4 + spike)) * ms / uResolution.x;
  vec2 at = vUv + off * k;
  vec2 pull = vec2(split * k, 0.0);
  vec3 col = vec3(
    texture(uSrc, mirrorUv(at + pull)).r,
    texture(uSrc, mirrorUv(at)).g,
    texture(uSrc, mirrorUv(at - pull)).b
  );
  float tape = hash21(floor(vUv * uResolution / (0.004 * ms)), uSeed + slice) - 0.5;
  col += tape * 0.10 * torn * k;
  return col;
}
`,
  },
);

// -------------------------------------------------------------------------------------------------
// RGB shift: red and blue slide apart along a slowly swinging axis and fan out towards the corners
// like a cheap lens. The split opens on every beat.

export const RGB_SHIFT = defineEffect(
  { id: 'rgb-shift', name: 'RGB shift', defaultIntensity: 0.8 },
  {
    helpers: ['geom'],
    blend: 'self',
    code: /* glsl */ `
vec3 effect(vec2 p, vec3 src) {
  float k = uIntensity;
  float ms = min(uResolution.x, uResolution.y);
  float amp = (0.0045 + 0.015 * uPulse) * k;
  float a = 0.5 * sin(uTime * 0.6);
  vec2 dir = vec2(cos(a), sin(a));
  vec2 away = p - 0.5 * uResolution / ms;
  vec2 off = dir * amp + away * (0.010 + 0.016 * uPulse) * k;
  vec2 duv = off * ms / uResolution;
  return vec3(
    texture(uSrc, mirrorUv(vUv + duv)).r,
    texture(uSrc, vUv).g,
    texture(uSrc, mirrorUv(vUv - duv)).b
  );
}
`,
  },
);

// -------------------------------------------------------------------------------------------------
// VHS: 240 scanlines with per-line jitter, chroma bleed, a tracking band rolling up the frame, noise
// at the bottom edge and a slightly tired colour. Jitter and bleed widen on the beat.

export const VHS = defineEffect(
  { id: 'vhs', name: 'VHS tape', defaultIntensity: 0.8 },
  {
    helpers: ['hash', 'geom'],
    blend: 'self',
    code: /* glsl */ `
vec3 effect(vec2 p, vec3 src) {
  float k = uIntensity;
  float ms = min(uResolution.x, uResolution.y);
  float lines = 240.0;
  float row = floor(vUv.y * lines);
  float tick = floor(uTime * 30.0);
  float jitter = hash21(vec2(row, tick), uSeed) - 0.5;
  float bandY = 1.0 - fract(uTime * 0.085 + 0.2);
  float inBand = smoothstep(0.06, 0.0, abs(vUv.y - bandY));
  float foot = smoothstep(0.035, 0.0, vUv.y);

  float wobble = 0.0008 * jitter * (1.0 + 3.0 * uPulse) + inBand * (0.006 * jitter + 0.004) + foot * 0.03 * jitter;
  float bleed = (0.006 + 0.002 * uPulse) * ms / uResolution.x;
  vec2 at = vec2(vUv.x + wobble * k, vUv.y);
  vec2 pull = vec2(bleed * k, 0.0);
  vec3 mid = texture(uSrc, mirrorUv(at)).rgb;
  vec3 col = vec3(texture(uSrc, mirrorUv(at + pull)).r, mid.g, texture(uSrc, mirrorUv(at - pull)).b);

  float scan = 0.5 + 0.5 * cos(vUv.y * lines * TAU);
  col *= 1.0 - 0.10 * k * scan;
  float grain = hash21(floor(vec2(vUv.x * 480.0, row)), uSeed + tick) - 0.5;
  col += grain * (0.05 + 0.20 * inBand + 0.30 * foot) * k;
  return mix(vec3(luma(col)), col, 1.0 - 0.18 * k);
}
`,
  },
);
