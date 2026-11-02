import { describe, expect, it } from 'vitest';
import {
  EMPTY_MEMORY,
  SKIP_FOR_MS,
  availableRungs,
  fallsBack,
  isSkipped,
  nextRung,
  parseMemory,
  recordFailure,
  recordSuccess,
  startRung,
  type Availability,
} from '../src/ladder';

const NOW = 1_800_000_000_000;
const ALL: Availability = { local: true, wasm: true, server: true };
const HOUR = 3_600_000;

describe('which failures move a take to the next rung', () => {
  it('falls back for a missing or dying encoder, a missing GPU and an undecodable take', () => {
    for (const code of ['unsupported_encoder', 'encoder_stall', 'gpu', 'undecodable'])
      expect(fallsBack(code)).toBe(true);
  });

  it('never falls back for a cancel or an unexplained failure (the operator decides; the server costs money)', () => {
    for (const code of ['cancelled', 'failed', 'whatever']) expect(fallsBack(code)).toBe(false);
    expect(nextRung('local', 'cancelled', ALL, EMPTY_MEMORY, NOW)).toBeNull();
    expect(nextRung('local', 'failed', ALL, EMPTY_MEMORY, NOW)).toBeNull();
  });
});

describe('the next rung', () => {
  it('an encoder problem goes local → wasm → server', () => {
    expect(nextRung('local', 'unsupported_encoder', ALL, EMPTY_MEMORY, NOW)).toBe('wasm');
    expect(nextRung('local', 'encoder_stall', ALL, EMPTY_MEMORY, NOW)).toBe('wasm');
    expect(nextRung('wasm', 'unsupported_encoder', ALL, EMPTY_MEMORY, NOW)).toBe('server');
    expect(nextRung('wasm', 'encoder_stall', ALL, EMPTY_MEMORY, NOW)).toBe('server');
  });

  it('skips wasm when the encoder is not the problem: it replaces only the encoder', () => {
    expect(nextRung('local', 'undecodable', ALL, EMPTY_MEMORY, NOW)).toBe('server');
    expect(nextRung('local', 'gpu', ALL, EMPTY_MEMORY, NOW)).toBe('server');
  });

  it('is final after the server, and when nothing further is available', () => {
    expect(nextRung('server', 'unsupported_encoder', ALL, EMPTY_MEMORY, NOW)).toBeNull();
    expect(nextRung('wasm', 'unsupported_encoder', { ...ALL, server: false }, EMPTY_MEMORY, NOW)).toBeNull();
    expect(nextRung('local', 'unsupported_encoder', { ...ALL, wasm: false }, EMPTY_MEMORY, NOW)).toBe('server');
  });

  it('does not go to a rung that is known to be dead', () => {
    const memory = recordFailure(EMPTY_MEMORY, 'wasm', 'unsupported_encoder', NOW);
    expect(nextRung('local', 'unsupported_encoder', ALL, memory, NOW)).toBe('server');
  });
});

describe('where the next take starts (rung memory)', () => {
  it('the best available rung, when nothing is known', () => {
    expect(startRung(ALL, EMPTY_MEMORY, NOW)).toBe('local');
    expect(startRung({ ...ALL, local: false }, EMPTY_MEMORY, NOW)).toBe('wasm');
    expect(startRung({ local: false, wasm: false, server: true }, EMPTY_MEMORY, NOW)).toBe('server');
    expect(startRung({ local: false, wasm: false, server: false }, EMPTY_MEMORY, NOW)).toBeNull();
  });

  it('later takes skip a rung that failed for good reason, until the skip runs out', () => {
    const memory = recordFailure(EMPTY_MEMORY, 'local', 'unsupported_encoder', NOW);
    expect(startRung(ALL, memory, NOW + HOUR)).toBe('wasm');
    expect(startRung(ALL, memory, NOW + SKIP_FOR_MS.unsupported_encoder! - 1)).toBe('wasm');
    expect(startRung(ALL, memory, NOW + SKIP_FOR_MS.unsupported_encoder!)).toBe('local');
  });

  it('a stalled encoder is retried sooner than one that cannot encode at all', () => {
    const stalled = recordFailure(EMPTY_MEMORY, 'local', 'encoder_stall', NOW);
    expect(isSkipped(stalled, 'local', NOW + HOUR)).toBe(true);
    expect(isSkipped(stalled, 'local', NOW + 6 * HOUR)).toBe(false);
  });

  it('a take that cannot be decoded says nothing about the rung', () => {
    expect(recordFailure(EMPTY_MEMORY, 'local', 'undecodable', NOW)).toBe(EMPTY_MEMORY);
    expect(recordFailure(EMPTY_MEMORY, 'local', 'cancelled', NOW)).toBe(EMPTY_MEMORY);
  });

  it('never skips the server: it is the last resort', () => {
    const memory = recordFailure(EMPTY_MEMORY, 'server', 'unsupported_encoder', NOW);
    expect(startRung({ local: false, wasm: false, server: true }, memory, NOW)).toBe('server');
  });

  it('a success clears that rung’s failure and is remembered as the rung that works', () => {
    let memory = recordFailure(EMPTY_MEMORY, 'wasm', 'encoder_stall', NOW);
    memory = recordSuccess(memory, 'wasm');
    expect(memory.working).toBe('wasm');
    expect(memory.failed.wasm).toBeUndefined();
  });

  it('keeps other rungs’ failures when one succeeds', () => {
    let memory = recordFailure(EMPTY_MEMORY, 'local', 'unsupported_encoder', NOW);
    memory = recordSuccess(memory, 'wasm');
    expect(memory.failed.local?.code).toBe('unsupported_encoder');
    expect(memory.working).toBe('wasm');
  });

  it('is not modified in place', () => {
    const before = recordFailure(EMPTY_MEMORY, 'local', 'gpu', NOW);
    const snapshot = JSON.stringify(before);
    recordSuccess(before, 'local');
    recordFailure(before, 'wasm', 'gpu', NOW);
    expect(JSON.stringify(before)).toBe(snapshot);
  });
});

describe('which rungs a device can attempt', () => {
  const caps = (h264Encode: boolean, webgl2: boolean) => ({ webgl2, webcodecs: { h264Encode } });

  it('local needs an H.264 encoder and WebGL2; wasm needs WebGL2 and WebAssembly', () => {
    expect(availableRungs(caps(true, true), { wasm: true, server: true })).toEqual(ALL);
    expect(availableRungs(caps(false, true), { wasm: true, server: true })).toEqual({
      local: false,
      wasm: true,
      server: true,
    });
    expect(availableRungs(caps(true, false), { wasm: true, server: true })).toEqual({
      local: false,
      wasm: false,
      server: true,
    });
    expect(availableRungs(caps(false, true), { wasm: false, server: false })).toEqual({
      local: false,
      wasm: false,
      server: false,
    });
  });
});

describe('what is stored on the device', () => {
  it('round-trips', () => {
    const memory = recordSuccess(recordFailure(EMPTY_MEMORY, 'local', 'unsupported_encoder', NOW), 'wasm');
    expect(parseMemory(JSON.parse(JSON.stringify(memory)))).toEqual(memory);
  });

  it('treats anything unexpected as a clean slate', () => {
    for (const junk of [null, undefined, 'x', 5, [], { working: 'cloud' }]) {
      const m = parseMemory(junk);
      expect(m.working).toBeNull();
      expect(m.failed).toEqual({});
    }
    expect(
      parseMemory({ working: 'wasm', failed: { local: { code: 5, at: 'x' }, wasm: { code: 'gpu', at: 1 } } }),
    ).toEqual({
      working: 'wasm',
      failed: { wasm: { code: 'gpu', at: 1 } },
    });
  });
});
