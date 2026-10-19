import { describe, expect, it } from 'vitest';
import { COLOR_MODES, type EffectDef } from '../src/contract';
import { EFFECTS, STROBE_MAX_BPM, STROBE_PEAK_LIFT, findEffect } from '../src/effects';
import { UNIFORM_NAMES, UNIFORM_TYPES, stripComments, type UniformName } from '../src/glsl';

/** VID-7: the effects the brief names, plus at least four of our own. */
const NAMED = [
  'light-rings',
  'confetti',
  'bubbles',
  'smoke',
  'sparkle',
  'echo-trail',
  'clones',
  'aura',
  'disco',
  'glitch',
  'strobe',
  'rgb-shift',
];

/** Identifiers GLSL ES 3.00 reserves or defines as keywords; none may appear in a shader as a name. */
const RESERVED = [
  'active',
  'asm',
  'buffer',
  'cast',
  'class',
  'common',
  'double',
  'enum',
  'extern',
  'external',
  'filter',
  'fixed',
  'goto',
  'half',
  'inline',
  'input',
  'interface',
  'long',
  'namespace',
  'noinline',
  'output',
  'packed',
  'partition',
  'patch',
  'public',
  'resource',
  'sample',
  'shared',
  'short',
  'sizeof',
  'smooth',
  'static',
  'superp',
  'template',
  'this',
  'typedef',
  'union',
  'unsigned',
  'using',
  'volatile',
];

const body = (frag: string) => stripComments(frag);

/** Uniforms the shader declares, as name -> type. */
function declaredUniforms(frag: string): Map<string, string> {
  const found = new Map<string, string>();
  for (const m of body(frag).matchAll(/^\s*uniform\s+(\w+)\s+(\w+)\s*;/gm)) found.set(m[2]!, m[1]!);
  return found;
}

/** Contract uniforms the shader reads (anywhere outside its own declarations). */
function usedUniforms(frag: string): UniformName[] {
  const code = body(frag).replace(/^\s*uniform\s+.*$/gm, '');
  return UNIFORM_NAMES.filter((name) => new RegExp(`\\b${name}\\b`).test(code));
}

describe('the effect pack (VID-7)', () => {
  it('ships at least 16 effects', () => {
    expect(EFFECTS.length).toBeGreaterThanOrEqual(16);
  });

  it('has unique kebab-case ids and display names', () => {
    const ids = EFFECTS.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    for (const e of EFFECTS) expect(e.name.trim().length).toBeGreaterThan(0);
    expect(new Set(EFFECTS.map((e) => e.name)).size).toBe(EFFECTS.length);
  });

  it('includes every effect the brief names, and at least four more', () => {
    const ids = EFFECTS.map((e) => e.id);
    for (const id of NAMED) expect(ids, id).toContain(id);
    expect(ids.filter((id) => !NAMED.includes(id)).length).toBeGreaterThanOrEqual(4);
  });

  it('gives confetti the four colour modes, in contract order', () => {
    expect(findEffect('confetti')?.colorModes).toEqual([...COLOR_MODES]);
  });

  it('finds effects by id', () => {
    for (const e of EFFECTS) expect(findEffect(e.id)).toBe(e);
    expect(findEffect('no-such-effect')).toBeUndefined();
  });

  it('keeps the strobe within the photosensitivity limits it documents', () => {
    expect(STROBE_MAX_BPM / 60).toBeLessThanOrEqual(3);
    expect(STROBE_PEAK_LIFT).toBeGreaterThan(0);
    expect(STROBE_PEAK_LIFT).toBeLessThanOrEqual(0.4);
    expect(findEffect('strobe')?.frag).toContain(STROBE_PEAK_LIFT.toFixed(2));
  });
});

describe.each(EFFECTS.map((e): [string, EffectDef] => [e.id, e]))('%s', (_id, effect) => {
  const frag = effect.frag;

  it('is a GLSL ES 3.00 fragment shader that writes fragColor', () => {
    expect(frag.startsWith('#version 300 es\n')).toBe(true);
    expect(frag).toContain('precision highp float;');
    expect(frag).toMatch(/^in vec2 vUv;$/m);
    expect(frag).toMatch(/^out vec4 fragColor;$/m);
    expect(frag).not.toMatch(/#extension|#include/);
    expect(frag.length).toBeLessThan(30_000);
  });

  it('declares exactly the contract uniforms it uses, with the contract types', () => {
    const declared = declaredUniforms(frag);
    const used = usedUniforms(frag);
    expect([...declared.keys()].sort()).toEqual([...used].sort());
    for (const [name, type] of declared) expect(type, name).toBe(UNIFORM_TYPES[name as UniformName]);
  });

  it('sets history honestly: the highest uPrev sampler it reads, 0 when it reads none', () => {
    const prev = usedUniforms(frag)
      .filter((u) => /^uPrev[1-4]$/.test(u))
      .map((u) => Number(u.slice(-1)));
    expect(effect.history).toBeGreaterThanOrEqual(0);
    expect(effect.history).toBeLessThanOrEqual(4);
    expect(effect.history).toBe(prev.length ? Math.max(...prev) : 0);
    if (effect.history > 0) for (let i = 1; i <= effect.history; i++) expect(prev, `uPrev${i}`).toContain(i);
  });

  it('declares colour modes if and only if it reads uColorMode', () => {
    const readsMode = usedUniforms(frag).includes('uColorMode');
    expect(Boolean(effect.colorModes)).toBe(readsMode);
    if (effect.colorModes) {
      expect(effect.colorModes[0]).toBe('colour');
      for (const mode of effect.colorModes) expect(COLOR_MODES).toContain(mode);
      expect(usedUniforms(frag)).toContain('uColor');
    }
  });

  it('keeps time with the music (VID-12): it reads uBeat or uPulse', () => {
    const used = usedUniforms(frag);
    expect(used.includes('uBeat') || used.includes('uPulse')).toBe(true);
  });

  it('has constant loop bounds and no reserved GLSL identifiers', () => {
    const code = body(frag);
    for (const m of code.matchAll(/\bfor\s*\(([^;]*);([^;]*);([^)]*)\)/g)) {
      expect(m[1], 'loop init').toMatch(/^\s*int\s+\w+\s*=\s*-?\d+\s*$/);
      expect(m[2], 'loop bound').toMatch(/^\s*\w+\s*(<|<=|>|>=)\s*-?\d+\s*$/);
    }
    expect(code).not.toMatch(/\bwhile\s*\(/);
    const words = new Set(code.match(/[A-Za-z_]\w*/g));
    for (const word of RESERVED) expect(words.has(word), `reserved word ${word}`).toBe(false);
    expect(code).not.toMatch(/__/);
  });

  it('has a sensible default strength', () => {
    expect(effect.defaultIntensity).toBeGreaterThan(0);
    expect(effect.defaultIntensity).toBeLessThanOrEqual(1);
  });
});
