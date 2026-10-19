/**
 * GLSL ES 3.00 shaders. Image coordinates are y-down (see VERTEX in gl.ts).
 *
 * Sources are sampled through `outToSource`: output uv → centre-cropped display uv → source uv,
 * undoing the container rotation. So every pass works in OUTPUT space (the 9:16 / 1:1 / 16:9 frame
 * the guest sees), whatever the camera's orientation.
 */

const CROP = /* glsl */ `
uniform vec2 uCropScale;
uniform vec2 uCropOffset;
uniform int uRotation;
vec2 displayToSource(vec2 d) {
  if (uRotation == 90) return vec2(d.y, 1.0 - d.x);
  if (uRotation == 180) return vec2(1.0 - d.x, 1.0 - d.y);
  if (uRotation == 270) return vec2(1.0 - d.y, d.x);
  return d;
}
vec2 outToSource(vec2 uv) { return displayToSource(uCropOffset + clamp(uv, 0.0, 1.0) * uCropScale); }
`;

/** Source frame → output frame (cover crop + rotation). */
export const BLIT = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 oColor;
uniform sampler2D uSrc;
${CROP}
void main() { oColor = vec4(texture(uSrc, outToSource(vUv)).rgb, 1.0); }`;

/**
 * Source frame → output-space luminance at flow resolution, area-averaged over each flow pixel's
 * footprint (four bilinear taps at ±¼ flow texel). Point sampling would alias fine detail into
 * noise that the gradient-based flow step then chases.
 */
export const LUMA = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
out float oLuma;
uniform sampler2D uSrc;
uniform vec2 uTexel; // one texel of the flow level, in output uv
${CROP}
float lum(vec2 uv) { return dot(texture(uSrc, outToSource(uv)).rgb, vec3(0.299, 0.587, 0.114)); }
void main() {
  vec2 o = 0.25 * uTexel;
  oLuma = 0.25 * (lum(vUv + vec2(-o.x, -o.y)) + lum(vUv + vec2(o.x, -o.y)) + lum(vUv + vec2(-o.x, o.y)) + lum(vUv + o));
}`;

/**
 * 2× downsample (pyramid level n → n+1) with a separable binomial [1 3 3 1]/8 filter: four bilinear
 * taps at ±0.75 texel of the finer level. A plain 2×2 box leaves one-pixel detail at every level,
 * and Lucas–Kanade's linearised step needs each level smooth relative to the motion it resolves.
 */
export const DOWN = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
out float oLuma;
uniform sampler2D uSrc;
uniform vec2 uTexel; // texel size of the SOURCE (finer) level
void main() {
  vec2 o = 0.75 * uTexel;
  oLuma = 0.25 * (texture(uSrc, vUv + vec2(-o.x, -o.y)).r + texture(uSrc, vUv + vec2(o.x, -o.y)).r +
                  texture(uSrc, vUv + vec2(-o.x, o.y)).r + texture(uSrc, vUv + o).r);
}`;

/**
 * One Lucas–Kanade iteration at one pyramid level. Flow is in pixels of this level; `uFlowScale`
 * is 2.0 on the first iteration (the flow comes from the coarser level) and 1.0 after.
 * Solves the 2×2 structure-tensor system over a 7×7 window around each pixel.
 * Output: xy = flow, z = confidence (0–1, from the window's gradient energy).
 */
export const LK = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 oFlow;
uniform sampler2D uA;
uniform sampler2D uB;
uniform sampler2D uFlow;
uniform vec2 uSize;
uniform float uFlowScale;
/** 1 inside the frame (with a one-texel margin for the central differences), else 0. */
float inFrame(vec2 uv, vec2 px) {
  vec2 lo = step(px, uv);
  vec2 hi = step(uv, 1.0 - px);
  return lo.x * lo.y * hi.x * hi.y;
}
void main() {
  vec2 px = 1.0 / uSize;
  vec2 w = texture(uFlow, vUv).xy * uFlowScale;
  float gxx = 0.0, gxy = 0.0, gyy = 0.0, bx = 0.0, by = 0.0;
  for (int j = -3; j <= 3; j++) {
    for (int i = -3; i <= 3; i++) {
      vec2 p = vUv + vec2(float(i), float(j)) * px;
      vec2 q = p + w * px;
      // Gaussian window (σ = 2.5 px): the estimate belongs to the centre pixel, not the window's edge.
      // Samples outside either frame (content leaving or entering at the borders) carry no
      // correspondence — clamped edge pixels would only pretend to — so they don't count.
      float g = exp(-float(i * i + j * j) / 12.5) * inFrame(p, px) * inFrame(q, px);
      float ix = 0.5 * (texture(uA, p + vec2(px.x, 0.0)).r - texture(uA, p - vec2(px.x, 0.0)).r);
      float iy = 0.5 * (texture(uA, p + vec2(0.0, px.y)).r - texture(uA, p - vec2(0.0, px.y)).r);
      float it = texture(uB, q).r - texture(uA, p).r;
      gxx += g * ix * ix; gxy += g * ix * iy; gyy += g * iy * iy;
      bx += g * ix * it; by += g * iy * it;
    }
  }
  // Tikhonov-regularised solve, (G + λI) d = -b. Where the texture is one-dimensional (stripes,
  // wall edges, curtains: the aperture problem) G is near-singular and the plain solve amplifies
  // sensor/codec noise into wild flow; regularised, it yields the normal flow (the only observable
  // component, and the right one), and ~0 in flat areas. λ is relative to the gradient energy, so
  // the bias it adds on well-textured patches is a few percent and the iterations remove it.
  float energy = gxx + gyy;
  float lambda = 2e-3 + 0.05 * energy;
  gxx += lambda;
  gyy += lambda;
  float det = gxx * gyy - gxy * gxy;
  vec2 d = -vec2(gyy * bx - gxy * by, gxx * by - gxy * bx) / det;
  oFlow = vec4(w + clamp(d, vec2(-2.0), vec2(2.0)), energy / (energy + 0.05), 1.0);
}`;

/**
 * Confidence-weighted smoothing of a flow field (5×5). Weak-texture pixels (low contrast, flat)
 * take their neighbours' motion instead of keeping a guess. Between pyramid levels it runs without
 * the range term (uRange = 0), so textured regions propagate their motion across contrast edges
 * into weak ones at coarse scale; on the final field the range term keeps motion edges sharp
 * (joint bilateral, guided by luminance).
 */
export const SMOOTH = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 oFlow;
uniform sampler2D uFlow;
uniform sampler2D uGuide;
uniform vec2 uSize;
uniform float uRange;
void main() {
  vec2 px = 1.0 / uSize;
  float g0 = texture(uGuide, vUv).r;
  vec2 acc = vec2(0.0);
  float wsum = 0.0;
  float conf = 0.0;
  float ssum = 0.0;
  for (int j = -2; j <= 2; j++) {
    for (int i = -2; i <= 2; i++) {
      vec2 p = vUv + vec2(float(i), float(j)) * px;
      vec4 f = texture(uFlow, p);
      float s = exp(-float(i * i + j * j) / 4.5);
      float g = texture(uGuide, p).r;
      float r = uRange > 0.0 ? exp(-(g - g0) * (g - g0) / uRange) : 1.0;
      float w = s * r * (f.z + 0.05);
      acc += f.xy * w;
      wsum += w;
      conf += f.z * s;
      ssum += s;
    }
  }
  oFlow = vec4(acc / max(wsum, 1e-6), conf / ssum, 1.0);
}`;

/**
 * Intermediate frame at time t from frames 0 and 1 and their flows (bidirectional backward
 * warping with flow approximation and visibility from forward–backward consistency, after
 * Jiang et al., "Super SloMo", CVPR 2018). Pixels the warp can't explain fall back to a cross-fade.
 */
export const SYNTH = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 oColor;
uniform sampler2D uSrcA;
uniform sampler2D uSrcB;
uniform sampler2D uF01;
uniform sampler2D uF10;
uniform vec2 uFlowSize;
uniform float uT;
${CROP}
void main() {
  float t = uT;
  vec2 f01 = texture(uF01, vUv).xy / uFlowSize;
  vec2 f10 = texture(uF10, vUv).xy / uFlowSize;
  vec2 ft0 = -(1.0 - t) * t * f01 + t * t * f10;
  vec2 ft1 = (1.0 - t) * (1.0 - t) * f01 - t * (1.0 - t) * f10;
  vec2 p0 = vUv + ft0;
  vec2 p1 = vUv + ft1;
  vec4 c0 = texture(uSrcA, outToSource(p0));
  vec4 c1 = texture(uSrcB, outToSource(p1));
  vec2 a01 = texture(uF01, p0).xy;
  vec2 e0 = a01 + texture(uF10, p0 + a01 / uFlowSize).xy;
  vec2 a10 = texture(uF10, p1).xy;
  vec2 e1 = a10 + texture(uF01, p1 + a10 / uFlowSize).xy;
  float v0 = exp(-0.5 * dot(e0, e0));
  float v1 = exp(-0.5 * dot(e1, e1));
  // A sample position outside a frame is out-of-frame occlusion: content that has left that frame
  // (or not yet entered it) at the borders. Only the other frame can supply it.
  float in0 = float(all(greaterThanEqual(p0, vec2(0.0))) && all(lessThanEqual(p0, vec2(1.0))));
  float in1 = float(all(greaterThanEqual(p1, vec2(0.0))) && all(lessThanEqual(p1, vec2(1.0))));
  float w0 = (1.0 - t) * v0 * in0;
  float w1 = t * v1 * in1;
  float s = w0 + w1;
  vec3 fallback = in0 > in1 ? c0.rgb : in1 > in0 ? c1.rgb : mix(c0.rgb, c1.rgb, t);
  vec3 c = s > 1e-3 ? (w0 * c0.rgb + w1 * c1.rgb) / s : fallback;
  oColor = vec4(c, 1.0);
}`;

/** Straight copy of an output-sized texture, with an optional overlay alpha-blended on top. */
export const FINAL = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 oColor;
uniform sampler2D uFrame;
uniform sampler2D uOverlay;
uniform bool uHasOverlay;
void main() {
  vec3 c = texture(uFrame, vUv).rgb;
  if (uHasOverlay) {
    vec4 o = texture(uOverlay, vUv);
    c = mix(c, o.rgb, o.a);
  }
  oColor = vec4(c, 1.0);
}`;

/** A still image (intro/outro card, QR end card) scaled to cover the output. */
export const CARD = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 oColor;
uniform sampler2D uSrc;
uniform vec2 uCropScale;
uniform vec2 uCropOffset;
void main() { oColor = vec4(texture(uSrc, uCropOffset + vUv * uCropScale).rgb, 1.0); }`;
