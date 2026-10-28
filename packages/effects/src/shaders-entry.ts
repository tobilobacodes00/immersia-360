/**
 * The DOM-free half of the package: definitions, GLSL and uniform helpers, with no canvas,
 * document or Image anywhere in its import graph. The render worker (lib ES2023 + WebWorker, no
 * DOM) and anything else that only needs the shaders imports this subpath
 * ('@immersia/effects/shaders') instead of the main entry, which also carries the DOM-bound
 * StillRunner. Everything here is also exported by the main entry.
 */
export * from './contract';
export * from './looks';
export * from './photo-effects';
export { EFFECTS, findEffect, STROBE_MAX_BPM, STROBE_PEAK_LIFT } from './effects';
