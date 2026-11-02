import { describe, expect, it } from 'vitest';
import { buildFragment, defineEffect, stripComments, withoutFinalClamp } from '../src/glsl';

const SIMPLE = 'vec3 effect(vec2 p, vec3 src) { return src; }';

describe('stripComments', () => {
  it('removes line and block comments', () => {
    expect(stripComments('a // uTime\nb /* uBeat\n uPulse */ c')).not.toMatch(/u[A-Z]/);
    expect(stripComments('a // x\nb')).toContain('b');
  });
});

describe('buildFragment', () => {
  it('always declares what the wrapper reads, and only that for a trivial effect', () => {
    const { frag, uniforms, history } = buildFragment({ code: SIMPLE, blend: 'mix' });
    expect(uniforms).toEqual(['uSrc', 'uResolution', 'uIntensity']);
    expect(history).toBe(0);
    expect(frag.startsWith('#version 300 es\n')).toBe(true);
    expect(frag).toContain('uniform sampler2D uSrc;');
    expect(frag).toContain('uniform vec2 uResolution;');
    expect(frag).toContain('uniform float uIntensity;');
    expect(frag).not.toContain('uniform float uTime;');
  });

  it('ignores uniform names that only appear in comments', () => {
    const { uniforms } = buildFragment({ code: `// uses uTime later\n/* uPulse */\n${SIMPLE}`, blend: 'mix' });
    expect(uniforms).not.toContain('uTime');
    expect(uniforms).not.toContain('uPulse');
  });

  it('does not confuse uColor with uColorMode', () => {
    const { uniforms } = buildFragment({
      code: 'vec3 effect(vec2 p, vec3 src) { return src * float(uColorMode); }',
      blend: 'mix',
    });
    expect(uniforms).toContain('uColorMode');
    expect(uniforms).not.toContain('uColor');
  });

  it('derives history from the highest uPrev sampler read', () => {
    const code = 'vec3 effect(vec2 p, vec3 src) { return texture(uPrev2, vUv).rgb; }';
    const built = buildFragment({ code, blend: 'mix' });
    expect(built.history).toBe(2);
    expect(built.uniforms).toContain('uPrev2');
    expect(built.uniforms).not.toContain('uPrev1');
  });

  it('inlines helpers once, dependencies first', () => {
    const { frag } = buildFragment({ code: SIMPLE, blend: 'mix', helpers: ['color', 'noise', 'hash'] });
    expect(frag.match(/const float TAU/g)).toHaveLength(1);
    expect(frag.match(/uint hmix\(/g)).toHaveLength(1);
    expect(frag.indexOf('float TAU')).toBeLessThan(frag.indexOf('vec3 festive'));
    expect(frag.indexOf('uint hmix(')).toBeLessThan(frag.indexOf('float vnoise('));
  });

  it('keeps the shared helpers pure: none reads a contract uniform', () => {
    const { uniforms } = buildFragment({ code: SIMPLE, blend: 'mix', helpers: ['geom', 'hash', 'noise', 'color'] });
    expect(uniforms).toEqual(['uSrc', 'uResolution', 'uIntensity']);
  });

  it("blends by uIntensity in 'mix' mode and leaves it to the effect in 'self' mode", () => {
    expect(buildFragment({ code: SIMPLE, blend: 'mix' }).frag).toContain('mix(src, fx, uIntensity)');
    const self = buildFragment({ code: SIMPLE, blend: 'self' });
    expect(self.frag).toContain('vec3 outColor = fx;');
    expect(self.uniforms).not.toContain('uIntensity');
  });
});

describe('withoutFinalClamp', () => {
  it('removes the final clamp from built shaders only', () => {
    const { frag } = buildFragment({ code: SIMPLE, blend: 'mix' });
    expect(frag).toContain('clamp(outColor, 0.0, 1.0)');
    expect(withoutFinalClamp(frag)).not.toContain('clamp(outColor');
    expect(() => withoutFinalClamp('void main() {}')).toThrow();
  });
});

describe('defineEffect', () => {
  const meta = { id: 'x', name: 'X', defaultIntensity: 1 };

  it('rejects colour modes on a shader that ignores uColorMode, and the reverse', () => {
    expect(() => defineEffect({ ...meta, colorModes: ['colour'] }, { code: SIMPLE, blend: 'mix' })).toThrow(
      /colorModes/,
    );
    const modal = 'vec3 effect(vec2 p, vec3 src) { return uColorMode == 0 ? src : uColor; }';
    expect(() => defineEffect(meta, { code: modal, blend: 'mix' })).toThrow(/colorModes/);
    expect(defineEffect({ ...meta, colorModes: ['colour', 'gold'] }, { code: modal, blend: 'mix' }).colorModes).toEqual(
      ['colour', 'gold'],
    );
  });

  it('carries the derived history into the definition', () => {
    const code = 'vec3 effect(vec2 p, vec3 src) { return texture(uPrev3, vUv).rgb; }';
    expect(defineEffect(meta, { code, blend: 'mix' }).history).toBe(3);
    expect(defineEffect(meta, { code: SIMPLE, blend: 'mix' }).history).toBe(0);
  });
});
