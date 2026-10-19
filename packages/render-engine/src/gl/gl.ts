/** Minimal WebGL2 helpers: programs, textures, render targets and a full-screen triangle. */

export const VERTEX = /* glsl */ `#version 300 es
in vec2 aPos;
out vec2 vUv; // y-down: (0,0) is the top-left of the image
// Framebuffer textures store row 0 at the BOTTOM of the viewport, the canvas shows it at the
// bottom too. 1.0 when drawing into a texture, so vUv.y always equals the texture's t coordinate
// and every texture (uploaded or rendered) is sampled the same way, top row at t = 0.
uniform float uFlipY;
void main() {
  vUv = vec2(aPos.x * 0.5 + 0.5, mix(0.5 - aPos.y * 0.5, 0.5 + aPos.y * 0.5, uFlipY));
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

export class GLError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GLError';
  }
}

export interface Program {
  program: WebGLProgram;
  uniform: (name: string) => WebGLUniformLocation | null;
}

export function compile(gl: WebGL2RenderingContext, fragment: string, vertex = VERTEX): Program {
  const shader = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
      throw new GLError(gl.getShaderInfoLog(s) ?? 'shader compile failed');
    return s;
  };
  const program = gl.createProgram()!;
  gl.attachShader(program, shader(gl.VERTEX_SHADER, vertex));
  gl.attachShader(program, shader(gl.FRAGMENT_SHADER, fragment));
  gl.bindAttribLocation(program, 0, 'aPos');
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS))
    throw new GLError(gl.getProgramInfoLog(program) ?? 'link failed');
  const cache = new Map<string, WebGLUniformLocation | null>();
  return {
    program,
    uniform: (name) => {
      if (!cache.has(name)) cache.set(name, gl.getUniformLocation(program, name));
      return cache.get(name)!;
    },
  };
}

/** One triangle covering the viewport (cheaper and seam-free compared with a quad). */
export function fullscreenTriangle(gl: WebGL2RenderingContext): WebGLVertexArrayObject {
  const vao = gl.createVertexArray()!;
  gl.bindVertexArray(vao);
  const buf = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  return vao;
}

export interface Target {
  texture: WebGLTexture;
  framebuffer: WebGLFramebuffer;
  width: number;
  height: number;
}

export type TargetFormat = 'rgba8' | 'r8' | 'rg16f' | 'rgba16f' | 'r16f';

function formatOf(gl: WebGL2RenderingContext, fmt: TargetFormat): [internal: number, format: number, type: number] {
  switch (fmt) {
    case 'rgba8':
      return [gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE];
    case 'r8':
      return [gl.R8, gl.RED, gl.UNSIGNED_BYTE];
    case 'rg16f':
      return [gl.RG16F, gl.RG, gl.HALF_FLOAT];
    case 'rgba16f':
      return [gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT];
    case 'r16f':
      return [gl.R16F, gl.RED, gl.HALF_FLOAT];
  }
}

export function texture(gl: WebGL2RenderingContext, filter: number = gl.LINEAR): WebGLTexture {
  const t = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}

export function target(gl: WebGL2RenderingContext, width: number, height: number, fmt: TargetFormat): Target {
  const tex = texture(gl);
  const [internal, format, type] = formatOf(gl, fmt);
  gl.texImage2D(gl.TEXTURE_2D, 0, internal, width, height, 0, format, type, null);
  const fb = gl.createFramebuffer()!;
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  if (status !== gl.FRAMEBUFFER_COMPLETE)
    throw new GLError(`render target ${fmt} ${width}×${height} incomplete (${status})`);
  return { texture: tex, framebuffer: fb, width, height };
}

export function bindTexture(gl: WebGL2RenderingContext, unit: number, tex: WebGLTexture) {
  gl.activeTexture(gl.TEXTURE0 + unit);
  gl.bindTexture(gl.TEXTURE_2D, tex);
}

/** Upload a decoded frame or bitmap into a texture (y-down, no premultiplication). */
export function upload(gl: WebGL2RenderingContext, tex: WebGLTexture, source: TexImageSource) {
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, source);
}

export function deleteTarget(gl: WebGL2RenderingContext, t: Target) {
  gl.deleteFramebuffer(t.framebuffer);
  gl.deleteTexture(t.texture);
}
