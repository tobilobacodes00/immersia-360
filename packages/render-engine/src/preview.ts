import { LOOK_FRAG, findEffect, findLook, lookUniforms, type ColorMode } from '@immersia/effects';
import type { PersonMask } from './background-math';
import { configureBackdrop, refreshBackdrop, type LiveBackground } from './background';
import { BackgroundStage } from './gl/background';
import { compile, fullscreenTriangle, texture, upload, type Program } from './gl/gl';
import { GradeStage, type Clock } from './gl/grade';

/**
 * Looks and effects on a visible canvas, through the SAME stage the render worker uses (gl/grade.ts):
 * studio previews (screen 5) and the booth's live camera preview (CAP-9) show exactly what renders. A
 * background (CAP-10) goes behind the person first, through the same gl/background.ts stage, given the
 * person mask by whoever runs the segmenter (`setMask`).
 */

const VERTEX_UP = /* glsl */ `#version 300 es
in vec2 aPos;
out vec2 vUv;
uniform bool uMirror;
void main() {
  vUv = aPos * 0.5 + 0.5;
  if (uMirror) vUv.x = 1.0 - vUv.x;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

/** Shows a y-up texture (the stage's output) on the canvas. */
const PRESENT = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uSrc;
void main() { fragColor = vec4(texture(uSrc, vUv).rgb, 1.0); }`;

/** A source frame (top row first, as uploaded) shown as is: no look, no effects. */
const PRESENT_RAW = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uSrc;
void main() { fragColor = vec4(texture(uSrc, vec2(vUv.x, 1.0 - vUv.y)).rgb, 1.0); }`;

export interface PreviewSettings {
  look: { id: string; intensity: number } | null;
  effects: { id: string; intensity: number; colorMode: ColorMode | null }[];
  seed?: number;
  /** Selfie mirror for the live camera preview (CAP-9). */
  mirror?: boolean;
  /** CAP-10: replaces everything but the person; needs masks (`setMask`) to take effect. */
  background?: LiveBackground | null;
}

export class GradePreview {
  private readonly gl: WebGL2RenderingContext;
  private readonly vao: WebGLVertexArrayObject;
  private readonly source: WebGLTexture;
  private readonly present: Program;
  private readonly presentRaw: Program;
  private stage: GradeStage | null = null;
  private backgroundStage: BackgroundStage | null = null;
  private background: LiveBackground | null = null;
  private mirror = false;
  private active = false;

  constructor(
    readonly canvas: HTMLCanvasElement | OffscreenCanvas,
    readonly width: number,
    readonly height: number,
  ) {
    canvas.width = width;
    canvas.height = height;
    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      premultipliedAlpha: false,
    }) as WebGL2RenderingContext | null;
    if (!gl) throw new Error('WebGL2 is not available');
    this.gl = gl;
    this.vao = fullscreenTriangle(gl);
    this.source = texture(gl);
    this.present = compile(gl, PRESENT, VERTEX_UP);
    this.presentRaw = compile(gl, PRESENT_RAW, VERTEX_UP);
  }

  configure(s: PreviewSettings) {
    this.setBackground(s.background ?? null);
    const look = s.look ? findLook(s.look.id) : null;
    const effects = s.effects.flatMap((e) => {
      const def = findEffect(e.id);
      return def ? [{ def, intensity: e.intensity, colorMode: e.colorMode }] : [];
    });
    this.mirror = Boolean(s.mirror);
    this.active = Boolean((look && look.id !== 'none') || effects.length);
    if (!this.active) return;
    this.stage ??= new GradeStage(this.gl, this.vao, this.width, this.height);
    this.stage.configure(
      look && look.id !== 'none' ? { frag: LOOK_FRAG, uniforms: lookUniforms(look.params, s.look!.intensity) } : null,
      effects,
      s.seed ?? 0,
    );
  }

  /** CAP-10: what replaces the background, or null for none (which also frees the stage). */
  setBackground(background: LiveBackground | null) {
    this.background = background;
    if (!background) {
      this.backgroundStage?.dispose();
      this.backgroundStage = null;
      return;
    }
    this.backgroundStage ??= new BackgroundStage(this.gl, this.vao, this.width, this.height);
    configureBackdrop(this.backgroundStage, background);
  }

  /** True when a background is set, so frames should be segmented and handed to `setMask`. */
  get needsMask() {
    return this.background !== null;
  }

  /** The person mask of a recent frame (it is smoothed against the last one and reused until the next). */
  setMask(mask: PersonMask | null, opts?: { reset?: boolean }) {
    this.backgroundStage?.setMask(mask, opts);
  }

  /** Draw one frame of `image` (a still, or the camera's current video frame). */
  draw(image: TexImageSource, clock: Clock = { time: 0, duration: 1, beat: 0, pulse: 0 }) {
    const gl = this.gl;
    upload(gl, this.source, image);
    let tex = this.source;
    if (this.backgroundStage && this.background) {
      refreshBackdrop(this.backgroundStage, this.background);
      tex = this.backgroundStage.apply(tex) ?? tex;
    }
    let prog = this.presentRaw;
    if (this.active && this.stage) {
      this.stage.setClock(clock);
      tex = this.stage.apply(this.source);
      prog = this.present;
    }
    gl.useProgram(prog.program);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.width, this.height);
    gl.bindVertexArray(this.vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(prog.uniform('uSrc'), 0);
    gl.uniform1i(prog.uniform('uMirror'), this.mirror ? 1 : 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  dispose() {
    this.stage?.dispose();
    this.backgroundStage?.dispose();
    this.gl.deleteTexture(this.source);
    this.gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}
