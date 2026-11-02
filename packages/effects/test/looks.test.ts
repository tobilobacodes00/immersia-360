import { describe, expect, it } from 'vitest';
import {
  LOOKS,
  LOOK_FRAG,
  PHOTO_EFFECTS,
  findLook,
  findPhotoEffect,
  lookUniforms,
  type LookParams,
  type PhotoEffectDef,
} from '../src/index';

const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** The uniforms every shader may use, with the GLSL type the contract gives them. */
const COMMON: Record<string, string> = {
  uSrc: 'sampler2D',
  uResolution: 'vec2',
  uIntensity: 'float',
  uSeed: 'float',
  uTime: 'float',
};

/** The declared uniforms of a shader: name -> type. */
function declaredUniforms(frag: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const m of frag.matchAll(/^\s*uniform\s+(?:(?:lowp|mediump|highp)\s+)?(\w+)\s+(\w+)\s*;/gm))
    map.set(m[2]!, m[1]!);
  return map;
}

function inRange(value: number, min: number, max: number) {
  return Number.isFinite(value) && value >= min && value <= max;
}

function rgbInRange(v: readonly number[], min: number, max: number) {
  return v.length === 3 && v.every((x) => inRange(x, min, max));
}

describe('looks', () => {
  it('has none first and at least 20 entries (19 looks besides the identity)', () => {
    expect(LOOKS[0]?.id).toBe('none');
    expect(LOOKS.length).toBeGreaterThanOrEqual(20);
  });

  it('has unique kebab-case ids and unique non-empty names', () => {
    const ids = LOOKS.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id, id).toMatch(KEBAB);
    const names = LOOKS.map((l) => l.name);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) expect(name.trim().length).toBeGreaterThan(0);
  });

  it('includes the looks the requirement names', () => {
    for (const id of ['mono', 'noir', 'sepia', 'vivid', 'cinematic', 'film', 'golden-hour'])
      expect(findLook(id), id).toBeDefined();
    const duotones = LOOKS.filter((l) => l.params.duotone >= 0.8);
    expect(duotones.length).toBeGreaterThanOrEqual(2);
  });

  it.each(LOOKS.map((l): [string, LookParams] => [l.id, l.params]))(
    '%s keeps every parameter inside its documented range',
    (id, p: LookParams) => {
      expect(inRange(p.exposure, -1, 1), 'exposure').toBe(true);
      expect(inRange(p.contrast, 0, 2), 'contrast').toBe(true);
      expect(inRange(p.saturation, 0, 2), 'saturation').toBe(true);
      expect(inRange(p.temperature, -1, 1), 'temperature').toBe(true);
      expect(inRange(p.tint, -1, 1), 'tint').toBe(true);
      expect(rgbInRange(p.lift, -0.2, 0.2), 'lift').toBe(true);
      expect(rgbInRange(p.gamma, 0.5, 2), 'gamma').toBe(true);
      expect(rgbInRange(p.gain, 0.5, 1.5), 'gain').toBe(true);
      expect(rgbInRange(p.shadows, 0, 1), 'shadows').toBe(true);
      expect(rgbInRange(p.highlights, 0, 1), 'highlights').toBe(true);
      expect(inRange(p.split, 0, 1), 'split').toBe(true);
      expect(inRange(p.fade, 0, 0.3), 'fade').toBe(true);
      expect(inRange(p.vignette, 0, 1), 'vignette').toBe(true);
      expect(inRange(p.grain, 0, 0.2), 'grain').toBe(true);
      expect(inRange(p.duotone, 0, 1), 'duotone').toBe(true);
      expect(rgbInRange(p.dark, 0, 1), 'dark').toBe(true);
      expect(rgbInRange(p.light, 0, 1), 'light').toBe(true);
      expect(id).toBeTruthy();
    },
  );

  it('has no two looks with the same parameters', () => {
    const seen = new Map<string, string>();
    for (const l of LOOKS) {
      const key = JSON.stringify(l.params);
      expect(seen.get(key), `${l.id} duplicates ${seen.get(key)}`).toBeUndefined();
      seen.set(key, l.id);
    }
  });

  it('makes `none` the neutral grade and the monochrome looks fully desaturated and untinted', () => {
    const none = findLook('none')!.params;
    expect(none).toMatchObject({ exposure: 0, contrast: 1, saturation: 1, temperature: 0, tint: 0, split: 0, fade: 0 });
    expect(none).toMatchObject({ vignette: 0, grain: 0, duotone: 0 });
    for (const id of ['mono', 'noir']) {
      const p = findLook(id)!.params;
      expect(p.saturation, id).toBe(0);
      expect(p.split, id).toBe(0);
      expect(p.duotone, id).toBe(0);
      expect(new Set(p.lift).size, `${id} lift`).toBe(1);
      expect(new Set(p.gamma).size, `${id} gamma`).toBe(1);
      expect(new Set(p.gain).size, `${id} gain`).toBe(1);
    }
  });

  it('looks are immutable and found by id', () => {
    for (const l of LOOKS) {
      expect(Object.isFrozen(l)).toBe(true);
      expect(findLook(l.id)).toBe(l);
    }
    expect(findLook('nope')).toBeUndefined();
  });
});

describe('lookUniforms and LOOK_FRAG', () => {
  const declared = declaredUniforms(LOOK_FRAG);

  it('starts with the version line, uses the contract precision and outputs fragColor', () => {
    expect(LOOK_FRAG.startsWith('#version 300 es')).toBe(true);
    expect(LOOK_FRAG).toMatch(/precision highp float;/);
    expect(LOOK_FRAG).toMatch(/out vec4 fragColor;/);
    expect(LOOK_FRAG).toMatch(/in vec2 vUv;/);
    expect(LOOK_FRAG).not.toMatch(/#extension/);
  });

  it('declares uTime (the host leaves it at 0 when it has no time)', () => {
    expect(declared.get('uTime')).toBe('float');
  });

  it('declares every uniform lookUniforms sets, with the right type', () => {
    for (const look of LOOKS) {
      const uniforms = lookUniforms(look.params, 0.7);
      expect(uniforms.uIntensity, look.id).toBe(0.7);
      for (const [name, value] of Object.entries(uniforms)) {
        const type = Array.isArray(value) ? `vec${value.length}` : 'float';
        expect(declared.get(name), `${look.id}: ${name}`).toBe(type);
      }
    }
  });

  it('sets every uniform the shader declares besides the common ones', () => {
    const keys = new Set(Object.keys(lookUniforms(LOOKS[0]!.params, 1)));
    for (const name of declared.keys()) {
      if (name in COMMON) continue;
      expect(keys.has(name), `${name} is declared but never set`).toBe(true);
    }
  });

  it('maps the parameter values through unchanged and copies the arrays', () => {
    const cinematic = findLook('cinematic')!;
    const u = lookUniforms(cinematic.params, 1);
    expect(u.uContrast).toBe(cinematic.params.contrast);
    expect(u.uShadows).toEqual(cinematic.params.shadows);
    expect(u.uShadows).not.toBe(cinematic.params.shadows);
    expect(u.uDuotone).toBe(0);
  });
});

describe('photo effects', () => {
  it('has none first and at least 14 entries (13 effects besides the identity)', () => {
    expect(PHOTO_EFFECTS[0]?.id).toBe('none');
    expect(PHOTO_EFFECTS.length).toBeGreaterThanOrEqual(14);
  });

  it('has unique kebab-case ids and unique names', () => {
    const ids = PHOTO_EFFECTS.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id, id).toMatch(KEBAB);
    const names = PHOTO_EFFECTS.map((e) => e.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('includes the effects the requirement names', () => {
    for (const id of ['mirror', 'bulge', 'glass', 'prism', 'op-art', 'halftone', 'thermal'])
      expect(findPhotoEffect(id), id).toBeDefined();
  });

  it('is found by id', () => {
    for (const e of PHOTO_EFFECTS) expect(findPhotoEffect(e.id)).toBe(e);
    expect(findPhotoEffect('nope')).toBeUndefined();
  });

  it.each(PHOTO_EFFECTS.map((e): [string, PhotoEffectDef] => [e.id, e]))(
    '%s is a contract-conformant fragment shader',
    (_id, e: PhotoEffectDef) => {
      expect(e.defaultIntensity).toBeGreaterThan(0);
      expect(e.defaultIntensity).toBeLessThanOrEqual(1);
      expect(e.frag.startsWith('#version 300 es')).toBe(true);
      expect(e.frag).toMatch(/precision highp float;/);
      expect(e.frag).toMatch(/out vec4 fragColor;/);
      expect(e.frag).toMatch(/in vec2 vUv;/);
      expect(e.frag).toMatch(/void main\s*\(\s*\)/);
      expect(e.frag).not.toMatch(/#extension/);
      // Photo effects use CommonUniforms only (uTime and friends belong to video effects).
      const declared = declaredUniforms(e.frag);
      for (const [name, type] of declared) {
        expect(['uSrc', 'uResolution', 'uIntensity', 'uSeed'], `${e.id} declares ${name}`).toContain(name);
        expect(type).toBe(COMMON[name]);
      }
      // Everything it reads is declared.
      for (const [name, type] of Object.entries(COMMON)) {
        if (new RegExp(`\\b${name}\\b`).test(e.frag)) expect(declared.get(name), `${e.id} uses ${name}`).toBe(type);
      }
      expect(e.frag).toMatch(/\buSrc\b/);
    },
  );

  it('never loops with a non-constant bound', () => {
    for (const e of PHOTO_EFFECTS)
      for (const m of e.frag.matchAll(/for\s*\(([^)]*)\)/g)) expect(m[1], `${e.id}: ${m[0]}`).toMatch(/<\s*\d+\s*;/);
  });

  it('returns early at intensity 0 (identity) in every effect but the plain none', () => {
    for (const e of PHOTO_EFFECTS) {
      if (e.id === 'none') continue;
      expect(e.frag, e.id).toMatch(/uIntensity\s*<=\s*0\.0/);
    }
  });
});
