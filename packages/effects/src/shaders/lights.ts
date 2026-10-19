import { defineEffect } from '../glsl';

/**
 * Light effects: they add light to the picture (screen-blended, so highlights never clip harshly) and
 * keep time with the music through uBeat (phase) and uPulse (envelope).
 */

const ALL_MODES = ['colour', 'white', 'silver', 'gold'] as const;

// -------------------------------------------------------------------------------------------------
// Light rings: concentric rings of light that break into slowly turning arcs; a ripple leaves the
// centre on every beat and again on the off-beat, and the rings swell and brighten with the pulse.

export const LIGHT_RINGS = defineEffect(
  { id: 'light-rings', name: 'Light rings', defaultIntensity: 0.9, colorModes: ALL_MODES },
  {
    helpers: ['color'],
    blend: 'mix',
    code: /* glsl */ `
// A ring of radius r: a bright thin core plus a soft halo.
float ringProfile(float d, float r, float core, float glow) {
  float x = abs(d - r);
  return exp(-x * x / (core * core)) + 0.3 * exp(-x / glow);
}

// The ring breaks into turning segments, so it reads as light and not as a drawn circle.
float arcMask(float ang, float count, float spin, float phase) {
  return smoothstep(-0.35, 0.85, sin(ang * count + spin + phase));
}

vec3 ringColor(float h, float arc) {
  vec3 c = uColorMode == 0 ? mix(vec3(1.0, 0.95, 0.84), rainbow(h), 0.55) : uColor;
  return shadeColor(uColorMode, c, 0.55 + 0.45 * arc);
}

vec3 effect(vec2 p, vec3 src) {
  float ms = min(uResolution.x, uResolution.y);
  vec2 c = 0.5 * uResolution / ms + 0.015 * vec2(sin(uTime * 0.31), cos(uTime * 0.23));
  vec2 d = p - c;
  float r = length(d);
  float ang = safeAtan(d);
  float swell = 1.0 + 0.045 * uPulse;
  float gain = 0.55 + 0.65 * uPulse;
  vec3 light = vec3(0.0);

  // three standing rings
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float radius = (0.20 + 0.135 * fi) * swell;
    float turn = mod(fi, 2.0) < 0.5 ? 1.0 : -1.0;
    float arc = arcMask(ang, 3.0 + 2.0 * fi, uTime * (0.55 - 0.15 * fi) * turn, fi * 1.7);
    float line = ringProfile(r, radius, 0.0035, 0.016);
    light += ringColor(ang / TAU + 0.2 * fi + 0.04 * uTime, arc) * line * (0.35 + 0.65 * arc) * gain;
  }

  // ripples leaving the centre: one on the beat, a softer one on the off-beat
  for (int j = 0; j < 2; j++) {
    float ph = fract(uBeat + 0.5 * float(j));
    float radius = 0.05 + 0.55 * pow(ph, 0.7);
    float fade = (1.0 - ph) * (1.0 - ph) * (j == 0 ? 0.9 : 0.45);
    float line = ringProfile(r, radius, 0.004 + 0.008 * ph, 0.02);
    light += ringColor(ang / TAU + 0.5 * float(j), 1.0) * line * fade;
  }

  // a faint wash from the middle that breathes with the pulse
  light += ringColor(0.1, 0.5) * exp(-r * 2.2) * 0.07 * uPulse;
  return screenBlend(src, light);
}
`,
  },
);

// -------------------------------------------------------------------------------------------------
// Disco: wandering coloured spots and swinging beams. Two groups of lights take turns: group A is
// struck on the beat, group B on the off-beat, so the lights visibly switch with the music.

export const DISCO = defineEffect(
  { id: 'disco', name: 'Disco', defaultIntensity: 0.85 },
  {
    helpers: ['color'],
    blend: 'mix',
    code: /* glsl */ `
vec3 effect(vec2 p, vec3 src) {
  float ms = min(uResolution.x, uResolution.y);
  vec2 res = uResolution / ms;
  float t = uTime;
  float offBeat = exp(-5.0 * fract(uBeat + 0.5));
  float levelA = 0.22 + 0.95 * uPulse;
  float levelB = 0.22 + 0.95 * offBeat;
  vec3 light = vec3(0.0);

  // spots wandering over the picture
  for (int i = 0; i < 4; i++) {
    float fi = float(i);
    vec2 c = vec2(res.x * (0.5 + 0.40 * sin(t * (0.31 + 0.07 * fi) + fi * 1.9)),
                  res.y * (0.5 + 0.36 * sin(t * (0.23 + 0.05 * fi) + fi * 2.7 + 1.0)));
    float r = length(p - c);
    float spot = exp(-r * r / 0.026);
    float level = mod(fi, 2.0) < 0.5 ? levelA : levelB;
    light += lightHue(fi * 0.27 + t * 0.035) * spot * level * 0.8;
  }

  // beams swinging down from above the frame
  for (int j = 0; j < 3; j++) {
    float fj = float(j);
    vec2 o = vec2(res.x * (0.18 + 0.32 * fj), res.y + 0.08);
    float sweep = 0.55 * sin(t * (0.37 + 0.09 * fj) + fj * 2.3);
    vec2 dir = vec2(sin(sweep), -cos(sweep));
    vec2 v = p - o;
    float along = dot(v, dir);
    float across = v.x * dir.y - v.y * dir.x;
    float width = 0.05 + 0.07 * max(along, 0.0);
    float beam = exp(-across * across / (width * width)) * smoothstep(0.0, 0.12, along) * exp(-along * 0.7);
    float level = j == 1 ? levelB : levelA;
    light += lightHue(fj * 0.33 + 0.5 + t * 0.03) * beam * level * 0.5;
  }

  // the room dims a little so the lights read; they ease off over bright areas
  vec3 room = src * 0.86;
  return room + light * (1.0 - 0.55 * room);
}
`,
  },
);

// -------------------------------------------------------------------------------------------------
// Strobe: one soft white flash per beat. PHOTOSENSITIVITY: the flash is capped at STROBE_PEAK_LIFT of
// the way to white (screen-style, so bright areas move less than dark ones) and lasts a fraction of a
// beat. The shader cannot see the tempo, so the 3 flashes-per-second ceiling (WCAG 2.3.1) holds only
// while the beat grid it is given stays at or below STROBE_MAX_BPM: the host must fold faster tempos
// down (halve them) before they reach uBeat / uPulse.

/** Largest fraction of the way to white a strobe flash can lift any pixel, at intensity 1. */
export const STROBE_PEAK_LIFT = 0.35;
/** Beat rate at which one flash per beat reaches the 3 Hz ceiling; hosts must keep the grid at or below it. */
export const STROBE_MAX_BPM = 180;

export const STROBE = defineEffect(
  { id: 'strobe', name: 'Strobe', defaultIntensity: 0.7 },
  {
    blend: 'self',
    code: /* glsl */ `
vec3 effect(vec2 p, vec3 src) {
  float flash = pow(clamp(uPulse, 0.0, 1.0), 2.5);
  float lift = ${STROBE_PEAK_LIFT.toFixed(2)} * uIntensity * flash;
  return src + (vec3(0.985, 0.99, 1.0) - src) * lift;
}
`,
  },
);

// -------------------------------------------------------------------------------------------------
// Prism flare: an anamorphic lens flare from a light that roams the upper frame, with a dispersed
// halo ring and four ghosts along the axis through the centre. It brightens on the beat.

export const PRISM_FLARE = defineEffect(
  { id: 'prism-flare', name: 'Prism flare', defaultIntensity: 0.85 },
  {
    helpers: ['color'],
    blend: 'mix',
    code: /* glsl */ `
float ringLine(float r, float radius, float width) {
  float q = (r - radius) / width;
  return exp(-q * q);
}

vec3 effect(vec2 p, vec3 src) {
  float ms = min(uResolution.x, uResolution.y);
  vec2 res = uResolution / ms;
  float t = uTime;
  vec2 source = vec2(res.x * (0.5 + 0.30 * sin(t * 0.21 + 0.7)), res.y * (0.66 + 0.18 * sin(t * 0.17 + 2.0)));
  vec2 mid = 0.5 * res;
  vec2 d = p - source;
  float r = length(d);
  float k = 0.70 + 0.50 * uPulse;

  // glow, horizontal streak and star rays at the source
  vec3 total = vec3(1.0, 0.93, 0.80) * (0.55 * exp(-r * 7.0) + 0.9 * exp(-r * 30.0));
  total += vec3(0.75, 0.85, 1.0) * 0.55 * exp(-abs(d.y) * 80.0) * exp(-abs(d.x) * 1.8);
  float ray = pow(0.5 + 0.5 * cos(safeAtan(d) * 6.0 + t * 0.15), 12.0);
  total += vec3(1.0, 0.95, 0.85) * 0.35 * ray * exp(-r * 5.0);

  // dispersed halo: red sits inside blue
  float ringR = 0.20 + 0.02 * uPulse;
  total += 0.5 * vec3(ringLine(r * 0.965, ringR, 0.012), ringLine(r, ringR, 0.012), ringLine(r * 1.035, ringR, 0.012));

  // ghosts along the axis from the source through the centre of the frame and beyond
  vec2 axis = mid - source;
  for (int i = 0; i < 4; i++) {
    float fi = float(i);
    vec2 gp = source + axis * (0.45 + 0.50 * fi);
    float gr = 0.04 + 0.022 * fi;
    float dg = length(p - gp);
    float disc = (1.0 - smoothstep(gr * 0.8, gr, dg)) * 0.18 + ringLine(dg, gr, 0.006) * 0.35;
    vec3 tone = mix(vec3(1.0), rainbow(0.15 * fi + 0.3 + 0.05 * t), 0.6);
    total += tone * disc * (0.9 - 0.15 * fi);
  }
  return screenBlend(src, total * k);
}
`,
  },
);

// -------------------------------------------------------------------------------------------------
// Light leak: soft warm glows drifting in from the frame edges over slightly faded blacks, like a
// leaky camera back. Breathes gently with the pulse.

export const LIGHT_LEAK = defineEffect(
  { id: 'light-leak', name: 'Light leak', defaultIntensity: 0.8 },
  {
    helpers: ['noise', 'geom'],
    blend: 'mix',
    code: /* glsl */ `
vec3 effect(vec2 p, vec3 src) {
  float ms = min(uResolution.x, uResolution.y);
  vec2 res = uResolution / ms;
  float t = uTime;
  vec3 leak = vec3(0.0);
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    vec2 c = vec2(res.x * (0.5 + 0.60 * sin(t * (0.10 + 0.03 * fi) + fi * 2.4)),
                  res.y * (0.5 + 0.60 * cos(t * (0.08 + 0.025 * fi) + fi * 1.7)));
    vec2 v = (p - c) * vec2(1.0, 1.2);
    float g = exp(-length(v) * (2.2 + 0.5 * fi));
    vec3 tint = i == 0 ? vec3(1.00, 0.52, 0.18) : (i == 1 ? vec3(1.00, 0.30, 0.50) : vec3(1.00, 0.80, 0.35));
    leak += tint * g;
  }
  float n = vnoise(p * 1.8 + vec2(t * 0.07, -t * 0.05), uSeed);
  leak *= (0.5 + 0.7 * n) * (0.55 + 0.28 * uPulse);
  vec3 faded = src * 0.94 + 0.025;
  return screenBlend(faded, leak);
}
`,
  },
);

// -------------------------------------------------------------------------------------------------
// Film burn: the edge of the frame scorches (dark red, orange, white-hot) in a slow swell, with film
// grain, a faint gate flicker and a soft vignette. The burn deepens on the beat.

export const FILM_BURN = defineEffect(
  { id: 'film-burn', name: 'Film burn', defaultIntensity: 0.85 },
  {
    helpers: ['noise', 'geom'],
    blend: 'mix',
    code: /* glsl */ `
// 0 = untouched, 1 = white-hot.
vec3 burnRamp(float x) {
  vec3 c = mix(vec3(0.0), vec3(0.55, 0.06, 0.02), smoothstep(0.0, 0.35, x));
  c = mix(c, vec3(1.00, 0.45, 0.08), smoothstep(0.25, 0.65, x));
  c = mix(c, vec3(1.00, 0.86, 0.45), smoothstep(0.55, 0.90, x));
  return mix(c, vec3(1.0, 0.97, 0.90), smoothstep(0.85, 1.10, x));
}

vec3 effect(vec2 p, vec3 src) {
  float ms = min(uResolution.x, uResolution.y);
  vec2 res = uResolution / ms;
  float t = uTime;
  float swell = 0.5 + 0.5 * sin(t * 0.62 - 1.0);
  swell = swell * swell * (3.0 - 2.0 * swell);
  float depth = (0.025 + 0.11 * swell) * (1.0 + 0.18 * uPulse);
  float edge = min(min(p.x, res.x - p.x), 1.7 * min(p.y, res.y - p.y));
  float n = fbm(p * 2.4 + vec2(0.0, t * 0.12), uSeed);
  float x = clamp((depth * (0.35 + 1.10 * n) - edge) / 0.10, 0.0, 1.0);
  vec3 burn = burnRamp(x) * smoothstep(0.0, 0.25, x);
  vec3 col = screenBlend(src, burn * (0.80 + 0.25 * uPulse));

  float frame = floor(t * 24.0);
  col *= 1.0 + 0.03 * (hash11(frame, uSeed) - 0.5);
  float grain = hash21(floor(p / 0.0022), uSeed + frame) - 0.5;
  col += grain * (0.05 + 0.03 * uPulse);
  vec2 v = (p - 0.5 * res) / (0.5 * length(res));
  col *= 1.0 - 0.12 * dot(v, v);
  return col;
}
`,
  },
);
