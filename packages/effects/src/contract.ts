/**
 * The contract between the effects library (pure GLSL + metadata, this package) and the hosts that
 * run it: the render engine's compositor (360 videos, VID-7/11/12), the stills runner (photo booth,
 * PHO-10; previews) and the live camera preview (CAP-9). Nothing here touches WebGL: hosts compile
 * the shaders and set the uniforms described below.
 *
 * Every fragment shader is GLSL ES 3.00 (`#version 300 es`, `precision highp float;`), reads
 * `in vec2 vUv;` (0..1, origin bottom-left, the host's fullscreen triangle) and writes
 * `out vec4 fragColor;` with alpha 1.
 */

/** Uniforms every look, effect and photo effect receives. */
export interface CommonUniforms {
  /** The image being processed. */
  uSrc: 'sampler2D';
  /** Output size in pixels. */
  uResolution: 'vec2';
  /** 0..1, the strength the operator chose (1 = as designed). */
  uIntensity: 'float';
  /** Per-render seed (0..1000): stateless "randomness" (confetti, grain) stays deterministic. */
  uSeed: 'float';
}

// -----------------------------------------------------------------------------------------------
// Looks (VID-11: at least 19 colour looks, one per event; also applied to photos and the live preview)

/**
 * A look is a set of parameters for ONE shared shader (LOOK_FRAG): grading is uniform maths, so
 * adding a look never adds a program, and previews, live preview and render use identical code.
 */
export interface LookParams {
  /** −1..1 */
  exposure: number;
  /** 0..2 (1 = unchanged) */
  contrast: number;
  /** 0..2 (1 = unchanged; 0 = monochrome) */
  saturation: number;
  /** −1 (cool) .. 1 (warm) */
  temperature: number;
  /** −1 (green) .. 1 (magenta) */
  tint: number;
  /** Lift/gamma/gain per channel (lift −0.2..0.2, gamma 0.5..2, gain 0.5..1.5). */
  lift: [number, number, number];
  gamma: [number, number, number];
  gain: [number, number, number];
  /** Split toning: shadow and highlight colours (RGB 0..1) and their strength 0..1. */
  shadows: [number, number, number];
  highlights: [number, number, number];
  split: number;
  /** Raise blacks for a faded film look 0..0.3. */
  fade: number;
  /** 0..1 */
  vignette: number;
  /** Film grain 0..0.2 (animated with uTime where the host has time, static otherwise). */
  grain: number;
  /** Duotone: map luminance from `dark` to `light` (RGB), mixed in by `duotone` 0..1. */
  duotone: number;
  dark: [number, number, number];
  light: [number, number, number];
}

export interface LookDef {
  id: string;
  /** English display name; the UI translates by id where it can. */
  name: string;
  params: LookParams;
}

// -----------------------------------------------------------------------------------------------
// Video effects (VID-7: at least 16, some with colour modes; VID-12: driven by the music's beat)

export const COLOR_MODES = ['colour', 'white', 'silver', 'gold'] as const;
export type ColorMode = (typeof COLOR_MODES)[number];

/** What the host passes to a video effect besides CommonUniforms. */
export interface EffectUniforms extends CommonUniforms {
  /** Seconds since the start of the guest's footage (not the intro). */
  uTime: 'float';
  /** Length of the guest's footage in seconds. */
  uDuration: 'float';
  /** 0..1 position within the current beat (0 on the beat); a steady 120 BPM grid without music. */
  uBeat: 'float';
  /** 1 on a beat, decaying to 0 before the next (an envelope for flashes and pulses). */
  uPulse: 'float';
  /** The colour for the single-colour modes (white/silver/gold); ignored in colour mode. */
  uColor: 'vec3';
  /** 0 = colour (multicolour palette chosen in-shader), 1 = white, 2 = silver, 3 = gold. */
  uColorMode: 'int';
  /**
   * Previous composed frames (before effects), newest first. Bound only for effects with
   * `history > 0` (up to 4); unbound slots repeat the current frame.
   */
  uPrev1: 'sampler2D';
  uPrev2: 'sampler2D';
  uPrev3: 'sampler2D';
  uPrev4: 'sampler2D';
}

export interface EffectDef {
  id: string;
  name: string;
  /** Present when the effect has colour modes (confetti: colour/white/silver/gold). */
  colorModes?: readonly ColorMode[];
  /** How many previous frames the effect reads (echo trail, clones): 0..4. */
  history: number;
  /** Strength used when the operator hasn't changed it. */
  defaultIntensity: number;
  frag: string;
}

/** Colours for the single-colour modes. Colour mode picks from a palette in-shader. */
export const MODE_COLORS: Record<Exclude<ColorMode, 'colour'>, [number, number, number]> = {
  white: [1, 1, 1],
  silver: [0.78, 0.8, 0.84],
  gold: [0.96, 0.76, 0.35],
};

// -----------------------------------------------------------------------------------------------
// Photo effects (PHO-10: at least 13), applied to each still before the strip is composed

export interface PhotoEffectDef {
  id: string;
  name: string;
  defaultIntensity: number;
  /** Uses CommonUniforms only. */
  frag: string;
}
