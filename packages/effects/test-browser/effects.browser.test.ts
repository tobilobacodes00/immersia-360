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

  it('never lifts a pixel more than the documented peak, whatever the beat state', () => {
    const black = solidFrame(0);
    let worst = 0;
    for (let i = 0; i <= 40; i++) {
      const beat = i / 40;
      const pulse = i === 0 ? 1 : Math.max(0, 1 - beat / 0.8) ** 2;
      const px = host.render(programs.get(strobe), black, params({ intensity: 1, beat, pulse, time: i * 0.37 }));
      worst = Math.max(worst, maxChannel(px));
    }
    // out of 255: a flash may take black no further than STROBE_PEAK_LIFT of the way to white
    expect(worst).toBeGreaterThan(0.5 * STROBE_PEAK_LIFT * 255);
    expect(worst).toBeLessThanOrEqual(Math.ceil(STROBE_PEAK_LIFT * 255) + 1);
  });

  it('lifts bright areas proportionally less than dark ones and never past the peak', () => {
    const lit = host.render(programs.get(strobe), scene.source, params({ intensity: 1, ...ON_BEAT }));
    let excess = -Infinity;
    for (let i = 0; i < lit.length; i += 4)
      for (let c = 0; c < 3; c++) {
        const src = scene.source.data[i + c]!;
        excess = Math.max(excess, lit[i + c]! - src - (255 - src) * STROBE_PEAK_LIFT);
      }
    expect(excess).toBeLessThanOrEqual(1.5);
  });

  it('is exactly the source between flashes', () => {
    const quiet = host.render(programs.get(strobe), scene.source, params({ intensity: 1, ...OFF_BEAT }));
    expect(maxDiff(quiet, scene.source.data)).toBeLessThanOrEqual(1);
  });

  it('flashes once per beat, so a grid at the tempo ceiling stays within 3 flashes a second', () => {
    const fps = 30;
    const flashesAt = (bpm: number, seconds: number) => {
      const levels: number[] = [];
      for (let frame = 0; frame < seconds * fps; frame++) {
        const beat = ((frame * bpm) % (60 * fps)) / (60 * fps);
        const pulse = Math.max(0, 1 - beat / 0.8) ** 2;
        const px = host.render(
          programs.get(strobe),
          scene.source,
          params({ intensity: 1, beat, pulse, time: frame / fps }),
        );
        levels.push(meanLuma(px));
      }
      const base = Math.min(...levels);
      const threshold = base + 0.25 * (Math.max(...levels) - base);
      const flashes: number[] = [];
      levels.forEach((level, frame) => {
        if (level > threshold && (frame === 0 || levels[frame - 1]! <= threshold)) flashes.push(frame);
      });
      return flashes;
    };

    const at150 = flashesAt(150, 4);
    expect(at150).toHaveLength(10); // one per beat: 150 BPM for 4 s

    const atCeiling = flashesAt(STROBE_MAX_BPM, 3);
    expect(atCeiling).toHaveLength((STROBE_MAX_BPM * 3) / 60);
    for (const start of atCeiling) {
      const inWindow = atCeiling.filter((frame) => frame >= start && frame < start + fps).length;
      expect(inWindow).toBeLessThanOrEqual(3);
    }
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
