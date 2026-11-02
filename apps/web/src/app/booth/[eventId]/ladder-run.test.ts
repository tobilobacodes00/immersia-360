import { describe, expect, it } from 'vitest';
import { EMPTY_MEMORY, recordFailure, type Availability, type RungMemory } from '@immersia/render-engine/ladder';
import { codeOfFailure, runLadder } from './ladder-run';

const NOW = 1_800_000_000_000;
const ALL: Availability = { local: true, wasm: true, server: true };

class Failure extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

/** Attempts that record which rung ran, and fail the ones named. */
function harness(failing: Record<string, string> = {}, overrides: { toServer?: () => Promise<void> } = {}) {
  const ran: string[] = [];
  let handedOver = 0;
  return {
    ran,
    get handedOver() {
      return handedOver;
    },
    deps: (
      available: Availability = ALL,
      memory: RungMemory = EMPTY_MEMORY,
      forced?: ('local' | 'wasm' | 'server')[],
    ) => ({
      available,
      memory,
      now: NOW,
      forced,
      attempt: async (rung: 'local' | 'wasm') => {
        ran.push(rung);
        const code = failing[rung];
        if (code) throw new Failure(code);
        return { rung };
      },
      toServer:
        overrides.toServer ??
        (async () => {
          handedOver++;
        }),
    }),
  };
}

describe('a take walking down the render ladder', () => {
  it('renders on the first rung when it works', async () => {
    const h = harness();
    const out = await runLadder(h.deps());
    expect(out).toMatchObject({ kind: 'rendered', rung: 'local', result: { rung: 'local' } });
    expect(out.memory.working).toBe('local');
    expect(h.ran).toEqual(['local']);
  });

  it('a missing encoder moves the take to the WebAssembly rung instead of failing it, and remembers both', async () => {
    const h = harness({ local: 'unsupported_encoder' });
    const out = await runLadder(h.deps());
    expect(out).toMatchObject({ kind: 'rendered', rung: 'wasm' });
    expect(h.ran).toEqual(['local', 'wasm']);
    expect(out.memory.working).toBe('wasm');
    expect(out.memory.failed.local?.code).toBe('unsupported_encoder');
  });

  it('a stalled encoder does the same', async () => {
    const h = harness({ local: 'encoder_stall' });
    expect(await runLadder(h.deps())).toMatchObject({ kind: 'rendered', rung: 'wasm' });
  });

  it('when both on-device rungs fail on the encoder the take is handed to the server', async () => {
    const h = harness({ local: 'unsupported_encoder', wasm: 'unsupported_encoder' });
    const out = await runLadder(h.deps());
    expect(out.kind).toBe('server');
    expect(h.ran).toEqual(['local', 'wasm']);
    expect(h.handedOver).toBe(1);
    expect(out.memory.failed.local && out.memory.failed.wasm).toBeTruthy();
  });

  it('a take that can not be decoded skips the WebAssembly rung (it only replaces the encoder) and goes to the server', async () => {
    const h = harness({ local: 'undecodable' });
    const out = await runLadder(h.deps());
    expect(out.kind).toBe('server');
    expect(h.ran).toEqual(['local']);
    // A bad take says nothing about the rung: it is not skipped for the next one.
    expect(out.memory.failed.local).toBeUndefined();
  });

  it('with no server, the last rung failing fails the take with the encoder’s own code', async () => {
    const h = harness({ local: 'unsupported_encoder', wasm: 'encoder_stall' });
    const out = await runLadder(h.deps({ ...ALL, server: false }));
    expect(out).toMatchObject({ kind: 'failed', code: 'encoder_stall', rung: 'wasm' });
  });

  it('never falls back on a cancel or an unexplained failure', async () => {
    for (const code of ['cancelled', 'failed']) {
      const h = harness({ local: code });
      const out = await runLadder(h.deps());
      expect(out).toMatchObject({ kind: 'failed', code, rung: 'local' });
      expect(h.ran).toEqual(['local']);
      expect(h.handedOver).toBe(0);
    }
  });

  it('later takes skip a rung that failed for good reason', async () => {
    const memory = recordFailure(EMPTY_MEMORY, 'local', 'unsupported_encoder', NOW - 1000);
    const h = harness();
    const out = await runLadder(h.deps(ALL, memory));
    expect(out).toMatchObject({ kind: 'rendered', rung: 'wasm' });
    expect(h.ran).toEqual(['wasm']);
  });

  it('and try the rung again once its skip has run out', async () => {
    const memory = recordFailure(EMPTY_MEMORY, 'local', 'unsupported_encoder', NOW - 8 * 24 * 3_600_000);
    const h = harness();
    expect(await runLadder(h.deps(ALL, memory))).toMatchObject({ kind: 'rendered', rung: 'local' });
  });

  it('a device with no encoder at all starts on the WebAssembly rung', async () => {
    const h = harness();
    const out = await runLadder(h.deps({ local: false, wasm: true, server: true }));
    expect(out).toMatchObject({ kind: 'rendered', rung: 'wasm' });
    expect(h.ran).toEqual(['wasm']);
  });

  it('a device that can only use the server hands everything over without trying to render', async () => {
    const h = harness();
    const out = await runLadder(h.deps({ local: false, wasm: false, server: true }));
    expect(out.kind).toBe('server');
    expect(h.ran).toEqual([]);
  });

  it('a device that can do nothing fails the take as having no encoder', async () => {
    const out = await runLadder(harness().deps({ local: false, wasm: false, server: false }));
    expect(out).toMatchObject({ kind: 'failed', code: 'unsupported_encoder', rung: null });
  });

  it('fails the take when it can not even be handed to the server', async () => {
    const h = harness(
      {},
      {
        toServer: async () => {
          throw new Failure('failed');
        },
      },
    );
    const out = await runLadder(h.deps({ local: false, wasm: false, server: true }));
    expect(out).toMatchObject({ kind: 'failed', code: 'failed', rung: 'server' });
  });

  describe('the test hook', () => {
    it('fails the local rung on purpose, and the next rung then really renders', async () => {
      const h = harness();
      const out = await runLadder(h.deps(ALL, EMPTY_MEMORY, ['local']));
      expect(out).toMatchObject({ kind: 'rendered', rung: 'wasm' });
      expect(h.ran).toEqual(['wasm']); // the forced rung never ran
      expect(out.memory.failed.local?.code).toBe('unsupported_encoder');
    });

    it('forcing the on-device rungs sends the take to the server', async () => {
      const h = harness();
      expect((await runLadder(h.deps(ALL, EMPTY_MEMORY, ['local', 'wasm']))).kind).toBe('server');
      expect(h.ran).toEqual([]);
    });

    it('does nothing when nothing is forced', async () => {
      const h = harness();
      expect((await runLadder(h.deps(ALL, EMPTY_MEMORY, []))).kind).toBe('rendered');
      expect(h.ran).toEqual(['local']);
    });
  });
});

describe('the code of a failure', () => {
  it('reads the code a render error carries, and calls anything else a plain failure', () => {
    expect(codeOfFailure(new Failure('gpu'))).toBe('gpu');
    expect(codeOfFailure(new Error('boom'))).toBe('failed');
    expect(codeOfFailure(null)).toBe('failed');
    expect(codeOfFailure({ code: 5 })).toBe('failed');
  });
});
