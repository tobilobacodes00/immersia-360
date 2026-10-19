import { defineEffect } from '../glsl';

/**
 * Particle effects. None loops over particles: each pixel looks at the one grid cell it falls in
 * (plus, for the confetti cannons, its two neighbouring sectors), hashes the cell to decide whether it
 * holds a particle and what that particle is, and draws it analytically. Two or three cell layers of
 * different size and speed give depth. Pieces are kept inside their own cell, so no neighbour search.
 */

const ALL_MODES = ['colour', 'white', 'silver', 'gold'] as const;

// -------------------------------------------------------------------------------------------------
// Confetti: paper pieces drifting down, plus a pop from both bottom corners on every beat.

export const CONFETTI = defineEffect(
  { id: 'confetti', name: 'Confetti', defaultIntensity: 1, colorModes: ALL_MODES },
  {
    helpers: ['hash', 'color'],
    blend: 'mix',
    code: /* glsl */ `
// One flat piece of paper, tumbling from edge-on to face-on. d: position relative to the piece centre,
// L: its half-length, aaw: anti-aliasing half-width (all in the same units). Returns premultiplied colour.
vec4 confettiPiece(vec2 d, float L, float theta, float flip, float aaw, int mode, vec3 base, float hc) {
  float reach = 1.2 * L + aaw;
  if (dot(d, d) > reach * reach) return vec4(0.0);
  float c = cos(theta);
  float s = sin(theta);
  vec2 r = vec2(c * d.x + s * d.y, c * d.y - s * d.x);
  float facing = abs(flip);
  vec2 q = abs(r) - vec2(L, 0.5 * L * max(facing, 0.18));
  float sd = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);
  float a = 1.0 - smoothstep(-aaw, aaw, sd);
  if (a <= 0.0) return vec4(0.0);
  vec3 col = shadeColor(mode, pickColor(mode, base, hc), facing);
  return vec4(col * a, a);
}

// Pieces falling through a grid; a cell holds at most one piece and the piece never leaves its cell.
vec4 confettiLayer(vec2 p, float cell, float fall, float seed, float px) {
  vec2 q = p / cell;
  q.y += uTime * fall / cell;
  vec2 id = floor(q);
  vec3 hA = hash23(id, seed);
  if (hA.x > 0.5) return vec4(0.0);
  vec3 hB = hash23(id + 7.0, seed);
  vec3 hC = hash23(id + 19.0, seed);
  float swing = sin(uTime * (0.9 + 1.3 * hC.x) + hC.z * TAU);
  vec2 centre = vec2((hB.x - 0.5) * 0.24 + 0.12 * swing, (hB.y - 0.5) * 0.24);
  vec2 d = fract(q) - 0.5 - centre;
  float L = (0.06 + 0.07 * hA.z) * (1.0 + 0.2 * uPulse);
  float spin = (hC.y < 0.5 ? -1.0 : 1.0) * (1.0 + 3.0 * hC.x);
  float theta = hB.z * TAU + uTime * spin;
  float flip = cos(uTime * (2.0 + 3.0 * hC.y) + hC.z * TAU);
  return confettiPiece(d, L, theta, flip, 0.75 * px / cell, uColorMode, uColor, hA.y);
}

// A cannon at 'origin' throws a fan of pieces on each beat. age (0..1) is the progress through the beat.
// Gravity moves every piece by the same amount, so the fan is radial around a moved origin and each
// pixel only has to look at its own angular sector and the two next to it.
vec4 confettiBurst(vec2 p, vec2 origin, float aim, float side, float age, float seed, float px) {
  const float SECTORS = 12.0;
  const float HALF_ANGLE = 0.62;
  vec2 d = p - (origin + vec2(0.0, -0.9 * age * age));
  float rel = safeAtan(d) - aim;
  rel -= TAU * floor((rel + PI) / TAU);
  float k0 = floor((rel + HALF_ANGLE) / (2.0 * HALF_ANGLE) * SECTORS);
  float grow = smoothstep(0.0, 0.06, age);
  float vis = 1.0 - smoothstep(0.55, 0.95, age);
  float punch = 0.75 + 0.35 * uPulse;
  vec4 acc = vec4(0.0);
  for (int j = -1; j <= 1; j++) {
    float k = k0 + float(j);
    if (k < 0.0 || k > SECTORS - 1.0) continue;
    vec3 h = hash23(vec2(k, side), seed);
    vec3 h2 = hash23(vec2(k + 40.0, side), seed);
    float ang = aim - HALF_ANGLE + (k + 0.15 + 0.7 * h.x) / SECTORS * 2.0 * HALF_ANGLE;
    float travel = (0.75 + 0.85 * h.y) * (1.0 - exp(-3.2 * age));
    vec2 rel2 = d - travel * vec2(cos(ang), sin(ang));
    float L = (0.010 + 0.007 * h2.x) * punch * grow;
    float theta = h2.y * TAU + age * (8.0 + 10.0 * h2.z);
    float flip = cos(age * (10.0 + 12.0 * h2.x) + h2.y * TAU);
    vec4 pc = confettiPiece(rel2, L, theta, flip, 0.75 * px, uColorMode, uColor, h.z);
    acc = pc + acc * (1.0 - pc.a);
  }
  return acc * vis;
}

vec3 effect(vec2 p, vec3 src) {
  float px = 1.0 / min(uResolution.x, uResolution.y);
  float w = uResolution.x * px;
  vec3 col = src;
  vec4 back = confettiLayer(p, 0.105, 0.11, uSeed + 3.0, px);
  col = col * (1.0 - 0.85 * back.a) + 0.85 * back.rgb;
  vec4 front = confettiLayer(p, 0.165, 0.20, uSeed, px);
  col = col * (1.0 - front.a) + front.rgb;
  vec4 left = confettiBurst(p, vec2(0.03, -0.03), 1.08, 0.0, uBeat, uSeed + 11.0, px);
  col = col * (1.0 - left.a) + left.rgb;
  vec4 right = confettiBurst(p, vec2(w - 0.03, -0.03), PI - 1.08, 1.0, uBeat, uSeed + 11.0, px);
  col = col * (1.0 - right.a) + right.rgb;
  return col;
}
`,
  },
);

// -------------------------------------------------------------------------------------------------
// Bubbles: translucent soap bubbles rising and wobbling; each is a small lens with an iridescent rim.

export const BUBBLES = defineEffect(
  { id: 'bubbles', name: 'Bubbles', defaultIntensity: 1 },
  {
    helpers: ['hash', 'color'],
    blend: 'mix',
    code: /* glsl */ `
// Adds one layer of bubbles to col. The lens term is a difference against the plain source, so
// bubbles drawn earlier survive underneath a bubble drawn later.
vec3 bubbleLayer(vec3 col, vec3 src, vec2 p, float cell, float rise, float seed, float px) {
  vec2 q = p / cell;
  q.y -= uTime * rise / cell;
  vec2 id = floor(q);
  vec3 hA = hash23(id, seed);
  if (hA.x > 0.5) return col;
  vec3 hB = hash23(id + 11.0, seed);
  float rad = (0.12 + 0.12 * hA.y) * (1.0 + 0.10 * uPulse);
  vec2 centre = vec2((hB.x - 0.5) * 0.24 + 0.08 * sin(uTime * (0.7 + 0.8 * hB.y) + hB.z * TAU), (hB.y - 0.5) * 0.24);
  vec2 d = fract(q) - 0.5 - centre;
  float r = length(d) / rad;
  float aa = px / (cell * rad);
  if (r > 1.0 + 2.0 * aa) return col;
  float inside = 1.0 - smoothstep(1.0 - aa, 1.0 + aa, r);

  // the lens: magnify the picture a little, most at the middle
  vec2 pr = p - d * cell * 0.22 * (1.0 - r * r);
  vec3 seen = texture(uSrc, clamp(toUv(pr, uResolution), 0.0, 1.0)).rgb;
  col += (seen - src) * inside * 0.9;

  // thin-film rim, brighter on the beat
  float k = 0.75 + 0.5 * uPulse;
  float rim = smoothstep(0.72, 0.98, r) * inside;
  vec3 film = rainbow(r * 1.4 + safeAtan(d) / TAU * 0.6 + uTime * 0.07 + hA.z);
  col += film * rim * 0.55 * k;

  // window glint upper left, a faint echo opposite
  vec2 hl = vec2(-0.42, 0.46) * rad;
  float spec = exp(-dot(d - hl, d - hl) / (rad * rad * 0.018));
  float echo = 0.3 * exp(-dot(d + hl * 0.8, d + hl * 0.8) / (rad * rad * 0.05));
  col += vec3(1.0) * (spec + echo) * inside * k * 0.85;
  col += vec3(0.04, 0.05, 0.07) * inside * (1.0 - r);
  return col;
}

vec3 effect(vec2 p, vec3 src) {
  float px = 1.0 / min(uResolution.x, uResolution.y);
  vec3 col = src;
  col = bubbleLayer(col, src, p, 0.20, 0.10, uSeed + 5.0, px);
  col = bubbleLayer(col, src, p, 0.36, 0.06, uSeed, px);
  return col;
}
`,
  },
);

// -------------------------------------------------------------------------------------------------
// Sparkle: twinkling four-point glints that favour the bright parts of the picture; half of them flash on the beat.

export const SPARKLE = defineEffect(
  { id: 'sparkle', name: 'Sparkle', defaultIntensity: 0.9, colorModes: ALL_MODES },
  {
    helpers: ['hash', 'color'],
    blend: 'mix',
    code: /* glsl */ `
// A star in units of its own half-length: bright core, long cross, short diagonals.
float starShape(vec2 u) {
  vec2 a = abs(u);
  float core = exp(-dot(u, u) * 22.0);
  float arms = exp(-a.y * 38.0) * (1.0 - smoothstep(0.0, 1.0, a.x)) + exp(-a.x * 38.0) * (1.0 - smoothstep(0.0, 1.0, a.y));
  vec2 b = abs(vec2(u.x + u.y, u.x - u.y)) * 0.7071;
  float diag = exp(-b.y * 55.0) * (1.0 - smoothstep(0.0, 0.5, b.x)) + exp(-b.x * 55.0) * (1.0 - smoothstep(0.0, 0.5, b.y));
  return core + 0.7 * arms + 0.25 * diag;
}

vec3 sparkleLayer(vec2 p, float cell, float seed) {
  vec2 q = p / cell;
  vec2 id = floor(q);
  vec3 hA = hash23(id, seed);
  vec3 hB = hash23(id + 13.0, seed);
  if (hB.z > 0.72) return vec3(0.0);
  float blink = pow(max(0.0, sin(uTime * (1.3 + 2.4 * hA.x) + hA.y * TAU)), 4.0);
  float kick = step(0.45, hA.z) * uPulse;
  float life = clamp(blink + 0.9 * kick, 0.0, 1.0);
  if (life < 0.03) return vec3(0.0);
  vec2 centre = (hB.xy - 0.5) * 0.26;
  vec2 d = fract(q) - 0.5 - centre;
  float reachLen = (0.20 + 0.14 * hA.x) * (0.55 + 0.45 * life);
  float s = starShape(d / reachLen);
  // glints belong on highlights: weight by the picture's brightness under the star
  vec2 cp = (id + 0.5 + centre) * cell;
  vec3 under = texture(uSrc, clamp(toUv(cp, uResolution), 0.0, 1.0)).rgb;
  float onLight = 0.55 + 0.80 * smoothstep(0.25, 0.8, luma(under));
  vec3 tint = uColorMode == 0 ? mix(vec3(1.0), festive(hB.z * 1.38), 0.5) : uColor;
  return tint * s * life * onLight * 1.4;
}

vec3 effect(vec2 p, vec3 src) {
  vec3 light = sparkleLayer(p, 0.20, uSeed) + sparkleLayer(p, 0.095, uSeed + 9.0);
  return screenBlend(src, light);
}
`,
  },
);

// -------------------------------------------------------------------------------------------------
// Snow: three depths of soft flakes drifting down; the near ones are big and out of focus.

export const SNOW = defineEffect(
  { id: 'snow', name: 'Snowfall', defaultIntensity: 0.9 },
  {
    helpers: ['hash', 'color'],
    blend: 'mix',
    code: /* glsl */ `
// Coverage of one layer of flakes. 'soft' is the blur: 1 = a pure soft blob, small = a crisp disc.
float flakeLayer(vec2 p, float cell, float fall, float wind, float radius, float soft, float seed, float px) {
  vec2 q = p / cell;
  q.y += uTime * fall / cell;
  q.x -= uTime * wind / cell;
  vec2 id = floor(q);
  vec3 hA = hash23(id, seed);
  if (hA.x > 0.62) return 0.0;
  vec3 hB = hash23(id + 7.0, seed);
  float sway = 0.10 * sin(uTime * (0.5 + 0.7 * hA.y) + hB.z * TAU);
  vec2 centre = vec2((hB.x - 0.5) * 0.3 + sway, (hB.y - 0.5) * 0.3);
  float r = length(fract(q) - 0.5 - centre);
  float rad = radius * (0.6 + 0.4 * hA.z) * (1.0 + 0.25 * uPulse);
  float edge = max(rad * soft, 1.5 * px / cell);
  return 1.0 - smoothstep(rad - edge, rad, r);
}

vec3 effect(vec2 p, vec3 src) {
  float px = 1.0 / min(uResolution.x, uResolution.y);
  vec3 snow = vec3(0.96, 0.98, 1.0);
  vec3 col = src * vec3(0.975, 0.99, 1.015);
  col = mix(col, snow, 0.9 * flakeLayer(p, 0.085, 0.070, 0.010, 0.10, 0.35, uSeed + 2.0, px));
  col = mix(col, snow, 0.8 * flakeLayer(p, 0.150, 0.120, 0.020, 0.12, 0.50, uSeed + 1.0, px));
  col = mix(col, snow, 0.55 * flakeLayer(p, 0.300, 0.200, 0.030, 0.15, 0.85, uSeed, px));
  return col;
}
`,
  },
);

// -------------------------------------------------------------------------------------------------
// Hearts: hearts rising and swaying, beating on the beat.

export const HEARTS = defineEffect(
  { id: 'hearts', name: 'Hearts', defaultIntensity: 1, colorModes: ALL_MODES },
  {
    helpers: ['hash', 'color'],
    blend: 'mix',
    code: /* glsl */ `
// The classic heart curve (x^2 + y^2 - 1)^3 = x^2 y^3, negative inside. Returns f and |grad f|, so
// f / |grad f| is a first-order distance to the outline (analytic: no screen derivatives, which would
// misbehave at cell borders).
vec2 heartField(vec2 z) {
  float x2 = z.x * z.x;
  float y2 = z.y * z.y;
  float a = x2 + y2 - 1.0;
  float f = a * a * a - x2 * z.y * y2;
  float gx = 6.0 * z.x * a * a - 2.0 * z.x * z.y * y2;
  float gy = 6.0 * z.y * a * a - 3.0 * x2 * y2;
  return vec2(f, max(length(vec2(gx, gy)), 1e-2));
}

vec4 heartLayer(vec2 p, float cell, float rise, float seed, float px) {
  vec2 q = p / cell;
  q.y -= uTime * rise / cell;
  vec2 id = floor(q);
  vec3 hA = hash23(id, seed);
  if (hA.x > 0.4) return vec4(0.0);
  vec3 hB = hash23(id + 5.0, seed);
  float sway = 0.09 * sin(uTime * (0.6 + 0.6 * hA.y) + hB.z * TAU);
  vec2 centre = vec2((hB.x - 0.5) * 0.16 + sway, (hB.y - 0.5) * 0.16);
  float rad = (0.14 + 0.055 * hA.z) * (1.0 + 0.20 * uPulse);
  vec2 d0 = fract(q) - 0.5 - centre;
  float tilt = (hB.z - 0.5) * 0.6 + 0.15 * sin(uTime * 0.9 + hA.y * TAU);
  vec2 z = rot2(tilt) * d0 / rad + vec2(0.0, 0.12);

  vec2 fg = heartField(z);
  float unitPx = rad * cell / px;
  float dist = fg.x / fg.y * unitPx;
  float cover = clamp(0.5 - dist, 0.0, 1.0);
  // the glow uses a plain radial falloff (the first-order distance badly underestimates far from the outline)
  // and is windowed to the cell, so no cell border ever shows
  float window = 1.0 - smoothstep(0.30, 0.46, max(abs(d0.x), abs(d0.y)));
  float glow = exp(-max(length(z * vec2(0.9, 0.85)) - 1.0, 0.0) / 0.30) * 0.22 * window;
  if (cover <= 0.0 && glow < 0.004) return vec4(0.0);

  vec3 base = pickRomantic(uColorMode, uColor, hA.y);
  float inner = clamp(-dist / (0.40 * unitPx), 0.0, 1.0);
  vec3 c = shadeColor(uColorMode, base, 0.35 + 0.65 * inner) * (0.88 + 0.18 * inner);
  vec2 gp = z - vec2(-0.45, 0.62);
  c += vec3(1.0) * exp(-dot(gp, gp) * 7.0) * (0.45 + 0.25 * uPulse) * inner;
  vec3 rgb = c * cover + base * glow * (1.0 - cover);
  float a = cover + 0.35 * glow * (1.0 - cover);
  return vec4(rgb, a);
}

vec3 effect(vec2 p, vec3 src) {
  float px = 1.0 / min(uResolution.x, uResolution.y);
  vec3 col = src;
  vec4 back = heartLayer(p, 0.18, 0.15, uSeed + 4.0, px);
  col = col * (1.0 - 0.9 * back.a) + 0.9 * back.rgb;
  vec4 front = heartLayer(p, 0.30, 0.09, uSeed, px);
  col = col * (1.0 - front.a) + front.rgb;
  return col;
}
`,
  },
);
