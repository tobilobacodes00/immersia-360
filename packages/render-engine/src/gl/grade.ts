import { MODE_COLORS, type ColorMode, type EffectDef } from '@immersia/effects';
import { bindTexture, compile, deleteTarget, target, type Program, type Target } from './gl';

/**
 * The look and effects stage (VID-7, VID-11, VID-12), between the composed guest footage and the
 * overlay. Effects are written for the standard GL orientation (vUv from the bottom-left, see
 * @immersia/effects' contract) while the compositor keeps images top row first, so this stage runs
 * in its own "y-up" world: the frame is flipped in once, every look and effect pass runs there, and
 * the final pass reads the result flipped back.
 */

const VERTEX_UP = /* glsl */ `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

/** Compositor frame (top row at t = 0) → y-up texture. */
const FLIP_IN = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uSrc;
void main() { fragColor = vec4(texture(uSrc, vec2(vUv.x, 1.0 - vUv.y)).rgb, 1.0); }`;

const COPY = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uSrc;
void main() { fragColor = texture(uSrc, vUv); }`;

export interface LookPass {
  frag: string;
  uniforms: Record<string, number | readonly number[]>;
}

export interface EffectPass {
  def: EffectDef;
  intensity: number;
  colorMode: ColorMode | null;
}

export interface Clock {
  /** Seconds since the start of the guest's footage. */
  time: number;
  duration: number;
  beat: number;
  pulse: number;
}

const MODE_INDEX: Record<ColorMode, number> = { colour: 0, white: 1, silver: 2, gold: 3 };
/** Previous frames effects may read (contract: up to 4), plus the current one. */
const RING = 5;

export class GradeStage {
  private readonly vao: WebGLVertexArrayObject;
  private readonly programs = new Map<string, Program>();
  private ping: Target;
  private pong: Target;
  private ring: Target[] = [];
  /** Frames written to the ring so far (the newest is at (written − 1) % RING). */
  private written = 0;
  private look: LookPass | null = null;
  private effects: EffectPass[] = [];
  private clock: Clock = { time: 0, duration: 1, beat: 0, pulse: 0 };
  private seed = 0;

  constructor(
    private readonly gl: WebGL2RenderingContext,
    vao: WebGLVertexArrayObject,
    private readonly width: number,
    private readonly height: number,
  ) {
    this.vao = vao;
    this.ping = target(gl, width, height, 'rgba8');
    this.pong = target(gl, width, height, 'rgba8');
  }

  /** Nothing to do: the compositor composites its frame directly, as before this stage existed. */
  get idle() {
    return !this.look && this.effects.length === 0;
  }

  configure(look: LookPass | null, effects: EffectPass[], seed: number) {
    this.look = look;
    this.effects = effects.filter((e) => e.intensity > 0);
    this.seed = seed;
    // Compile up front: a shader error surfaces before the first frame, not in the middle of a render.
    if (look) this.program(`look`, look.frag);
    for (const e of this.effects) this.program(`fx:${e.def.id}`, e.def.frag);
    const needsHistory = this.effects.some((e) => e.def.history > 0);
    if (needsHistory && this.ring.length === 0)
      for (let i = 0; i < RING; i++) this.ring.push(target(this.gl, this.width, this.height, 'rgba8'));
    this.written = 0;
  }

  setClock(clock: Clock) {
    this.clock = clock;
  }

  /** History frames start over (a new take, or after an intro card). */
  resetHistory() {
    this.written = 0;
  }

  private program(key: string, frag: string): Program {
    let p = this.programs.get(key);
    if (!p) {
      p = compile(this.gl, frag, VERTEX_UP);
      this.programs.set(key, p);
    }
    return p;
  }

  private pass(prog: Program, out: Target) {
    const gl = this.gl;
    gl.useProgram(prog.program);
    gl.bindFramebuffer(gl.FRAMEBUFFER, out.framebuffer);
    gl.viewport(0, 0, out.width, out.height);
    gl.bindVertexArray(this.vao);
  }

  private draw() {
    this.gl.drawArrays(this.gl.TRIANGLES, 0, 3);
  }

  private set(prog: Program, name: string, value: number | readonly number[]) {
    const gl = this.gl;
    const loc = prog.uniform(name);
    if (!loc) return; // declared but unused (optimised out), or not declared at all
    if (typeof value === 'number') gl.uniform1f(loc, value);
    else if (value.length === 2) gl.uniform2f(loc, value[0]!, value[1]!);
    else if (value.length === 3) gl.uniform3f(loc, value[0]!, value[1]!, value[2]!);
    else if (value.length === 4) gl.uniform4f(loc, value[0]!, value[1]!, value[2]!, value[3]!);
  }

  /**
   * Run the look and effects on `frame` (a compositor-oriented texture). Returns the y-up texture
   * holding the result, for the final pass to read flipped.
   */
  apply(frame: WebGLTexture): WebGLTexture {
    const gl = this.gl;
    let src = this.ping;
    let dst = this.pong;
    const swap = () => {
      [src, dst] = [dst, src];
    };

    const flip = this.program('flip', FLIP_IN);
    this.pass(flip, src);
    bindTexture(gl, 0, frame);
    gl.uniform1i(flip.uniform('uSrc'), 0);
    this.draw();

    if (this.look) {
      const p = this.program('look', this.look.frag);
      this.pass(p, dst);
      bindTexture(gl, 0, src.texture);
      gl.uniform1i(p.uniform('uSrc'), 0);
      this.set(p, 'uResolution', [this.width, this.height]);
      this.set(p, 'uSeed', this.seed);
      this.set(p, 'uTime', this.clock.time);
      for (const [name, value] of Object.entries(this.look.uniforms)) this.set(p, name, value);
      this.draw();
      swap();
    }

    // The graded frame joins the history ring before effects run; effects read the frames before it.
    const history = this.ring.length > 0;
    if (history) {
      const copy = this.program('copy', COPY);
      this.pass(copy, this.ring[this.written % RING]!);
      bindTexture(gl, 0, src.texture);
      gl.uniform1i(copy.uniform('uSrc'), 0);
      this.draw();
      this.written++;
    }

    for (const e of this.effects) {
      const p = this.program(`fx:${e.def.id}`, e.def.frag);
      this.pass(p, dst);
      bindTexture(gl, 0, src.texture);
      gl.uniform1i(p.uniform('uSrc'), 0);
      for (let k = 1; k <= 4; k++) {
        // uPrevK = k frames back; slots not written yet repeat the current frame (contract).
        const back = this.written - 1 - k;
        const tex = history && back >= 0 ? this.ring[back % RING]!.texture : src.texture;
        bindTexture(gl, k, tex);
        const loc = p.uniform(`uPrev${k}`);
        if (loc) gl.uniform1i(loc, k);
      }
      this.set(p, 'uResolution', [this.width, this.height]);
      this.set(p, 'uIntensity', e.intensity);
      this.set(p, 'uSeed', this.seed);
      this.set(p, 'uTime', this.clock.time);
      this.set(p, 'uDuration', this.clock.duration);
      this.set(p, 'uBeat', this.clock.beat);
      this.set(p, 'uPulse', this.clock.pulse);
      const mode = e.colorMode ?? 'colour';
      this.set(p, 'uColor', mode === 'colour' ? [1, 1, 1] : MODE_COLORS[mode]);
      const modeLoc = p.uniform('uColorMode');
      if (modeLoc) gl.uniform1i(modeLoc, MODE_INDEX[mode]);
      this.draw();
      swap();
    }
    return src.texture;
  }

  dispose() {
    for (const t of [this.ping, this.pong, ...this.ring]) deleteTarget(this.gl, t);
    for (const p of this.programs.values()) this.gl.deleteProgram(p.program);
  }
}
