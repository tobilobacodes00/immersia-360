import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { COLOR_MODES, MODE_COLORS, type ColorMode, type EffectDef } from '../src/contract';
import { EFFECTS, STROBE_MAX_BPM, STROBE_PEAK_LIFT } from '../src/effects';
import { withoutFinalClamp } from '../src/glsl';
import { EffectHost, type CompiledEffect, type RenderParams } from './effect-host';
import {
  H,
  OFF_BEAT,
  ON_BEAT,
  W,
  beatAt,
  countDiff,
  hueBins,
  makeScene,
  maxChannel,
  maxDiff,
  maxLuminanceRise,
  meanLuma,
  params,
  sameBytes,
  solidFrame,
  warmthOfChange,
} from './frames';

/**
 * The effect pack running for real: every shader compiled and executed in Chrome's WebGL2 (SwiftShader
 * in CI) on a synthetic 320x180 frame (a bright subject over a gradient) with four earlier frames in
 * which the subject stood further left.
 */

/** Times covering a beat (0.5 s = a beat at 120 BPM), part-way through one, and a gap between beats. */
const TIMES = [0.5, 1.7, 4.6, 7.9];

/** Effects whose layout is hashed from the seed. */
const SEEDED = new Set(['confetti', 'bubbles', 'sparkle', 'snow', 'hearts']);

class Programs {
  private readonly clamped = new Map<string, CompiledEffect>();
  private readonly raw = new Map<string, CompiledEffect>();
  constructor(private readonly host: EffectHost) {}

  /** The shader as shipped. */
  get(effect: EffectDef): CompiledEffect {
    let compiled = this.clamped.get(effect.id);
    if (!compiled) this.clamped.set(effect.id, (compiled = this.host.compile(effect.frag)));
    return compiled;
  }

  /** The same shader without its final clamp, for float readback (NaN, Infinity and runaway values show). */
  getUnclamped(effect: EffectDef): CompiledEffect {
    let compiled = this.raw.get(effect.id);
    if (!compiled) this.raw.set(effect.id, (compiled = this.host.compile(withoutFinalClamp(effect.frag))));
    return compiled;
  }
}

function modeParams(mode: ColorMode): Partial<RenderParams> {
  return { colorMode: COLOR_MODES.indexOf(mode), color: mode === 'colour' ? [1, 1, 1] : MODE_COLORS[mode] };
}

let host: EffectHost;
let big: EffectHost;
let programs: Programs;
let bigPrograms: Programs;
const scene = makeScene();
const bigScene = makeScene(2 * W, 2 * H);

beforeAll(() => {
  host = new EffectHost(W, H);
  big = new EffectHost(2 * W, 2 * H);
  programs = new Programs(host);
  bigPrograms = new Programs(big);
});

afterAll(() => {
  host.dispose();
  big.dispose();
});

/** Render an effect on the test scene at `time`, with a 120 BPM beat grid unless overridden. */
function renderAt(effect: EffectDef, time: number, over: Partial<RenderParams> = {}): Uint8Array {
  const grid = beatAt(time, 120);
  return host.render(programs.get(effect), scene.source, params({ time, ...grid, ...over }), scene.history);
}

describe.each(EFFECTS.map((e): [string, EffectDef] => [e.id, e]))('%s', (_id, effect) => {
  it('compiles and links', () => {
    const compiled = programs.get(effect);
    expect(compiled.locations.has('uSrc')).toBe(true);
  });

  it('renders an opaque frame with no black holes', () => {
    for (const time of TIMES) {
      const px = renderAt(effect, time);
      let opaque = true;
      for (let i = 3; i < px.length; i += 4) if (px[i] !== 255) opaque = false;
      expect(opaque, `alpha at t=${time}`).toBe(true);
      let dark = 0;
      for (let i = 0; i < px.length; i += 4) if (Math.max(px[i]!, px[i + 1]!, px[i + 2]!) < 8) dark++;
      expect(dark / (px.length / 4), `near-black share at t=${time}`).toBeLessThan(0.01);
    }
  });

  it('stays finite and bounded in float (no NaN, no Infinity), edge cases included', ({ skip }) => {
    if (!host.floatTargets) skip();
    const cases: Partial<RenderParams>[] = [
      { time: 0, beat: 0, pulse: 1 },
      { time: 0.35, beat: 0.999, pulse: 0 },
      { time: 7.9, beat: 0.5, pulse: 0.3, intensity: 0 },
      { time: 19.99, beat: 0.25, pulse: 0.5, intensity: 0.5 },
      { time: 3, beat: 0, pulse: 1, seed: 0 },
      { time: 3, beat: 0.1, pulse: 0.8, seed: 999.9, colorMode: 3, color: MODE_COLORS.gold },
    ];
    const compiled = programs.getUnclamped(effect);
    for (const over of cases) {
      const out = host.renderFloat(compiled, scene.source, params(over), scene.history)!;
      let bad = -1;
      for (let i = 0; i < out.length && bad < 0; i++)
        if (!Number.isFinite(out[i]!) || out[i]! < -1 || out[i]! > 6) bad = i;
      expect(bad, `non-finite or runaway value at index ${bad} for ${JSON.stringify(over)}`).toBe(-1);
    }
  });

  it('reproduces the input within +-2 at intensity 0', () => {
    for (const time of TIMES) {
      const px = renderAt(effect, time, { intensity: 0 });
      expect(maxDiff(px, scene.source.data), `t=${time}`).toBeLessThanOrEqual(2);
    }
  });

  it('changes the picture at intensity 1', () => {
    const changed = Math.max(...TIMES.map((time) => countDiff(renderAt(effect, time), scene.source.data, 4)));
    expect(changed).toBeGreaterThanOrEqual(40);
  });

  it('is deterministic: the same inputs give identical pixels, whatever ran in between', () => {
    const first = renderAt(effect, 4.6);
    const other = EFFECTS.find((e) => e.id !== effect.id)!;
    renderAt(other, 2.2);
    expect(sameBytes(first, renderAt(effect, 4.6))).toBe(true);
  });

  if (SEEDED.has(effect.id)) {
    it('re-rolls its layout with the seed', () => {
      const a = renderAt(effect, 4.6, { seed: 7 });
      const b = renderAt(effect, 4.6, { seed: 8 });
      expect(countDiff(a, b, 4)).toBeGreaterThanOrEqual(20);
    });
  }

  if (effect.history > 0) {
    it('reads its history frames: with none bound the picture differs', () => {
      const grid = beatAt(4.6, 120);
      const withHistory = renderAt(effect, 4.6);
      const without = host.render(programs.get(effect), scene.source, params({ time: 4.6, ...grid }), []);
      expect(countDiff(withHistory, without, 4)).toBeGreaterThanOrEqual(40);
    });
  }

  it('moves with the music (VID-12): on the beat differs from off the beat', () => {
    const on = renderAt(effect, 2.5, ON_BEAT);
    const off = renderAt(effect, 2.5, OFF_BEAT);
    expect(countDiff(on, off, 2)).toBeGreaterThanOrEqual(20);
  });

  it('follows the short side of the output: twice the resolution looks the same', () => {
    const time = 4.6;
    const grid = beatAt(time, 120);
    const small = renderAt(effect, time);
    const large = big.render(bigPrograms.get(effect), bigScene.source, params({ time, ...grid }), bigScene.history);
    expect(Math.abs(meanLuma(small) - meanLuma(large))).toBeLessThan(3);
  });

  if (effect.colorModes) {
    const modes = effect.colorModes;

    it('looks different in every colour mode', () => {
      const shots = modes.map((mode) => renderAt(effect, 4.6, modeParams(mode)));
      for (let a = 0; a < shots.length; a++)
        for (let b = a + 1; b < shots.length; b++)
          expect(countDiff(shots[a]!, shots[b]!, 4), `${modes[a]} vs ${modes[b]}`).toBeGreaterThanOrEqual(20);
    });

    it('adds warm light in gold mode', () => {
      const { warmth, changed } = warmthOfChange(renderAt(effect, 4.6, modeParams('gold')), scene.source.data, 12);
      expect(changed).toBeGreaterThanOrEqual(20);
      expect(warmth).toBeGreaterThan(5);
    });
  }
});

describe('beat sync (VID-12)', () => {
  // the effects whose job is to flash, switch or pulse: the picture is brighter on the beat than off it
  for (const id of ['strobe', 'disco', 'light-rings']) {
    it(`${id}: mean brightness at uPulse = 1 differs from uPulse = 0`, () => {
      const effect = EFFECTS.find((e) => e.id === id)!;
      const on = meanLuma(renderAt(effect, 2.5, ON_BEAT));
      const off = meanLuma(renderAt(effect, 2.5, OFF_BEAT));
      expect(on - off, `on ${on.toFixed(2)} off ${off.toFixed(2)}`).toBeGreaterThan(0.5);
    });
  }
});

describe('confetti colour modes (VID-7)', () => {
  const confetti = EFFECTS.find((e) => e.id === 'confetti')!;
  const hues = (mode: ColorMode) => hueBins(renderAt(confetti, 4.6, modeParams(mode)), scene.source.data, 100, 40);

  it('is multicoloured in colour mode', () => {
    expect(hues('colour')).toBeGreaterThanOrEqual(6);
  });

  it('keeps white, silver and gold to a narrow range of hues (none at all for the greys)', () => {
    for (const mode of ['white', 'silver', 'gold'] as const) expect(hues(mode), mode).toBeLessThanOrEqual(4);
  });
});

describe('strobe: beat-locked and photosensitivity-safe', () => {
  const strobe = EFFECTS.find((e) => e.id === 'strobe')!;

  it('never raises any pixel’s relative luminance by the 0.1 WCAG 2.3.1 counts as a flash, at any beat state', () => {
    let worst = -1;
    // (a flash is monotonic in the pulse, so a few pulse values cover every beat state)
    for (const frame of [solidFrame(0), solidFrame(40), solidFrame(128), scene.source]) {
      for (const pulse of [1, 0.6, 0.2, 0]) {
        const px = host.render(programs.get(strobe), frame, params({ intensity: 1, beat: 0.1, pulse }));
        worst = Math.max(worst, maxLuminanceRise(frame.data, px));
      }
    }
    expect(worst).toBeLessThan(0.1);
    expect(worst).toBeLessThanOrEqual(STROBE_PEAK_LIFT + 0.006); // the documented peak, plus 8-bit rounding
  });

  it('is still a visible flash: on black the on-beat frame reaches the documented peak', () => {
    const black = solidFrame(0);
    const lit = host.render(programs.get(strobe), black, params({ intensity: 1, ...ON_BEAT }));
    expect(maxLuminanceRise(black.data, lit)).toBeGreaterThan(0.8 * STROBE_PEAK_LIFT);
    expect(maxChannel(lit)).toBeGreaterThan(60);
    expect(maxChannel(lit)).toBeLessThan(90); // 0.09 of relative luminance is about 85 of 255 in sRGB
  });

  it('is exactly the source between flashes', () => {
    const quiet = host.render(programs.get(strobe), scene.source, params({ intensity: 1, ...OFF_BEAT }));
    expect(maxDiff(quiet, scene.source.data)).toBeLessThanOrEqual(1);
  });

  it('flashes once per beat and is over by the middle of it, so the grid at STROBE_MAX_BPM gives at most 3 a second', () => {
    // One beat sampled in 24 steps. One flash per beat means one flash per (60 / BPM) seconds.
    const steps = 24;
    const levels = Array.from({ length: steps }, (_, i) => {
      const beat = i / steps;
      const pulse = Math.max(0, 1 - beat / 0.8) ** 2;
      return meanLuma(host.render(programs.get(strobe), scene.source, params({ intensity: 1, beat, pulse })));
    });
    const base = levels[steps - 1]!; // the pulse has gone before the next beat
    const peak = Math.max(...levels);
    expect(peak - base).toBeGreaterThan(5);
    const bright = levels.map((level) => level > base + 0.25 * (peak - base));
    expect(bright[0], 'flashes on the beat').toBe(true);
    const flashes = bright.filter((on, i) => on && (i === 0 || !bright[i - 1])).length;
    expect(flashes, 'flashes per beat').toBe(1);
    expect(bright.lastIndexOf(true), 'over by the middle of the beat').toBeLessThan(steps / 2);
    expect(STROBE_MAX_BPM / 60).toBeLessThanOrEqual(3);
  });
});

describe('the host', () => {
  it('provides vUv with its origin at the bottom-left, as the contract says', () => {
    // a one-off shader that writes vUv: red grows with x, green with y; row 0 is the bottom row
    const probe = host.compile(`#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
void main() { fragColor = vec4(vUv, 0.0, 1.0); }`);
    const px = host.render(probe, scene.source, params());
    const at = (x: number, y: number) => [px[(y * W + x) * 4]!, px[(y * W + x) * 4 + 1]!];
    expect(at(2, 2)[0]).toBeLessThan(10);
    expect(at(2, 2)[1]).toBeLessThan(10);
    expect(at(W - 3, 2)[0]).toBeGreaterThan(245);
    expect(at(2, H - 3)[1]).toBeGreaterThan(245);
  });
});
