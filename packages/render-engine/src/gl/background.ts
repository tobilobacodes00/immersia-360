import type { Rotation } from 'mediabunny';
import {
  FLAT_RANGE,
  GUIDE_SIGMA,
  GUIDE_SPATIAL_SIGMA,
  MATTE,
  TEMPORAL_BASE,
  TEMPORAL_KNEE,
  blurSigma,
  blurSize,
  featherSigma,
  gaussianLinearTaps,
  isMaskCut,
  type GaussianTaps,
  type PersonMask,
} from '../background-math';
import { coverCrop } from './crop';
import {
  VERTEX,
  bindTexture,
  compile,
  deleteTarget,
  target,
  texture,
  upload,
  type Program,
  type Target,
  type TargetFormat,
} from './gl';
import { BLIT } from './shaders';

/**
 * Background replacement (CAP-10), between the composed frame and the look/effects stage, so the look
 * grades the whole new picture.
 *
 * Orientation: the compositor keeps every image top row first, and this stage works the same way. Each
 * pass draws into a render target through the shared VERTEX shader with `uFlipY = 1`, so a texture's
 * t = 0 row is the image's top row whether it was uploaded or rendered here, and every sampler below
 * reads with plain `vUv`. (gl/grade.ts, which runs next, flips into the y-up world of the effects; this
 * stage is upstream of that flip and must not do it itself.)
 *
 * The pipeline per frame:
 *   mask (low resolution, from the segmenter)
 *     → smoothed over time (exponential, motion-aware, reset on a cut)            [setMask]
 *   frame → guide: the frame averaged down to the mask's grid
 *   guide + mask + frame → alpha: joint-bilateral upsampling to the output size. Each output pixel takes
 *     the mask from the 4×4 nearest mask texels, weighted by how close their colour is to the pixel's own,
 *     so the boundary snaps to the real edge in the picture instead of the model's blur
 *   alpha → matte (smoothstep) → feather (separable blur ~1 px)
 *   background: a colour, the cover-cropped image/video frame, or the frame blurred with the person
 *     removed (normalised convolution over the pixels that are background, so no colour bleeds in)
 *   out = mix(background, frame, alpha)
 */

const HEADER = /* glsl */ `#version 300 es
precision highp float;
precision highp sampler2D;
in vec2 vUv;
`;

/** The frame averaged to a smaller grid: 4×4 bilinear taps tile one target texel's footprint exactly. */
const GUIDE = /* glsl */ `${HEADER}
out vec4 oColor;
uniform sampler2D uFrame;
uniform vec2 uTexel; // one texel of the target, in frame uv
void main() {
  vec3 sum = vec3(0.0);
  for (int j = 0; j < 4; j++) {
    for (int i = 0; i < 4; i++) {
      vec2 o = ((vec2(float(i), float(j)) + 0.5) / 4.0 - 0.5) * uTexel;
      sum += texture(uFrame, vUv + o).rgb;
    }
  }
  oColor = vec4(sum / 16.0, 1.0);
}`;

/** New mask into the running one: exponential, but a big change is real motion and is followed at once. */
const TEMPORAL = /* glsl */ `${HEADER}
out float oMask;
uniform sampler2D uCurrent;
uniform sampler2D uPrevious;
uniform float uBase;
uniform vec2 uKnee;
uniform float uReset; // 1 = take the new mask as it is
void main() {
  float c = texture(uCurrent, vUv).r;
  float p = texture(uPrevious, vUv).r;
  float w = uBase + (1.0 - uBase) * smoothstep(uKnee.x, uKnee.y, abs(c - p));
  oMask = mix(mix(p, c, w), c, uReset);
}`;

/**
 * Joint-bilateral upsampling of the mask (Kopf et al., 2007). The pixel's mask is the weighted mean of
 * the 4×4 surrounding mask texels; a texel's weight is a Gaussian of its distance times a Gaussian of
 * how different its guide colour (the frame averaged to the mask's grid) is from this pixel's own, with
 * luminance counting most. Texels across an edge in the picture are ignored, so the mask boundary follows
 * the picture's edge. The floor on the colour term keeps a texture-less mismatch from emptying the sum.
 *
 * Away from the person's outline the mask is flat (every texel round the pixel agrees, see RANGE), the
 * answer is just the mask, and the 16 taps are skipped: that is nearly every pixel of the frame.
 */
const REFINE = /* glsl */ `${HEADER}
out float oAlpha;
uniform sampler2D uFrame;
uniform sampler2D uGuide;
uniform sampler2D uMask;
uniform sampler2D uRange;
uniform vec2 uMaskSize;
uniform float uSigmaRange;
uniform float uSigmaSpace;
uniform float uFlat;
uniform vec2 uMatte;
void main() {
  vec2 p = vUv * uMaskSize - 0.5;
  vec2 base = floor(p);
  vec2 range = texture(uRange, (base + 0.5) / uMaskSize).rg;
  if (range.g - range.r < uFlat) {
    oAlpha = smoothstep(uMatte.x, uMatte.y, texture(uMask, vUv).r);
    return;
  }
  vec3 c = texture(uFrame, vUv).rgb;
  float acc = 0.0;
  float wsum = 0.0;
  for (int j = -1; j <= 2; j++) {
    for (int i = -1; i <= 2; i++) {
      vec2 q = base + vec2(float(i), float(j));
      vec2 uvq = (q + 0.5) / uMaskSize;
      vec2 d = q - p;
      float ws = exp(-dot(d, d) / (2.0 * uSigmaSpace * uSigmaSpace));
      vec3 dc = c - texture(uGuide, uvq).rgb;
      float wr = exp(-dot(dc * dc, vec3(0.30, 0.59, 0.11)) / (uSigmaRange * uSigmaRange)) + 0.01;
      float w = ws * wr;
      acc += w * texture(uMask, uvq).r;
      wsum += w;
    }
  }
  oAlpha = smoothstep(uMatte.x, uMatte.y, acc / wsum);
}`;

/**
 * Per mask texel, the lowest and highest mask value in the 6×6 texels round it (a superset of the 4×4 the
 * upsample reads). Where they agree, the upsample has nothing to decide.
 */
const RANGE = /* glsl */ `${HEADER}
out vec4 oRange;
uniform sampler2D uMask;
uniform vec2 uMaskSize;
void main() {
  float lo = 1.0;
  float hi = 0.0;
  for (int j = -2; j <= 3; j++) {
    for (int i = -2; i <= 3; i++) {
      float v = texture(uMask, vUv + vec2(float(i), float(j)) / uMaskSize).r;
      lo = min(lo, v);
      hi = max(hi, v);
    }
  }
  oRange = vec4(lo, hi, 0.0, 1.0);
}`;

/**
 * Separable Gaussian on a single-channel target: 9 texels wide (σ up to ~2), in 5 fetches. The taps are
 * pairs between texels, which bilinear filtering averages (see gaussianLinearTaps); weights and offsets
 * are uniforms, worked out once per frame on the CPU.
 */
const BLUR1 = /* glsl */ `${HEADER}
out float oValue;
uniform sampler2D uSrc;
uniform vec2 uStep; // one texel along the blur direction, in uv
uniform vec3 uW;    // centre weight, then one weight per pair
uniform vec2 uO;    // offset of each pair, in texels
void main() {
  float v = uW.x * texture(uSrc, vUv).r;
  v += uW.y * (texture(uSrc, vUv + uStep * uO.x).r + texture(uSrc, vUv - uStep * uO.x).r);
  v += uW.z * (texture(uSrc, vUv + uStep * uO.y).r + texture(uSrc, vUv - uStep * uO.y).r);
  oValue = v;
}`;

/**
 * The frame, weighted by "this pixel is background", averaged down to the blur grid: rgb is the weighted
 * colour and a the weight, so that after blurring rgb / a is the mean of the BACKGROUND around a point and
 * the person's colours never bleed into it.
 */
const BACKDROP_DOWN = /* glsl */ `${HEADER}
out vec4 oColor;
uniform sampler2D uFrame;
uniform sampler2D uAlpha;
uniform vec2 uTexel;
void main() {
  vec3 rgb = vec3(0.0);
  float wsum = 0.0;
  for (int j = 0; j < 4; j++) {
    for (int i = 0; i < 4; i++) {
      vec2 uv = vUv + ((vec2(float(i), float(j)) + 0.5) / 4.0 - 0.5) * uTexel;
      float w = 1.0 - smoothstep(0.02, 0.35, texture(uAlpha, uv).r);
      rgb += texture(uFrame, uv).rgb * w;
      wsum += w;
    }
  }
  oColor = vec4(rgb / 16.0, wsum / 16.0);
}`;

/** The same on the four-channel backdrop: 13 texels wide (σ up to 3), in 7 fetches. */
const BLUR4 = /* glsl */ `${HEADER}
out vec4 oColor;
uniform sampler2D uSrc;
uniform vec2 uStep;
uniform vec4 uW;
uniform vec3 uO;
void main() {
  vec4 v = uW.x * texture(uSrc, vUv);
  v += uW.y * (texture(uSrc, vUv + uStep * uO.x) + texture(uSrc, vUv - uStep * uO.x));
  v += uW.z * (texture(uSrc, vUv + uStep * uO.y) + texture(uSrc, vUv - uStep * uO.y));
  v += uW.w * (texture(uSrc, vUv + uStep * uO.z) + texture(uSrc, vUv - uStep * uO.z));
  oColor = v;
}`;

const COMPOSITE = /* glsl */ `${HEADER}
out vec4 oColor;
uniform sampler2D uFrame;
uniform sampler2D uAlpha;
uniform sampler2D uBackdrop; // an image / video frame at output size, or the blurred background
uniform int uMode;           // 0 colour, 1 blurred frame, 2 image or video
uniform vec3 uColor;
void main() {
  vec3 f = texture(uFrame, vUv).rgb;
  float a = texture(uAlpha, vUv).r;
  vec3 bg = uColor;
  if (uMode == 1) {
    vec4 b = texture(uBackdrop, vUv);
    bg = b.a > 0.002 ? b.rgb / b.a : f;
  } else if (uMode == 2) {
    bg = texture(uBackdrop, vUv).rgb;
  }
  oColor = vec4(mix(bg, f, a), 1.0);
}`;

export type StageBackdrop =
  | { kind: 'color'; rgb: readonly [number, number, number] }
  | { kind: 'blur' }
  /** An image or a video frame, supplied through `setBackdropImage` and cover-cropped to the output. */
  | { kind: 'image' };

const SHADERS = {
  guide: GUIDE,
  temporal: TEMPORAL,
  range: RANGE,
  refine: REFINE,
  blur1: BLUR1,
  backdropDown: BACKDROP_DOWN,
  blur4: BLUR4,
  composite: COMPOSITE,
} as const;

/** RGBA16F where the GPU can draw to it; the precision matters for the weights that the blur divides by. */
function backdropFormat(gl: WebGL2RenderingContext): TargetFormat {
  return gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float')
    ? 'rgba16f'
    : 'rgba8';
}

interface MaskState {
  width: number;
  height: number;
  /** The segmenter's output as uploaded (R16F). */
  input: WebGLTexture;
  /** The smoothed mask, double-buffered; `current` says which one holds the latest. */
  smooth: [Target, Target];
  current: 0 | 1;
  /** The frame averaged to the mask's grid, the guide of the upsample. */
  guide: Target;
  /** Lowest and highest mask value round each texel (r, g): where equal, the upsample is skipped. */
  range: Target;
  last: PersonMask | null;
}

export class BackgroundStage {
  private readonly programs: Record<keyof typeof SHADERS, Program>;
  private readonly cover: Program;
  private readonly out: Target;
  private readonly alpha: [Target, Target];
  private backdropKind: StageBackdrop | null = null;
  /** The image/video frame, cover-cropped to the output size. */
  private backdrop: Target | null = null;
  private backdropSource: WebGLTexture | null = null;
  private blur: { down: Target; ping: Target; width: number; height: number } | null = null;
  private maskState: MaskState | null = null;
  private small: Target | null = null;

  constructor(
    private readonly gl: WebGL2RenderingContext,
    private readonly vao: WebGLVertexArrayObject,
    readonly width: number,
    readonly height: number,
  ) {
    this.programs = Object.fromEntries(
      (Object.keys(SHADERS) as (keyof typeof SHADERS)[]).map((k) => [k, compile(gl, SHADERS[k], VERTEX)]),
    ) as Record<keyof typeof SHADERS, Program>;
    this.cover = compile(gl, BLIT, VERTEX);
    this.out = target(gl, width, height, 'rgba8');
    this.alpha = [target(gl, width, height, 'r8'), target(gl, width, height, 'r8')];
  }

  /** Nothing to composite onto: the stage leaves the frame alone. */
  get idle() {
    return this.backdropKind === null || (this.backdropKind.kind === 'image' && !this.backdrop);
  }

  get hasMask() {
    return this.maskState?.last != null;
  }

  setBackdrop(kind: StageBackdrop | null) {
    this.backdropKind = kind;
    if (kind?.kind === 'blur') this.ensureBlur();
  }

  /**
   * An image or a video frame to put behind the person, scaled to cover the output (rotation is the
   * container's, for videos). Call once for an image, once per frame for a video.
   */
  setBackdropImage(source: TexImageSource, width: number, height: number, rotation: Rotation = 0) {
    const gl = this.gl;
    this.backdropSource ??= texture(gl);
    this.backdrop ??= target(gl, this.width, this.height, 'rgba8');
    upload(gl, this.backdropSource, source);
    const c = coverCrop(width, height, rotation, this.width, this.height);
    this.use(this.cover, this.backdrop);
    bindTexture(gl, 0, this.backdropSource);
    gl.uniform1i(this.cover.uniform('uSrc'), 0);
    gl.uniform2f(this.cover.uniform('uCropScale'), c.scale[0], c.scale[1]);
    gl.uniform2f(this.cover.uniform('uCropOffset'), c.offset[0], c.offset[1]);
    gl.uniform1i(this.cover.uniform('uRotation'), rotation);
    this.draw();
  }

  /**
   * The segmenter's latest mask. It is smoothed against the previous one on the GPU; `reset` (a new take, a
   * new photo) or a mask that differs wildly from the last (a cut) starts the smoothing afresh.
   */
  setMask(mask: PersonMask | null, opts: { reset?: boolean } = {}) {
    const gl = this.gl;
    if (!mask) {
      this.disposeMask();
      return;
    }
    if (mask.data.length !== mask.width * mask.height) throw new RangeError('mask data does not match its size');
    let m = this.maskState;
    const resized = !m || m.width !== mask.width || m.height !== mask.height;
    if (resized) {
      this.disposeMask();
      m = this.createMask(mask.width, mask.height);
      this.maskState = m;
    }
    const state = m!;
    gl.bindTexture(gl.TEXTURE_2D, state.input);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false); // row 0 is the top row, as segmenters return it
    if (resized) gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16F, mask.width, mask.height, 0, gl.RED, gl.FLOAT, mask.data);
    else gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, mask.width, mask.height, gl.RED, gl.FLOAT, mask.data);

    const fresh = Boolean(opts.reset) || isMaskCut(state.last, mask);
    const from = state.smooth[state.current];
    const to = state.smooth[state.current === 0 ? 1 : 0];
    const p = this.programs.temporal;
    this.use(p, to);
    bindTexture(gl, 0, state.input);
    bindTexture(gl, 1, from.texture);
    gl.uniform1i(p.uniform('uCurrent'), 0);
    gl.uniform1i(p.uniform('uPrevious'), 1);
    gl.uniform1f(p.uniform('uBase'), TEMPORAL_BASE);
    gl.uniform2f(p.uniform('uKnee'), TEMPORAL_KNEE[0], TEMPORAL_KNEE[1]);
    gl.uniform1f(p.uniform('uReset'), fresh ? 1 : 0);
    this.draw();
    state.current = state.current === 0 ? 1 : 0;
    // Where the smoothed mask is flat the upsample has nothing to decide (see REFINE).
    const range = this.programs.range;
    this.use(range, state.range);
    bindTexture(gl, 0, to.texture);
    gl.uniform1i(range.uniform('uMask'), 0);
    gl.uniform2f(range.uniform('uMaskSize'), mask.width, mask.height);
    this.draw();
    // The CPU copy only serves cut detection; the segmenter hands out a fresh array every frame.
    state.last = mask;
  }

  /**
   * `frame` (compositor orientation, output size) with the person kept and everything else replaced, or
   * null when there is nothing to do yet (no backdrop chosen, or no mask has arrived).
   */
  apply(frame: WebGLTexture): WebGLTexture | null {
    const m = this.maskState;
    const kind = this.backdropKind;
    if (!kind || !m?.last || this.idle) return null;
    const gl = this.gl;

    // The frame on the mask's grid: what each mask texel "looks like".
    this.average(frame, m.guide);

    // Output-size alpha from the mask, edge-aware, then feathered.
    const refine = this.programs.refine;
    this.use(refine, this.alpha[0]);
    bindTexture(gl, 0, frame);
    bindTexture(gl, 1, m.guide.texture);
    bindTexture(gl, 2, m.smooth[m.current].texture);
    bindTexture(gl, 3, m.range.texture);
    gl.uniform1i(refine.uniform('uFrame'), 0);
    gl.uniform1i(refine.uniform('uGuide'), 1);
    gl.uniform1i(refine.uniform('uMask'), 2);
    gl.uniform1i(refine.uniform('uRange'), 3);
    gl.uniform1f(refine.uniform('uFlat'), FLAT_RANGE);
    gl.uniform2f(refine.uniform('uMaskSize'), m.width, m.height);
    gl.uniform1f(refine.uniform('uSigmaRange'), GUIDE_SIGMA);
    gl.uniform1f(refine.uniform('uSigmaSpace'), GUIDE_SPATIAL_SIGMA);
    gl.uniform2f(refine.uniform('uMatte'), MATTE[0], MATTE[1]);
    this.draw();
    const feather = gaussianLinearTaps(featherSigma(this.height), 2);
    this.blurPass(this.programs.blur1, this.alpha[0], this.alpha[1], [1 / this.width, 0], feather);
    this.blurPass(this.programs.blur1, this.alpha[1], this.alpha[0], [0, 1 / this.height], feather);
    const alpha = this.alpha[0];

    let backdrop: Target | null = null;
    if (kind.kind === 'blur') backdrop = this.blurredBackground(frame, alpha);
    else if (kind.kind === 'image') backdrop = this.backdrop;

    const c = this.programs.composite;
    this.use(c, this.out);
    bindTexture(gl, 0, frame);
    bindTexture(gl, 1, alpha.texture);
    // A sampler must always have a texture; the colour mode never reads this one.
    bindTexture(gl, 2, (backdrop ?? alpha).texture);
    gl.uniform1i(c.uniform('uFrame'), 0);
    gl.uniform1i(c.uniform('uAlpha'), 1);
    gl.uniform1i(c.uniform('uBackdrop'), 2);
    gl.uniform1i(c.uniform('uMode'), kind.kind === 'color' ? 0 : kind.kind === 'blur' ? 1 : 2);
    const rgb = kind.kind === 'color' ? kind.rgb : [0, 0, 0];
    gl.uniform3f(c.uniform('uColor'), rgb[0]!, rgb[1]!, rgb[2]!);
    this.draw();
    return this.out.texture;
  }

  /**
   * A small copy of `frame` for the segmenter: the frame averaged to at most `maxSide` on its long side,
   * RGBA, top row first. It stalls the GPU pipeline, which is fine for a renderer that waits for its frame
   * anyway.
   */
  readSmall(
    frame: WebGLTexture,
    maxSide: number,
  ): { data: Uint8ClampedArray<ArrayBuffer>; width: number; height: number } {
    const scale = Math.min(1, maxSide / Math.max(this.width, this.height));
    const w = Math.max(1, Math.round(this.width * scale));
    const h = Math.max(1, Math.round(this.height * scale));
    const gl = this.gl;
    if (!this.small || this.small.width !== w || this.small.height !== h) {
      if (this.small) deleteTarget(gl, this.small);
      this.small = target(gl, w, h, 'rgba8');
    }
    this.average(frame, this.small);
    const data = new Uint8ClampedArray(w * h * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.small.framebuffer);
    gl.pixelStorei(gl.PACK_ALIGNMENT, 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, data);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { data, width: w, height: h };
  }

  dispose() {
    const gl = this.gl;
    this.disposeMask();
    for (const t of [this.out, ...this.alpha, this.backdrop, this.small, this.blur?.down, this.blur?.ping])
      if (t) deleteTarget(gl, t);
    if (this.backdropSource) gl.deleteTexture(this.backdropSource);
    for (const p of [...Object.values(this.programs), this.cover]) gl.deleteProgram(p.program);
  }

  // ---------------------------------------------------------------------------------------------

  private use(prog: Program, out: Target) {
    const gl = this.gl;
    gl.useProgram(prog.program);
    gl.bindFramebuffer(gl.FRAMEBUFFER, out.framebuffer);
    gl.viewport(0, 0, out.width, out.height);
    gl.uniform1f(prog.uniform('uFlipY'), 1);
    gl.bindVertexArray(this.vao);
  }

  private draw() {
    this.gl.drawArrays(this.gl.TRIANGLES, 0, 3);
  }

  /** `frame` averaged onto `into`'s grid. */
  private average(frame: WebGLTexture, into: Target) {
    const gl = this.gl;
    const p = this.programs.guide;
    this.use(p, into);
    bindTexture(gl, 0, frame);
    gl.uniform1i(p.uniform('uFrame'), 0);
    gl.uniform2f(p.uniform('uTexel'), 1 / into.width, 1 / into.height);
    this.draw();
  }

  /** One direction of a Gaussian blur, with `taps` made for this program (2 pairs for blur1, 3 for blur4). */
  private blurPass(prog: Program, src: Target, dst: Target, step: readonly [number, number], taps: GaussianTaps) {
    const gl = this.gl;
    this.use(prog, dst);
    bindTexture(gl, 0, src.texture);
    gl.uniform1i(prog.uniform('uSrc'), 0);
    gl.uniform2f(prog.uniform('uStep'), step[0], step[1]);
    const w = [taps.center, ...taps.pairs.map((p) => p.weight)];
    const o = taps.pairs.map((p) => p.offset);
    if (o.length === 2) {
      gl.uniform3f(prog.uniform('uW'), w[0]!, w[1]!, w[2]!);
      gl.uniform2f(prog.uniform('uO'), o[0]!, o[1]!);
    } else {
      gl.uniform4f(prog.uniform('uW'), w[0]!, w[1]!, w[2]!, w[3]!);
      gl.uniform3f(prog.uniform('uO'), o[0]!, o[1]!, o[2]!);
    }
    this.draw();
  }

  private ensureBlur() {
    if (this.blur) return;
    const { width, height } = blurSize(this.width, this.height);
    const fmt = backdropFormat(this.gl);
    this.blur = {
      down: target(this.gl, width, height, fmt),
      ping: target(this.gl, width, height, fmt),
      width,
      height,
    };
  }

  /** The frame blurred with the person left out, at 1/8 size (bilinear sampling gives the rest). */
  private blurredBackground(frame: WebGLTexture, alpha: Target): Target {
    this.ensureBlur();
    const b = this.blur!;
    const gl = this.gl;
    const down = this.programs.backdropDown;
    this.use(down, b.down);
    bindTexture(gl, 0, frame);
    bindTexture(gl, 1, alpha.texture);
    gl.uniform1i(down.uniform('uFrame'), 0);
    gl.uniform1i(down.uniform('uAlpha'), 1);
    gl.uniform2f(down.uniform('uTexel'), 1 / b.width, 1 / b.height);
    this.draw();
    const taps = gaussianLinearTaps(blurSigma(this.height), 3);
    this.blurPass(this.programs.blur4, b.down, b.ping, [1 / b.width, 0], taps);
    this.blurPass(this.programs.blur4, b.ping, b.down, [0, 1 / b.height], taps);
    return b.down;
  }

  private createMask(width: number, height: number): MaskState {
    const gl = this.gl;
    const input = texture(gl, gl.NEAREST);
    return {
      width,
      height,
      input,
      smooth: [target(gl, width, height, 'r8'), target(gl, width, height, 'r8')],
      current: 0,
      guide: target(gl, width, height, 'rgba8'),
      range: target(gl, width, height, 'rgba8'),
      last: null,
    };
  }

  private disposeMask() {
    const m = this.maskState;
    if (!m) return;
    this.gl.deleteTexture(m.input);
    for (const t of [...m.smooth, m.guide, m.range]) deleteTarget(this.gl, t);
    this.maskState = null;
  }
}
