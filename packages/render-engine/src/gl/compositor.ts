import type { Rotation } from 'mediabunny';
import { parseHexColor, type PersonMask } from '../background-math';
import { BackgroundStage } from './background';
import { coverCrop } from './crop';
import {
  GLError,
  bindTexture,
  compile,
  deleteTarget,
  fullscreenTriangle,
  target,
  texture,
  upload,
  type Program,
  type Target,
} from './gl';
import { GradeStage, type Clock, type EffectPass, type LookPass } from './grade';
import { BLIT, CARD, DOWN, FINAL, LK, LUMA, SMOOTH, SYNTH } from './shaders';

// Five levels: coarse-to-fine reach of roughly 200 px of motion per frame at 1080p output, which
// covers a fast platform sweep; the coarsest levels are tiny, so the cost is negligible.
const LEVELS = 5;
const ITERATIONS = 3;

export { coverCrop };

export interface SourceGeometry {
  width: number;
  height: number;
  rotation: Rotation;
}

/** What goes behind the person when a background is set (CAP-10). */
export type BackgroundSetting =
  | { kind: 'color'; color: string }
  | { kind: 'blur' }
  /** A still picture, any size: scaled to cover the frame. */
  | { kind: 'image'; image: TexImageSource; width: number; height: number }
  /** A video: each frame follows through `setBackgroundFrame`. */
  | { kind: 'video' };

/**
 * The WebGL2 compositor. Draws one output frame per call into its canvas:
 *   real frame  → crop/rotate into output space
 *   blended     → optical-flow interpolation between two real frames (VID-2)
 *   card        → a still (intro/outro, QR end card) covering the frame
 * then, in this order: replaces the background (CAP-10), applies the look and effects (VID-7, VID-11),
 * and composites the event overlay (VID-4) on top.
 */
export class Compositor {
  readonly gl: WebGL2RenderingContext;
  private vao: WebGLVertexArrayObject;
  private p: Record<'blit' | 'luma' | 'down' | 'lk' | 'smooth' | 'synth' | 'final' | 'card', Program>;
  private srcA: WebGLTexture;
  private srcB: WebGLTexture;
  private overlayTex: WebGLTexture | null = null;
  /** Look and effects (VID-7, VID-11), created on first use. */
  private grade: GradeStage | null = null;
  /** Background replacement (CAP-10), alive only while a background is set. */
  private background: BackgroundStage | null = null;
  private frame: Target;
  /** The source pair whose frames and flow are currently loaded (see drawBlend). */
  private flowKey: string | null = null;
  private flow: {
    size: [number, number][];
    lumaA: Target[];
    lumaB: Target[];
    flowAB: Target[][];
    flowBA: Target[][];
    smoothAB: Target;
    smoothBA: Target;
    /** Each level's final (smoothed) estimate from the last solve, finest first. */
    levelAB: Target[];
    levelBA: Target[];
  } | null = null;

  constructor(
    readonly canvas: OffscreenCanvas,
    readonly width: number,
    readonly height: number,
  ) {
    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: false,
      // The encoder reads the canvas after we draw; keep the buffer until then.
      preserveDrawingBuffer: true,
      powerPreference: 'high-performance',
    });
    if (!gl) throw new GLError('WebGL2 is not available');
    this.gl = gl;
    this.vao = fullscreenTriangle(gl);
    this.p = {
      blit: compile(gl, BLIT),
      luma: compile(gl, LUMA),
      down: compile(gl, DOWN),
      lk: compile(gl, LK),
      smooth: compile(gl, SMOOTH),
      synth: compile(gl, SYNTH),
      final: compile(gl, FINAL),
      card: compile(gl, CARD),
    };
    this.frame = target(gl, width, height, 'rgba8');
    this.srcA = texture(gl);
    this.srcB = texture(gl);
  }

  setOverlay(image: TexImageSource | null) {
    const gl = this.gl;
    if (!image) {
      if (this.overlayTex) gl.deleteTexture(this.overlayTex);
      this.overlayTex = null;
      return;
    }
    this.overlayTex ??= texture(gl);
    upload(gl, this.overlayTex, image);
  }

  /** The event's look and effects for the guest footage (cards and the overlay are never graded). */
  setGrade(look: LookPass | null, effects: EffectPass[], seed: number) {
    if (!look && effects.length === 0 && !this.grade) return;
    this.grade ??= new GradeStage(this.gl, this.vao, this.width, this.height);
    this.grade.configure(look, effects, seed);
  }

  /**
   * Replace everything but the person with a colour, a picture, a video or a blurred copy of the frame.
   * Takes effect on the next `finish()`, once `setMask` has given it a mask; null switches it off and
   * frees its memory, after which the output is exactly what it was before a background was ever set.
   */
  setBackground(background: BackgroundSetting | null) {
    if (!background) {
      this.background?.dispose();
      this.background = null;
      return;
    }
    const stage = (this.background ??= new BackgroundStage(this.gl, this.vao, this.width, this.height));
    if (background.kind === 'color') {
      const rgb = parseHexColor(background.color);
      if (!rgb) throw new RangeError(`not a #rrggbb colour: ${background.color}`);
      stage.setBackdrop({ kind: 'color', rgb });
    } else if (background.kind === 'blur') stage.setBackdrop({ kind: 'blur' });
    else {
      stage.setBackdrop({ kind: 'image' });
      if (background.kind === 'image') stage.setBackdropImage(background.image, background.width, background.height);
    }
  }

  /** The current frame of a video background, scaled to cover the output. */
  setBackgroundFrame(frame: TexImageSource, geo: SourceGeometry) {
    this.background?.setBackdropImage(frame, geo.width, geo.height, geo.rotation);
  }

  /**
   * Where the person is in the frame just composed, as the segmenter sees it (top row first, covering the
   * whole OUTPUT frame, not the camera's). `reset` starts the temporal smoothing over: pass it for the first
   * frame of a take or after a cut.
   */
  setMask(mask: PersonMask | null, opts?: { reset?: boolean }) {
    this.background?.setMask(mask, opts);
  }

  /**
   * A small copy of the frame just composed, for the segmenter (RGBA, top row first; its long side is at
   * most `maxSide`). Null while no background is set.
   */
  readForSegmentation(maxSide: number): { data: Uint8ClampedArray; width: number; height: number } | null {
    return this.background ? this.background.readSmall(this.frame.texture, maxSide) : null;
  }

  /** Where the next frame sits in the footage and on the beat (VID-12). */
  setClock(clock: Clock) {
    this.grade?.setClock(clock);
  }

  private use(prog: Program, out: Target | null) {
    const gl = this.gl;
    gl.useProgram(prog.program);
    gl.bindFramebuffer(gl.FRAMEBUFFER, out ? out.framebuffer : null);
    gl.viewport(0, 0, out ? out.width : this.width, out ? out.height : this.height);
    gl.uniform1f(prog.uniform('uFlipY'), out ? 1 : 0);
    gl.bindVertexArray(this.vao);
  }

  private draw() {
    this.gl.drawArrays(this.gl.TRIANGLES, 0, 3);
  }

  private setCrop(prog: Program, geo: SourceGeometry) {
    const gl = this.gl;
    const c = coverCrop(geo.width, geo.height, geo.rotation, this.width, this.height);
    gl.uniform2f(prog.uniform('uCropScale'), c.scale[0], c.scale[1]);
    gl.uniform2f(prog.uniform('uCropOffset'), c.offset[0], c.offset[1]);
    gl.uniform1i(prog.uniform('uRotation'), geo.rotation);
  }

  /** Real frame → output frame. */
  drawReal(frame: TexImageSource, geo: SourceGeometry) {
    this.composeReal(frame, geo);
    this.finish();
  }

  /**
   * A real frame cropped and rotated into the working frame, without the passes that follow (background,
   * look, effects, overlay): call `finish()` to run them. Splitting the two lets a caller look at the
   * composed frame in between, which background replacement needs (it segments what is about to be shown).
   */
  composeReal(frame: TexImageSource, geo: SourceGeometry) {
    const gl = this.gl;
    upload(gl, this.srcA, frame);
    this.flowKey = null; // srcA now holds another frame
    this.use(this.p.blit, this.frame);
    bindTexture(gl, 0, this.srcA);
    gl.uniform1i(this.p.blit.uniform('uSrc'), 0);
    this.setCrop(this.p.blit, geo);
    this.draw();
  }

  /**
   * Two real frames + position → interpolated output frame (VID-2). `pairKey` identifies the source
   * pair: slow motion draws several in-betweens from one pair (3 at 0.25×, 7 at 0.125×), and the
   * uploads and the flow estimate (the expensive part) are reused for all of them.
   */
  drawBlend(a: TexImageSource, b: TexImageSource, t: number, geo: SourceGeometry, pairKey?: string) {
    this.composeBlend(a, b, t, geo, pairKey);
    this.finish();
  }

  /** `drawBlend` without the passes after the composed frame (see `composeReal`). */
  composeBlend(a: TexImageSource, b: TexImageSource, t: number, geo: SourceGeometry, pairKey?: string) {
    const gl = this.gl;
    const f = this.ensureFlow();
    if (pairKey === undefined || pairKey !== this.flowKey) {
      upload(gl, this.srcA, a);
      upload(gl, this.srcB, b);
      this.estimateFlow(geo, f);
      this.flowKey = pairKey ?? null;
    }
    this.use(this.p.synth, this.frame);
    bindTexture(gl, 0, this.srcA);
    bindTexture(gl, 1, this.srcB);
    bindTexture(gl, 2, f.smoothAB.texture);
    bindTexture(gl, 3, f.smoothBA.texture);
    gl.uniform1i(this.p.synth.uniform('uSrcA'), 0);
    gl.uniform1i(this.p.synth.uniform('uSrcB'), 1);
    gl.uniform1i(this.p.synth.uniform('uF01'), 2);
    gl.uniform1i(this.p.synth.uniform('uF10'), 3);
    gl.uniform2f(this.p.synth.uniform('uFlowSize'), f.size[0]![0], f.size[0]![1]);
    gl.uniform1f(this.p.synth.uniform('uT'), t);
    this.setCrop(this.p.synth, geo);
    this.draw();
  }

  /** A still card covering the frame (no overlay on cards). */
  drawCard(image: TexImageSource, imageWidth: number, imageHeight: number) {
    const gl = this.gl;
    upload(gl, this.srcA, image);
    this.flowKey = null;
    const c = coverCrop(imageWidth, imageHeight, 0, this.width, this.height);
    this.use(this.p.card, null);
    bindTexture(gl, 0, this.srcA);
    gl.uniform1i(this.p.card.uniform('uSrc'), 0);
    gl.uniform2f(this.p.card.uniform('uCropScale'), c.scale[0], c.scale[1]);
    gl.uniform2f(this.p.card.uniform('uCropOffset'), c.offset[0], c.offset[1]);
    this.draw();
    gl.flush();
  }

  /**
   * Background replacement, look and effects, and the overlay, on the frame composed last, into the
   * canvas (what the encoder reads).
   */
  finish() {
    const gl = this.gl;
    // The background goes first, so the look grades the whole new picture. Without a mask yet (or with
    // none set) the frame passes through untouched.
    const composed =
      (this.background && !this.background.idle ? this.background.apply(this.frame.texture) : null) ??
      this.frame.texture;
    const graded = this.grade && !this.grade.idle ? this.grade.apply(composed) : null;
    this.use(this.p.final, null);
    bindTexture(gl, 0, graded ?? composed);
    gl.uniform1i(this.p.final.uniform('uFrame'), 0);
    gl.uniform1i(this.p.final.uniform('uFrameYUp'), graded ? 1 : 0);
    gl.uniform1i(this.p.final.uniform('uHasOverlay'), this.overlayTex ? 1 : 0);
    if (this.overlayTex) {
      bindTexture(gl, 1, this.overlayTex);
      gl.uniform1i(this.p.final.uniform('uOverlay'), 1);
    }
    this.draw();
    gl.flush();
  }

  private ensureFlow() {
    if (this.flow) return this.flow;
    const gl = this.gl;
    // Flow at a quarter of the output size: plenty for 360 motion, cheap on any 2021+ GPU.
    const size: [number, number][] = [];
    let w = Math.max(64, Math.round(this.width / 4));
    let h = Math.max(64, Math.round(this.height / 4));
    for (let l = 0; l < LEVELS; l++) {
      size.push([w, h]);
      w = Math.max(8, Math.round(w / 2));
      h = Math.max(8, Math.round(h / 2));
    }
    const lumaFmt = 'r8' as const;
    const flowFmt = 'rgba16f' as const; // xy flow, z confidence
    if (!gl.getExtension('EXT_color_buffer_float') && !gl.getExtension('EXT_color_buffer_half_float'))
      throw new GLError('Float render targets are not supported');
    this.flow = {
      size,
      lumaA: size.map(([sw, sh]) => target(gl, sw, sh, lumaFmt)),
      lumaB: size.map(([sw, sh]) => target(gl, sw, sh, lumaFmt)),
      flowAB: size.map(([sw, sh]) => [target(gl, sw, sh, flowFmt), target(gl, sw, sh, flowFmt)]),
      flowBA: size.map(([sw, sh]) => [target(gl, sw, sh, flowFmt), target(gl, sw, sh, flowFmt)]),
      smoothAB: target(gl, size[0]![0], size[0]![1], flowFmt),
      smoothBA: target(gl, size[0]![0], size[0]![1], flowFmt),
      levelAB: [],
      levelBA: [],
    };
    return this.flow;
  }

  private estimateFlow(geo: SourceGeometry, f: NonNullable<Compositor['flow']>) {
    const gl = this.gl;
    // Luminance pyramids for both frames.
    for (const [src, pyr] of [
      [this.srcA, f.lumaA],
      [this.srcB, f.lumaB],
    ] as const) {
      this.use(this.p.luma, pyr[0]!);
      bindTexture(gl, 0, src);
      gl.uniform1i(this.p.luma.uniform('uSrc'), 0);
      gl.uniform2f(this.p.luma.uniform('uTexel'), 1 / pyr[0]!.width, 1 / pyr[0]!.height);
      this.setCrop(this.p.luma, geo);
      this.draw();
      for (let l = 1; l < LEVELS; l++) {
        this.use(this.p.down, pyr[l]!);
        bindTexture(gl, 0, pyr[l - 1]!.texture);
        gl.uniform1i(this.p.down.uniform('uSrc'), 0);
        gl.uniform2f(this.p.down.uniform('uTexel'), 1 / pyr[l - 1]!.width, 1 / pyr[l - 1]!.height);
        this.draw();
      }
    }
    const smooth = (src: Target, dst: Target, guide: Target, range: number) => {
      this.use(this.p.smooth, dst);
      bindTexture(gl, 0, src.texture);
      bindTexture(gl, 1, guide.texture);
      gl.uniform1i(this.p.smooth.uniform('uFlow'), 0);
      gl.uniform1i(this.p.smooth.uniform('uGuide'), 1);
      gl.uniform2f(this.p.smooth.uniform('uSize'), dst.width, dst.height);
      gl.uniform1f(this.p.smooth.uniform('uRange'), range);
      this.draw();
    };
    const solve = (lumA: Target[], lumB: Target[], flows: Target[][], finals: Target[]): Target => {
      // Coarsest level starts from zero flow.
      const zero = flows[LEVELS - 1]![1]!;
      gl.bindFramebuffer(gl.FRAMEBUFFER, zero.framebuffer);
      gl.viewport(0, 0, zero.width, zero.height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      let current: Target = zero;
      let fromCoarser = false;
      for (let l = LEVELS - 1; l >= 0; l--) {
        const [ping, pong] = flows[l]!;
        for (let it = 0; it < ITERATIONS; it++) {
          const dst = current === ping ? pong! : ping!;
          this.use(this.p.lk, dst);
          bindTexture(gl, 0, lumA[l]!.texture);
          bindTexture(gl, 1, lumB[l]!.texture);
          bindTexture(gl, 2, current.texture);
          gl.uniform1i(this.p.lk.uniform('uA'), 0);
          gl.uniform1i(this.p.lk.uniform('uB'), 1);
          gl.uniform1i(this.p.lk.uniform('uFlow'), 2);
          gl.uniform2f(this.p.lk.uniform('uSize'), lumA[l]!.width, lumA[l]!.height);
          // Flow from the coarser level is in half-size pixels: double it on the first pass.
          gl.uniform1f(this.p.lk.uniform('uFlowScale'), it === 0 && fromCoarser ? 2 : 1);
          this.draw();
          current = dst;
        }
        // Coarse levels: weak-texture areas take their neighbours' motion before it is refined below.
        if (l > 0) {
          const dst = current === ping ? pong! : ping!;
          smooth(current, dst, lumA[l]!, 0);
          current = dst;
        }
        finals[l] = current;
        fromCoarser = true;
      }
      return current;
    };
    const ab = solve(f.lumaA, f.lumaB, f.flowAB, f.levelAB);
    const ba = solve(f.lumaB, f.lumaA, f.flowBA, f.levelBA);
    // The final field keeps motion edges sharp (luminance-guided).
    smooth(ab, f.smoothAB, f.lumaA[0]!, 0.004);
    smooth(ba, f.smoothBA, f.lumaB[0]!, 0.004);
  }

  /**
   * Read back the last flow fields (A→B and B→A), top row first: the smoothed result by default, or
   * one pyramid level's final estimate (0 = finest, before the final smoothing), in pixels of that level. For tests and
   * diagnostics only: it stalls the GPU pipeline.
   */
  readFlow(level?: number): { width: number; height: number; ab: Float32Array; ba: Float32Array } | null {
    if (!this.flow) return null;
    const gl = this.gl;
    const pick = (smoothed: Target, perLevel: Target[]) =>
      level === undefined ? smoothed : perLevel[Math.min(level, LEVELS - 1)]!;
    const read = (t: Target) => {
      const rgba = new Float32Array(t.width * t.height * 4);
      gl.bindFramebuffer(gl.FRAMEBUFFER, t.framebuffer);
      gl.readPixels(0, 0, t.width, t.height, gl.RGBA, gl.FLOAT, rgba);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      const rg = new Float32Array(t.width * t.height * 2);
      for (let i = 0; i < t.width * t.height; i++) {
        rg[i * 2] = rgba[i * 4]!;
        rg[i * 2 + 1] = rgba[i * 4 + 1]!;
      }
      return rg;
    };
    const ab = pick(this.flow.smoothAB, this.flow.levelAB);
    const ba = pick(this.flow.smoothBA, this.flow.levelBA);
    return { width: ab.width, height: ab.height, ab: read(ab), ba: read(ba) };
  }

  dispose() {
    const gl = this.gl;
    deleteTarget(gl, this.frame);
    if (this.flow) {
      for (const t of [...this.flow.lumaA, ...this.flow.lumaB, ...this.flow.flowAB.flat(), ...this.flow.flowBA.flat()])
        deleteTarget(gl, t);
      deleteTarget(gl, this.flow.smoothAB);
      deleteTarget(gl, this.flow.smoothBA);
    }
    for (const t of [this.srcA, this.srcB, this.overlayTex]) if (t) gl.deleteTexture(t);
    this.grade?.dispose();
    this.background?.dispose();
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}
