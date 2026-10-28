import { UNIFORM_NAMES, type UniformName } from '../src/glsl';

/**
 * A tiny WebGL2 host for the effect shaders, for tests only: a fullscreen triangle whose vertex shader
 * provides `vUv` as the contract describes (0..1, origin bottom-left), a source texture and up to four
 * history textures, every EffectUniforms uniform, and pixel readback.
 *
 * Frames and results are RGBA8 in GL order: row 0 is the BOTTOM row (vUv.y = 0).
 */

export interface Frame {
  width: number;
  height: number;
  /** RGBA, row 0 = bottom. */
  data: Uint8Array;
}

export interface RenderParams {
  intensity: number;
  seed: number;
  time: number;
  duration: number;
  beat: number;
  pulse: number;
  color: readonly [number, number, number];
  /** 0 colour, 1 white, 2 silver, 3 gold. */
  colorMode: number;
}

export const DEFAULT_PARAMS: RenderParams = {
  intensity: 1,
  seed: 42,
  time: 1.7,
  duration: 12,
  beat: 0.2,
  pulse: 0.6,
  color: [1, 1, 1],
  colorMode: 0,
};

export interface CompiledEffect {
  program: WebGLProgram;
  locations: ReadonlyMap<UniformName, WebGLUniformLocation>;
}

const VERTEX = /* glsl */ `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const SAMPLER_UNIT = { uSrc: 0, uPrev1: 1, uPrev2: 2, uPrev3: 3, uPrev4: 4 } as const;

interface Target {
  texture: WebGLTexture;
  framebuffer: WebGLFramebuffer;
}

/** The compile log with the offending source lines next to it, so a CI failure is readable. */
function describeFailure(what: string, log: string, source: string): string {
  const lines = source.split('\n');
  const shown = new Set<number>();
  for (const m of log.matchAll(/ERROR:\s*\d+:(\d+)/g)) shown.add(Number(m[1]));
  const context = [...shown]
    .slice(0, 4)
    .map((n) => `  line ${n}: ${(lines[n - 1] ?? '').trim()}`)
    .join('\n');
  return `${what}:\n${log.trim()}${context ? `\n${context}` : ''}`;
}

export class EffectHost {
  readonly width: number;
  readonly height: number;
  /** Whether renderFloat() can run (needs EXT_color_buffer_float). */
  readonly floatTargets: boolean;
  private readonly canvas: OffscreenCanvas;
  private readonly gl: WebGL2RenderingContext;
  private readonly vao: WebGLVertexArrayObject;
  private readonly textures: WebGLTexture[] = [];
  private readonly byteTarget: Target;
  private readonly floatTarget: Target | null;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.canvas = new OffscreenCanvas(width, height);
    const gl = this.canvas.getContext('webgl2', {
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: false,
    });
    if (!gl) throw new Error('WebGL2 is not available');
    this.gl = gl;

    // One fullscreen triangle.
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    // Source plus four history slots.
    for (let i = 0; i < 5; i++) this.textures.push(this.createTexture());

    this.byteTarget = this.createTarget(gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE);
    this.floatTarget = gl.getExtension('EXT_color_buffer_float')
      ? this.createTarget(gl.RGBA32F, gl.RGBA, gl.FLOAT)
      : null;
    this.floatTargets = this.floatTarget !== null;
  }

  private createTexture(): WebGLTexture {
    const gl = this.gl;
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return texture;
  }

  private createTarget(internal: number, format: number, type: number): Target {
    const gl = this.gl;
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, this.width, this.height, 0, format, type, null);
    const framebuffer = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (status !== gl.FRAMEBUFFER_COMPLETE) throw new Error(`render target incomplete (${status})`);
    return { texture, framebuffer };
  }

  /** Compile and link a fragment shader against the host's vertex shader; throws with a readable log. */
  compile(frag: string): CompiledEffect {
    const gl = this.gl;
    const shader = (type: number, source: string, what: string) => {
      const s = gl.createShader(type);
      if (!s) throw new Error('could not create a shader');
      gl.shaderSource(s, source);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
        throw new Error(describeFailure(what, gl.getShaderInfoLog(s) ?? '', source));
      return s;
    };
    const program = gl.createProgram();
    gl.attachShader(program, shader(gl.VERTEX_SHADER, VERTEX, 'vertex shader failed to compile'));
    gl.attachShader(program, shader(gl.FRAGMENT_SHADER, frag, 'fragment shader failed to compile'));
    gl.bindAttribLocation(program, 0, 'aPos');
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS))
      throw new Error(describeFailure('program failed to link', gl.getProgramInfoLog(program) ?? '', frag));
    const locations = new Map<UniformName, WebGLUniformLocation>();
    for (const name of UNIFORM_NAMES) {
      const location = gl.getUniformLocation(program, name);
      if (location) locations.set(name, location);
    }
    return { program, locations };
  }

  private upload(index: number, frame: Frame) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.textures[index]!);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, frame.width, frame.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, frame.data);
  }

  private draw(effect: CompiledEffect, target: Target, source: Frame, params: RenderParams, history: readonly Frame[]) {
    const gl = this.gl;
    this.upload(0, source);
    // Slots beyond the supplied history repeat the current frame, as the contract says.
    for (let i = 1; i <= 4; i++) this.upload(i, history[i - 1] ?? source);
    for (let unit = 0; unit < 5; unit++) {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, this.textures[unit]!);
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
    gl.viewport(0, 0, this.width, this.height);
    gl.useProgram(effect.program);
    for (const [name, location] of effect.locations) {
      switch (name) {
        case 'uSrc':
        case 'uPrev1':
        case 'uPrev2':
        case 'uPrev3':
        case 'uPrev4':
          gl.uniform1i(location, SAMPLER_UNIT[name]);
          break;
        case 'uResolution':
          gl.uniform2f(location, this.width, this.height);
          break;
        case 'uIntensity':
          gl.uniform1f(location, params.intensity);
          break;
        case 'uSeed':
          gl.uniform1f(location, params.seed);
          break;
        case 'uTime':
          gl.uniform1f(location, params.time);
          break;
        case 'uDuration':
          gl.uniform1f(location, params.duration);
          break;
        case 'uBeat':
          gl.uniform1f(location, params.beat);
          break;
        case 'uPulse':
          gl.uniform1f(location, params.pulse);
          break;
        case 'uColor':
          gl.uniform3f(location, params.color[0], params.color[1], params.color[2]);
          break;
        case 'uColorMode':
          gl.uniform1i(location, params.colorMode);
          break;
        default: {
          const unhandled: never = name;
          throw new Error(`uniform ${String(unhandled)} is not set by the test host`);
        }
      }
    }
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  /** Render one frame and read it back as RGBA8 (row 0 = bottom). */
  render(effect: CompiledEffect, source: Frame, params: RenderParams, history: readonly Frame[] = []): Uint8Array {
    this.draw(effect, this.byteTarget, source, params, history);
    const out = new Uint8Array(this.width * this.height * 4);
    this.gl.readPixels(0, 0, this.width, this.height, this.gl.RGBA, this.gl.UNSIGNED_BYTE, out);
    return out;
  }

  /**
   * Render into a 32-bit float target and read it back unclamped: this is how NaN, Infinity and
   * runaway values show up (an 8-bit target would hide them). Null when the extension is missing.
   */
  renderFloat(
    effect: CompiledEffect,
    source: Frame,
    params: RenderParams,
    history: readonly Frame[] = [],
  ): Float32Array | null {
    if (!this.floatTarget) return null;
    this.draw(effect, this.floatTarget, source, params, history);
    const out = new Float32Array(this.width * this.height * 4);
    this.gl.readPixels(0, 0, this.width, this.height, this.gl.RGBA, this.gl.FLOAT, out);
    return out;
  }

  dispose() {
    this.gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}
