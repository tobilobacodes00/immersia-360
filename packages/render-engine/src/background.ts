import { parseHexColor, type MaskSource } from './background-math';
import { BackgroundStage } from './gl/background';
import { GLError, bindTexture, compile, fullscreenTriangle, texture, upload, VERTEX, type Program } from './gl/gl';

export { MaskThrottle, SEGMENT_SIDE, parseHexColor, type MaskSource, type PersonMask } from './background-math';

/**
 * Background replacement on the main thread (CAP-10): for photo-booth stills and the live preview. The
 * render worker has its own copy of this pipeline inside the compositor (see gl/background.ts, which both
 * share), so what a guest sees on the preview is what the render and the stills do.
 */

/** What goes behind the person. Images and videos are the page's own elements/bitmaps. */
export type LiveBackground =
  | { kind: 'color'; color: string }
  | { kind: 'blur' }
  | { kind: 'image'; image: TexImageSource; width: number; height: number }
  /** Its current frame is read on every draw. */
  | { kind: 'video'; video: HTMLVideoElement };

/** Point a stage at `bg`. A video's frames follow through `refreshBackdrop`. */
export function configureBackdrop(stage: BackgroundStage, bg: LiveBackground) {
  if (bg.kind === 'color') {
    const rgb = parseHexColor(bg.color);
    if (!rgb) throw new RangeError(`not a #rrggbb colour: ${bg.color}`);
    stage.setBackdrop({ kind: 'color', rgb });
  } else if (bg.kind === 'blur') stage.setBackdrop({ kind: 'blur' });
  else {
    stage.setBackdrop({ kind: 'image' });
    if (bg.kind === 'image') stage.setBackdropImage(bg.image, bg.width, bg.height);
  }
}

/** For a video background: bring its current frame in (nothing before the first frame has loaded). */
export function refreshBackdrop(stage: BackgroundStage, bg: LiveBackground) {
  if (bg.kind !== 'video') return;
  const v = bg.video;
  if (v.readyState >= 2 && v.videoWidth > 0) stage.setBackdropImage(v, v.videoWidth, v.videoHeight);
}

export { BackgroundStage };

const SHOW = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 oColor;
uniform sampler2D uSrc;
void main() { oColor = vec4(texture(uSrc, vUv).rgb, 1.0); }`;

interface Surface {
  width: number;
  height: number;
  canvas: OffscreenCanvas;
  gl: WebGL2RenderingContext;
  vao: WebGLVertexArrayObject;
  source: WebGLTexture;
  show: Program;
  stage: BackgroundStage;
}

/**
 * Replaces the background of still images (photo booth, PHO-1; clip frames, PHO-2). One person-finding pass
 * per image, then the same edge-aware compositing as video. Create one per booth and `dispose` it with the
 * booth; it keeps a WebGL context and the segmenter between calls.
 */
export class StillBackground {
  private surface: Surface | null = null;
  private masker: Promise<MaskSource> | null = null;

  /** `open` is called once, on the first image, to start the segmenter; it is closed by `dispose`. */
  constructor(private readonly open: () => Promise<MaskSource>) {}

  /**
   * `image` with everything but the person replaced by `bg`, as a new bitmap of the same size. The
   * caller keeps `image`. `reset: false` carries the mask smoothing over from the previous call, for
   * consecutive frames of one clip; it defaults to a fresh start (a new photo).
   */
  async replace(image: ImageBitmap, bg: LiveBackground, opts: { reset?: boolean } = {}): Promise<ImageBitmap> {
    const masker = await this.segmenter();
    const mask = await masker.mask(image, performance.now());
    const s = this.ensure(image.width, image.height);
    const gl = s.gl;
    upload(gl, s.source, image);
    configureBackdrop(s.stage, bg);
    refreshBackdrop(s.stage, bg);
    s.stage.setMask(mask, { reset: opts.reset ?? true });
    const result = s.stage.apply(s.source) ?? s.source;
    gl.useProgram(s.show.program);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, s.width, s.height);
    gl.uniform1f(s.show.uniform('uFlipY'), 0);
    gl.bindVertexArray(s.vao);
    bindTexture(gl, 0, result);
    gl.uniform1i(s.show.uniform('uSrc'), 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    return s.canvas.transferToImageBitmap();
  }

  dispose() {
    this.disposeSurface();
    const closing = this.masker;
    this.masker = null;
    void closing?.then((m) => m.close()).catch(() => undefined);
  }

  private segmenter(): Promise<MaskSource> {
    this.masker ??= this.open().catch((err: unknown) => {
      this.masker = null; // try again on the next image
      throw err;
    });
    return this.masker;
  }

  private ensure(width: number, height: number): Surface {
    if (this.surface && this.surface.width === width && this.surface.height === height) return this.surface;
    this.disposeSurface();
    const canvas = new OffscreenCanvas(width, height);
    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: false,
    });
    if (!gl) throw new GLError('WebGL2 is not available');
    const vao = fullscreenTriangle(gl);
    this.surface = {
      width,
      height,
      canvas,
      gl,
      vao,
      source: texture(gl),
      show: compile(gl, SHOW, VERTEX),
      stage: new BackgroundStage(gl, vao, width, height),
    };
    return this.surface;
  }

  private disposeSurface() {
    const s = this.surface;
    this.surface = null;
    if (!s) return;
    s.stage.dispose();
    s.gl.deleteTexture(s.source);
    s.gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}
