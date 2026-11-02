import type { LookDef, PhotoEffectDef } from './contract';
import { LOOK_FRAG, lookUniforms } from './looks';

/**
 * The stills runner: applies a photo effect and/or a colour look to ONE image and hands back a canvas.
 * The photo booth, the studio previews and the live camera preview (CAP-9) all use it, so a look
 * shows the same colours everywhere. It is the "host" of the effects contract: it owns the WebGL2
 * context, compiles the shaders, and provides the fullscreen triangle and `vUv`.
 *
 *   source ──prep──▶ [effect] ──▶ [look] ──▶ canvas
 *
 * `prep` is one tiny pass that turns the source into the contract's frame: a centre cover-crop to the
 * output aspect, the optional selfie mirror, and the vertical flip (an uploaded image has its top row
 * first; the contract's `vUv` has its origin at the bottom-left). It also makes every shader work
 * at OUTPUT resolution, whatever the source size. Downscaling by more than 1.5x goes through mipmaps.
 *
 * Sources are treated as opaque, as photos and video are: alpha is ignored and the output is always
 * opaque (an ImageBitmap of a half-transparent canvas arrives premultiplied, a canvas does not, so
 * translucent pixels are not composited consistently).
 */

/** What `render` returns: the runner's own canvas, reused (and overwritten) by the next render. */
export type StillCanvas = OffscreenCanvas | HTMLCanvasElement;

/** Anything WebGL can upload. `width`/`height` are only a hint; the real size is measured. */
export type StillSource = TexImageSource & { width?: number; height?: number };

export interface StillRenderOptions {
  /** Colour look, applied after the effect. `null`/omitted: none. */
  look?: LookDef | null;
  /** 0..1, default 1. */
  lookIntensity?: number;
  /** Photo effect, applied first. `null`/omitted: none. */
  effect?: PhotoEffectDef | null;
  /** 0..1, default the effect's `defaultIntensity`. */
  effectIntensity?: number;
  /** 0..1000, default 0: the per-render seed (grain, glitch, kaleidoscope turn). */
  seed?: number;
  /** Seconds, default 0: animates the grain of looks that have any (live preview). */
  time?: number;
  /** Flip horizontally before anything else (the selfie preview). */
  mirror?: boolean;
  /** Output size in pixels. Default the source size; give one and the other follows the source aspect. */
  width?: number;
  height?: number;
}

export interface StillEncodeOptions extends StillRenderOptions {
  /** Default `image/png`. */
  type?: string;
  /** 0..1 for lossy types. */
  quality?: number;
}

/** A shader that did not compile or link; `shaderId` is the look/effect id (`look` for LOOK_FRAG). */
export class ShaderCompileError extends Error {
  constructor(
    readonly shaderId: string,
    readonly stage: 'vertex' | 'fragment' | 'link',
    readonly log: string,
  ) {
    super(`Shader "${shaderId}" failed (${stage}): ${log.trim() || 'no info log'}`);
    this.name = 'ShaderCompileError';
  }
}

const VERTEX = /* glsl */ `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

/**
 * Source frame -> contract frame. `uSrc` is the upload as-is (row 0 = the TOP of the image); `uScale`
 * is the cover-crop window (each axis 0..1, centred).
 */
const PREP_FRAG = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uSrc;
uniform vec2 uScale;
uniform float uMirror;
void main() {
  vec2 uv = vUv;
  if (uMirror > 0.5) uv.x = 1.0 - uv.x;
  uv = 0.5 + (uv - 0.5) * uScale;
  uv.y = 1.0 - uv.y;
  fragColor = vec4(texture(uSrc, uv).rgb, 1.0);
}`;

// Cache keys of the two internal programs; effects are keyed `effect:<id>`, so ids cannot collide.
const PREP_KEY = '#prep';
const LOOK_KEY = '#look';

const CONTEXT_ATTRIBUTES: WebGLContextAttributes = {
  alpha: false,
  antialias: false,
  depth: false,
  stencil: false,
  premultipliedAlpha: false,
  // toBlob/toImageBitmap and the host's drawImage read the canvas after render() returns.
  preserveDrawingBuffer: true,
  powerPreference: 'high-performance',
};

/** One uniform of a look, ready to upload without allocating: 1 to 4 floats. */
type PlanEntry = readonly [name: string, value: Float32Array];

const lookPlans = new WeakMap<LookDef, PlanEntry[]>();

/** `lookUniforms` once per look (looks are immutable), minus `uIntensity`, which the runner sets. */
function planFor(look: LookDef): PlanEntry[] {
  let plan = lookPlans.get(look);
  if (!plan) {
    plan = [];
    for (const [name, value] of Object.entries(lookUniforms(look.params, 1))) {
      if (name === 'uIntensity') continue;
      plan.push([name, Float32Array.from(typeof value === 'number' ? [value] : value)]);
    }
    lookPlans.set(look, plan);
  }
  return plan;
}

interface ProgramEntry {
  program: WebGLProgram | null;
  /** The shader text this entry was built from (an edited def with the same id recompiles). */
  frag: string;
  /** A compile failure is remembered: a broken shader is not recompiled every frame. */
  error: ShaderCompileError | null;
  locations: Map<string, WebGLUniformLocation | null>;
}

interface RenderTarget {
  texture: WebGLTexture;
  framebuffer: WebGLFramebuffer;
  width: number;
  height: number;
}

interface SourceTexture {
  texture: WebGLTexture;
  width: number;
  height: number;
  /** 1, or the full chain once a render needed mipmaps. */
  levels: number;
  mipmapFilter: boolean;
}

/** Everything that dies with the WebGL context. */
interface Gpu {
  canvas: StillCanvas;
  gl: WebGL2RenderingContext;
  vao: WebGLVertexArrayObject;
  buffer: WebGLBuffer;
  vertex: WebGLShader;
  programs: Map<string, ProgramEntry>;
  source: SourceTexture | null;
  targets: [RenderTarget | null, RenderTarget | null];
  /** Largest texture, renderbuffer and viewport side. */
  maxSize: number;
}

function createCanvasAndContext(): { canvas: StillCanvas; gl: WebGL2RenderingContext } {
  if (typeof OffscreenCanvas !== 'undefined') {
    try {
      const canvas = new OffscreenCanvas(1, 1);
      const gl = canvas.getContext('webgl2', CONTEXT_ATTRIBUTES);
      if (gl) return { canvas, gl };
    } catch {
      // Some browsers expose OffscreenCanvas without WebGL2 on it; fall through to a canvas element.
    }
  }
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2', CONTEXT_ATTRIBUTES);
    if (gl) return { canvas, gl };
  }
  throw new Error('StillRunner: WebGL2 is not available');
}

function compileShader(gl: WebGL2RenderingContext, id: string, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('StillRunner: could not create a shader (is the WebGL context lost?)');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) ?? '';
    gl.deleteShader(shader);
    throw new ShaderCompileError(id, type === gl.VERTEX_SHADER ? 'vertex' : 'fragment', log);
  }
  return shader;
}

function sourceSize(source: TexImageSource): { width: number; height: number } {
  type Measurable = Partial<
    Record<
      | 'videoWidth'
      | 'videoHeight'
      | 'displayWidth'
      | 'displayHeight'
      | 'naturalWidth'
      | 'naturalHeight'
      | 'width'
      | 'height',
      number
    >
  >;
  const m = source as Measurable;
  return {
    width: m.videoWidth ?? m.displayWidth ?? m.naturalWidth ?? m.width ?? 0,
    height: m.videoHeight ?? m.displayHeight ?? m.naturalHeight ?? m.height ?? 0,
  };
}

export class StillRunner {
  private gpu: Gpu | null = null;
  private disposed = false;

  /**
   * Render `source` with the options and return the runner's canvas (sized to the output). The same
   * canvas is reused by every call, so copy or encode it before rendering again (`toBlob` and
   * `toImageBitmap` do). If the WebGL context was lost since the last call, a fresh one is created
   * and the canvas object changes: always use the one `render` returns.
   *
   * Throws `ShaderCompileError` for a shader that does not compile (naming its id), and `RangeError`
   * for a source without size or an output/source beyond the GPU's texture limit.
   */
  render(source: StillSource, opts: StillRenderOptions = {}): StillCanvas {
    if (this.disposed) throw new Error('StillRunner: render() after dispose()');
    for (let attempt = 0; attempt < 2; attempt++) {
      const gpu = this.acquire();
      try {
        this.draw(gpu, source, opts);
      } catch (error) {
        if (!gpu.gl.isContextLost()) throw error;
        this.release(); // lost mid-render: start over on a fresh context
        continue;
      }
      if (!gpu.gl.isContextLost()) return gpu.canvas;
      this.release();
    }
    throw new Error('StillRunner: the WebGL context was lost twice while rendering');
  }

  /** Render and encode. `image/png` unless `opts.type` says otherwise. */
  async toBlob(source: StillSource, opts: StillEncodeOptions = {}): Promise<Blob> {
    const canvas = this.render(source, opts);
    const type = opts.type ?? 'image/png';
    if ('convertToBlob' in canvas) return canvas.convertToBlob({ type, quality: opts.quality });
    return new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error(`StillRunner: could not encode ${type}`))),
        type,
        opts.quality,
      );
    });
  }

  /** Render and copy the result into an ImageBitmap (independent of the runner's canvas). */
  toImageBitmap(source: StillSource, opts: StillRenderOptions = {}): Promise<ImageBitmap> {
    return createImageBitmap(this.render(source, opts));
  }

  /**
   * Compile the shaders for these looks/effects now instead of on first use (a live preview should
   * not hitch the first time the operator picks one). Throws `ShaderCompileError` like `render`.
   */
  warm(defs: Iterable<LookDef | PhotoEffectDef | null | undefined>): void {
    if (this.disposed) throw new Error('StillRunner: warm() after dispose()');
    const gpu = this.acquire();
    this.program(gpu, PREP_KEY, 'prep', PREP_FRAG);
    for (const def of defs) {
      if (!def) continue;
      if ('frag' in def) this.program(gpu, `effect:${def.id}`, def.id, def.frag);
      else this.program(gpu, LOOK_KEY, 'look', LOOK_FRAG);
    }
  }

  /** Free the GPU resources and the context. The runner cannot be used afterwards. */
  dispose(): void {
    this.disposed = true;
    this.release();
  }

  // ---------------------------------------------------------------------------------------------

  private acquire(): Gpu {
    const current = this.gpu;
    if (current && !current.gl.isContextLost()) return current;
    if (current) this.release();
    return (this.gpu = this.create());
  }

  private create(): Gpu {
    const { canvas, gl } = createCanvasAndContext();
    const vao = gl.createVertexArray();
    const buffer = gl.createBuffer();
    if (!vao || !buffer) throw new Error('StillRunner: could not allocate WebGL buffers');
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    // One triangle covering the viewport: cheaper than a quad and seam-free.
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    const viewport = gl.getParameter(gl.MAX_VIEWPORT_DIMS) as Int32Array;
    const maxSize = Math.min(
      gl.getParameter(gl.MAX_TEXTURE_SIZE) as number,
      gl.getParameter(gl.MAX_RENDERBUFFER_SIZE) as number,
      viewport[0] ?? 4096,
      viewport[1] ?? 4096,
    );
    return {
      canvas,
      gl,
      vao,
      buffer,
      vertex: compileShader(gl, 'vertex', gl.VERTEX_SHADER, VERTEX),
      programs: new Map(),
      source: null,
      targets: [null, null],
      maxSize,
    };
  }

  /** Drop the GPU state. Safe on a lost context (every call is then a no-op). */
  private release(): void {
    const gpu = this.gpu;
    this.gpu = null;
    if (!gpu) return;
    const { gl } = gpu;
    for (const entry of gpu.programs.values()) if (entry.program) gl.deleteProgram(entry.program);
    gpu.programs.clear();
    if (gpu.source) gl.deleteTexture(gpu.source.texture);
    for (const target of gpu.targets) if (target) this.deleteTarget(gl, target);
    gl.deleteShader(gpu.vertex);
    gl.deleteBuffer(gpu.buffer);
    gl.deleteVertexArray(gpu.vao);
    if (!gl.isContextLost()) gl.getExtension('WEBGL_lose_context')?.loseContext();
    gpu.canvas.width = 1; // give the drawing buffer back
    gpu.canvas.height = 1;
  }

  private deleteTarget(gl: WebGL2RenderingContext, target: RenderTarget): void {
    gl.deleteFramebuffer(target.framebuffer);
    gl.deleteTexture(target.texture);
  }

  /** The compiled program cached under `key`; `id` names it in errors. */
  private program(gpu: Gpu, key: string, id: string, frag: string): ProgramEntry {
    let entry = gpu.programs.get(key);
    if (entry && entry.frag !== frag) {
      if (entry.program) gpu.gl.deleteProgram(entry.program);
      entry = undefined;
    }
    if (!entry) {
      entry = { program: null, frag, error: null, locations: new Map() };
      gpu.programs.set(key, entry);
      try {
        entry.program = this.link(gpu, id, frag);
      } catch (error) {
        if (error instanceof ShaderCompileError) entry.error = error;
        else throw error;
      }
    }
    if (entry.error) throw entry.error;
    return entry;
  }

  private link(gpu: Gpu, id: string, frag: string): WebGLProgram {
    const { gl } = gpu;
    const fragment = compileShader(gl, id, gl.FRAGMENT_SHADER, frag);
    const program = gl.createProgram();
    if (!program) {
      gl.deleteShader(fragment);
      throw new Error('StillRunner: could not create a program (is the WebGL context lost?)');
    }
    gl.attachShader(program, gpu.vertex);
    gl.attachShader(program, fragment);
    gl.bindAttribLocation(program, 0, 'aPos');
    gl.linkProgram(program);
    gl.deleteShader(fragment);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(program) ?? '';
      gl.deleteProgram(program);
      throw new ShaderCompileError(id, 'link', log);
    }
    return program;
  }

  private location(gpu: Gpu, entry: ProgramEntry, name: string): WebGLUniformLocation | null {
    let location = entry.locations.get(name);
    if (location === undefined) {
      location = entry.program ? gpu.gl.getUniformLocation(entry.program, name) : null;
      entry.locations.set(name, location);
    }
    return location;
  }

  private target(gpu: Gpu, index: 0 | 1, width: number, height: number): RenderTarget {
    const { gl } = gpu;
    const existing = gpu.targets[index];
    if (existing && existing.width === width && existing.height === height) return existing;
    if (existing) this.deleteTarget(gl, existing);
    gpu.targets[index] = null;
    const texture = gl.createTexture();
    const framebuffer = gl.createFramebuffer();
    if (!texture || !framebuffer) throw new Error('StillRunner: could not allocate a render target');
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, width, height);
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
      gl.deleteFramebuffer(framebuffer);
      gl.deleteTexture(texture);
      throw new Error(`StillRunner: ${width}x${height} render target incomplete (0x${status.toString(16)})`);
    }
    return (gpu.targets[index] = { texture, framebuffer, width, height });
  }

  /** Upload the source into the persistent texture (reallocated only when its size, or mip need, changes). */
  private upload(gpu: Gpu, source: TexImageSource, width: number, height: number, mipmaps: boolean): SourceTexture {
    const { gl } = gpu;
    let tex = gpu.source;
    if (tex && (tex.width !== width || tex.height !== height || (mipmaps && tex.levels === 1))) {
      gl.deleteTexture(tex.texture);
      tex = gpu.source = null;
    }
    if (!tex) {
      const texture = gl.createTexture();
      if (!texture) throw new Error('StillRunner: could not allocate the source texture');
      const levels = mipmaps ? 1 + Math.floor(Math.log2(Math.max(width, height))) : 1;
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texStorage2D(gl.TEXTURE_2D, levels, gl.RGBA8, width, height);
      tex = gpu.source = { texture, width, height, levels, mipmapFilter: false };
    }
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex.texture);
    // Row 0 = the top of the image, colours as decoded (the prep pass does the flipping, which also
    // works for ImageBitmap, where UNPACK_FLIP_Y_WEBGL is not honoured everywhere).
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, source);
    if (mipmaps) gl.generateMipmap(gl.TEXTURE_2D);
    if (tex.mipmapFilter !== mipmaps) {
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mipmaps ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
      tex.mipmapFilter = mipmaps;
    }
    return tex;
  }

  /** Bind the program, the input texture on unit 0 and the destination (null = the canvas). */
  private begin(gpu: Gpu, entry: ProgramEntry, input: WebGLTexture, output: RenderTarget | null, w: number, h: number) {
    const { gl } = gpu;
    gl.useProgram(entry.program);
    gl.bindFramebuffer(gl.FRAMEBUFFER, output ? output.framebuffer : null);
    gl.viewport(0, 0, w, h);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, input);
    gl.uniform1i(this.location(gpu, entry, 'uSrc'), 0);
  }

  private draw(gpu: Gpu, source: TexImageSource, opts: StillRenderOptions): void {
    const { gl } = gpu;
    const size = sourceSize(source);
    const sw = size.width;
    const sh = size.height;
    if (!(sw > 0 && sh > 0)) throw new RangeError(`StillRunner: the source has no size (${sw}x${sh})`);
    const requestedW = opts.width;
    const requestedH = opts.height;
    const width = Math.round(requestedW ?? (requestedH !== undefined ? (requestedH * sw) / sh : sw));
    const height = Math.round(requestedH ?? (requestedW !== undefined ? (requestedW * sh) / sw : sh));
    if (!(width >= 1 && height >= 1)) throw new RangeError(`StillRunner: bad output size ${width}x${height}`);
    if (Math.max(width, height, sw, sh) > gpu.maxSize)
      throw new RangeError(
        `StillRunner: ${width}x${height} output / ${sw}x${sh} source exceeds the GPU limit of ${gpu.maxSize}px`,
      );

    const look = opts.look ?? null;
    const effect = opts.effect ?? null;
    const seed = opts.seed ?? 0;

    // Compile first: a broken shader should fail before anything is uploaded or resized.
    const prep = this.program(gpu, PREP_KEY, 'prep', PREP_FRAG);
    const effectProgram = effect ? this.program(gpu, `effect:${effect.id}`, effect.id, effect.frag) : null;
    const lookProgram = look ? this.program(gpu, LOOK_KEY, 'look', LOOK_FRAG) : null;

    // Cover-crop window and the mip decision (texels per output pixel after cropping).
    const sourceAspect = sw / sh;
    const outputAspect = width / height;
    const scaleX = sourceAspect > outputAspect ? outputAspect / sourceAspect : 1;
    const scaleY = sourceAspect > outputAspect ? 1 : sourceAspect / outputAspect;
    const mipmaps = (sw * scaleX) / width > 1.5 || (sh * scaleY) / height > 1.5;

    if (gpu.canvas.width !== width) gpu.canvas.width = width;
    if (gpu.canvas.height !== height) gpu.canvas.height = height;
    gl.bindVertexArray(gpu.vao);
    const sourceTexture = this.upload(gpu, source, sw, sh, mipmaps);

    // prep: source -> contract frame
    const first = effect || look ? this.target(gpu, 0, width, height) : null;
    this.begin(gpu, prep, sourceTexture.texture, first, width, height);
    gl.uniform2f(this.location(gpu, prep, 'uScale'), scaleX, scaleY);
    gl.uniform1f(this.location(gpu, prep, 'uMirror'), opts.mirror ? 1 : 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // effect: first -> (second | canvas)
    let current = first;
    if (effect && effectProgram) {
      const out = look ? this.target(gpu, 1, width, height) : null;
      this.begin(gpu, effectProgram, current!.texture, out, width, height);
      gl.uniform2f(this.location(gpu, effectProgram, 'uResolution'), width, height);
      gl.uniform1f(this.location(gpu, effectProgram, 'uIntensity'), opts.effectIntensity ?? effect.defaultIntensity);
      gl.uniform1f(this.location(gpu, effectProgram, 'uSeed'), seed);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      current = out;
    }

    // look: (second | first) -> canvas
    if (look && lookProgram) {
      this.begin(gpu, lookProgram, current!.texture, null, width, height);
      gl.uniform2f(this.location(gpu, lookProgram, 'uResolution'), width, height);
      gl.uniform1f(this.location(gpu, lookProgram, 'uIntensity'), opts.lookIntensity ?? 1);
      gl.uniform1f(this.location(gpu, lookProgram, 'uSeed'), seed);
      gl.uniform1f(this.location(gpu, lookProgram, 'uTime'), opts.time ?? 0);
      const plan = planFor(look);
      for (let i = 0; i < plan.length; i++) {
        const [name, value] = plan[i]!;
        const location = this.location(gpu, lookProgram, name);
        switch (value.length) {
          case 1:
            gl.uniform1f(location, value[0]!);
            break;
          case 2:
            gl.uniform2fv(location, value);
            break;
          case 3:
            gl.uniform3fv(location, value);
            break;
          default:
            gl.uniform4fv(location, value);
        }
      }
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
  }
}
