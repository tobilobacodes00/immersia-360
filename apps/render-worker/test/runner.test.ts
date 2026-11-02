import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ServerRenderError, WorkerOutputTicket } from '@immersia/shared/render';
import type { ClaimedJob, WorkerApi } from '../src/api';
import {
  JobError,
  runJob,
  shouldExit,
  workLoop,
  type JobIO,
  type OutputFile,
  type Rendered,
  type RunnerOptions,
} from '../src/runner';

const recipe = {} as ClaimedJob['recipe'];
const job = (patch: Partial<ClaimedJob> = {}): ClaimedJob => ({
  id: '0198f7a0-6b1c-7d3e-8f4a-5b6c7d8e9f10',
  claimToken: 'claim-token-0123456789abcdef',
  attempts: 1,
  maxAttempts: 3,
  leaseMs: 300_000,
  recipe,
  urls: { original: 'o', overlay: null, endCard: null, intro: null, outro: null, music: null, background: null },
  ...patch,
});

const file = (kind: OutputFile['kind'], bytes = 1000): OutputFile => ({
  kind,
  path: `/tmp/${kind}`,
  bytes,
  width: 720,
  height: 1280,
  durationMs: 4000,
});

/** An API that records every call; each answer can be changed per test. */
function fakeApi(overrides: Partial<WorkerApi> = {}) {
  const calls: string[] = [];
  const api: WorkerApi = {
    claim: async () => null,
    heartbeat: async () => {
      calls.push('heartbeat');
      return 'ok';
    },
    registerOutputs: async (_id, _token, outputs) => {
      calls.push(`outputs:${outputs.map((o) => o.kind).join('+')}`);
      return outputs.map((o): WorkerOutputTicket => ({
        kind: o.kind,
        outputId: `id-${o.kind}`,
        url: 'https://storage.example/x',
        method: 'PUT',
        headers: {},
      }));
    },
    complete: async (_id, _token, renderMs) => {
      calls.push(`complete:${renderMs}`);
      return 'ok';
    },
    fail: async (_id, _token, code) => {
      calls.push(`fail:${code}`);
      return true;
    },
    ...overrides,
  };
  return { api, calls };
}

function fakeIO(overrides: Partial<JobIO> = {}) {
  const calls: string[] = [];
  const io: JobIO = {
    prepare: async () => {
      calls.push('prepare');
      return '/tmp/job';
    },
    cleanup: async () => {
      calls.push('cleanup');
    },
    download: async () => {
      calls.push('download');
    },
    render: async (): Promise<Rendered> => {
      calls.push('render');
      return { outputs: [file('mp4'), file('poster'), file('small_mp4')], renderMs: 52_000 };
    },
    upload: async (ticket) => {
      calls.push(`upload:${ticket.kind}`);
    },
    ...overrides,
  };
  return { io, calls };
}

const opts: RunnerOptions = { heartbeatMs: 60_000, maxRenderMs: 40 * 60_000 };

describe('one job', () => {
  it('downloads, renders, uploads the poster first and the video last, then completes', async () => {
    const { api, calls: apiCalls } = fakeApi();
    const { io, calls: ioCalls } = fakeIO();
    expect(await runJob(job(), api, io, opts)).toBe('done');
    expect(ioCalls).toEqual([
      'prepare',
      'download',
      'render',
      'upload:poster',
      'upload:small_mp4',
      'upload:mp4',
      'cleanup',
    ]);
    expect(apiCalls).toEqual(['outputs:mp4+poster+small_mp4', 'complete:52000']);
  });

  it('always cleans up the working directory', async () => {
    const { api } = fakeApi();
    const { io, calls } = fakeIO({
      render: async () => {
        throw new JobError('undecodable');
      },
    });
    await runJob(job(), api, io, opts);
    expect(calls.at(-1)).toBe('cleanup');
  });

  it.each(['undecodable', 'unsupported_encoder', 'encoder_stall', 'gpu', 'source_missing', 'download_failed'] as const)(
    'reports the code %s from the step that failed, and nothing is uploaded',
    async (code) => {
      const { api, calls } = fakeApi();
      const { io, calls: ioCalls } = fakeIO({
        download: async () => {
          if (code === 'source_missing' || code === 'download_failed') throw new JobError(code);
        },
        render: async () => {
          throw new JobError(code);
        },
      });
      expect(await runJob(job(), api, io, opts)).toBe('failed');
      expect(calls).toEqual([`fail:${code}`]);
      expect(ioCalls.some((c) => c.startsWith('upload'))).toBe(false);
    },
  );

  it('reports an unexpected error as a plain failure', async () => {
    const { api, calls } = fakeApi();
    const { io } = fakeIO({
      render: async () => {
        throw new TypeError('boom');
      },
    });
    expect(await runJob(job(), api, io, opts)).toBe('failed');
    expect(calls).toEqual(['fail:failed']);
  });

  it('reports a failed upload', async () => {
    const { api, calls } = fakeApi();
    const { io } = fakeIO({
      upload: async () => {
        throw new JobError('upload_failed');
      },
    });
    expect(await runJob(job(), api, io, opts)).toBe('failed');
    expect(calls.at(-1)).toBe('fail:upload_failed');
    expect(calls.some((c) => c.startsWith('complete'))).toBe(false);
  });

  it('treats "the server did not find the files" as a failed upload, to be tried again', async () => {
    const { api, calls } = fakeApi({ complete: async () => 'incomplete' });
    const { io } = fakeIO();
    expect(await runJob(job(), api, io, opts)).toBe('failed');
    expect(calls.at(-1)).toBe('fail:upload_failed');
  });

  it('drops a job the server no longer gives it, without a word', async () => {
    const { api, calls } = fakeApi({ registerOutputs: async () => 'lease_lost' });
    const { io, calls: ioCalls } = fakeIO();
    expect(await runJob(job(), api, io, opts)).toBe('lost');
    expect(calls).toEqual([]);
    expect(ioCalls.some((c) => c.startsWith('upload'))).toBe(false);

    const lost = fakeApi({ complete: async () => 'lease_lost' });
    expect(await runJob(job(), lost.api, fakeIO().io, opts)).toBe('lost');
    expect(lost.calls).toEqual(['outputs:mp4+poster+small_mp4']);
  });

  it('answers "lost" when the failure report finds the job already gone', async () => {
    const { api } = fakeApi({ fail: async () => false });
    const { io } = fakeIO({
      render: async () => {
        throw new JobError('gpu');
      },
    });
    expect(await runJob(job(), api, io, opts)).toBe('lost');
  });

  it('survives a failed failure report (the server is down): the lease will lapse and the job is retried', async () => {
    const { api } = fakeApi({
      fail: async () => {
        throw new Error('network');
      },
    });
    const { io } = fakeIO({
      render: async () => {
        throw new JobError('gpu');
      },
    });
    await expect(runJob(job(), api, io, opts)).resolves.toBe('failed');
  });
});

describe('the lease', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  /** A render that takes `ms` of (fake) time and can be aborted. */
  const slowRender =
    (ms: number): JobIO['render'] =>
    (_job, _dir, signal) =>
      new Promise((resolve, reject) => {
        const t = setTimeout(() => resolve({ outputs: [file('mp4')], renderMs: ms }), ms);
        signal.addEventListener('abort', () => {
          clearTimeout(t);
          reject(new DOMException('aborted', 'AbortError'));
        });
      });

  it('extends the lease every heartbeat while the render runs, and stops when it is done', async () => {
    const { api, calls } = fakeApi();
    const { io } = fakeIO({ render: slowRender(200_000) });
    const done = runJob(job(), api, io, opts);
    await vi.advanceTimersByTimeAsync(200_000);
    expect(await done).toBe('done');
    expect(calls.filter((c) => c === 'heartbeat')).toHaveLength(3); // at 60, 120 and 180 s
    await vi.advanceTimersByTimeAsync(300_000);
    expect(calls.filter((c) => c === 'heartbeat')).toHaveLength(3);
  });

  it('stops at once, and reports nothing, when a heartbeat says the job is no longer ours', async () => {
    const { api, calls } = fakeApi({ heartbeat: async () => 'lease_lost' });
    const { io } = fakeIO({ render: slowRender(10 * 60_000) });
    const done = runJob(job(), api, io, opts);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(await done).toBe('lost');
    expect(calls).toEqual([]);
  });

  it('a missed heartbeat (the server is busy) does not end the job', async () => {
    let n = 0;
    const { api, calls } = fakeApi({
      heartbeat: async () => {
        if (n++ === 0) throw new Error('timeout');
        return 'ok';
      },
    });
    const { io } = fakeIO({ render: slowRender(150_000) });
    const done = runJob(job(), api, io, opts);
    await vi.advanceTimersByTimeAsync(150_000);
    expect(await done).toBe('done');
    expect(calls).toContain('complete:150000');
  });

  it('fails a render that runs past the limit with `timeout`', async () => {
    const { api, calls } = fakeApi();
    const { io } = fakeIO({ render: slowRender(10 * 3_600_000) });
    const done = runJob(job(), api, io, { ...opts, maxRenderMs: 30 * 60_000 });
    await vi.advanceTimersByTimeAsync(31 * 60_000);
    expect(await done).toBe('failed');
    expect(calls.filter((c) => c.startsWith('fail'))).toEqual(['fail:timeout']);
  });

  it('a machine that is stopping fails the job with `shutdown`, so it is queued again at once', async () => {
    const { api, calls } = fakeApi();
    const { io } = fakeIO({ render: slowRender(10 * 60_000) });
    const stop = new AbortController();
    const done = runJob(job(), api, io, opts, stop.signal);
    await vi.advanceTimersByTimeAsync(5_000);
    stop.abort();
    expect(await done).toBe('failed');
    expect(calls).toEqual(['fail:shutdown']);
  });

  it('does not even start when it is already shutting down', async () => {
    const { api, calls } = fakeApi();
    const stop = new AbortController();
    stop.abort();
    const { io } = fakeIO({ render: slowRender(1000) });
    expect(await runJob(job(), api, io, opts, stop.signal)).toBe('failed');
    expect(calls).toEqual(['fail:shutdown']);
  });
});

describe('the loop', () => {
  const idle = (api: Partial<WorkerApi> = {}) => fakeApi(api).api;

  it('exits after the idle time with nothing to do, so the machine can stop', () => {
    expect(shouldExit(0, 4 * 60_000, 5 * 60_000)).toBe(false);
    expect(shouldExit(0, 5 * 60_000, 5 * 60_000)).toBe(true);
    expect(shouldExit(0, 10 ** 9, null)).toBe(false);
  });

  it('runs jobs one after another, polls when the queue is empty, and exits when idle long enough', async () => {
    let clock = 0;
    const sleeps: number[] = [];
    // The jobs the render was given, in order. This render replaces the default one, which is what records
    // `render` in the fake's calls, so it keeps its own record.
    const rendered: string[] = [];
    const queue = [job({ id: 'a' }), job({ id: 'b' })];
    const api = idle({ claim: async () => queue.shift() ?? null });
    // The override replaces fakeIO's own render, which is what records 'render' in its calls: record here.
    const { io } = fakeIO({
      render: async (claimed) => {
        rendered.push(claimed.id);
        clock += 30_000; // a render takes 30 s
        return { outputs: [file('mp4')], renderMs: 30_000 };
      },
    });
    const result = await workLoop(
      api,
      io,
      opts,
      {
        pollMs: 5_000,
        idleExitMs: 20_000,
        now: () => clock,
        sleep: async (ms) => {
          sleeps.push(ms);
          clock += ms;
        },
      },
      new AbortController().signal,
    );
    expect(result).toBe('idle');
    expect(rendered).toEqual(['a', 'b']);
    // After the last job the loop polled every 5 s until 20 s had passed.
    expect(sleeps).toEqual([5_000, 5_000, 5_000, 5_000]);
  });

  it('treats a claim that fails (the web app is down) like an empty queue, and carries on', async () => {
    let clock = 0;
    let tries = 0;
    const api = idle({
      claim: async () => {
        tries++;
        if (tries === 1) throw new Error('network');
        return null;
      },
    });
    const result = await workLoop(
      api,
      fakeIO().io,
      opts,
      { pollMs: 1_000, idleExitMs: 3_000, now: () => clock, sleep: async (ms) => void (clock += ms) },
      new AbortController().signal,
    );
    expect(result).toBe('idle');
    expect(tries).toBeGreaterThan(1);
  });

  it('never exits on its own when idle exit is off, only when told to stop', async () => {
    let clock = 0;
    const stop = new AbortController();
    let polls = 0;
    const result = await workLoop(
      idle(),
      fakeIO().io,
      opts,
      {
        pollMs: 1_000,
        idleExitMs: null,
        now: () => clock,
        sleep: async (ms) => {
          clock += ms * 1000;
          if (++polls === 50) stop.abort();
        },
      },
      stop.signal,
    );
    expect(result).toBe('stopped');
    expect(polls).toBe(50);
  });

  it('reports every failed job and goes on to the next', async () => {
    const reported: ServerRenderError[] = [];
    const queue = [job({ id: 'a' }), job({ id: 'b' })];
    const api = idle({
      claim: async () => queue.shift() ?? null,
      fail: async (_i, _t, code) => {
        reported.push(code);
        return true;
      },
    });
    const { io } = fakeIO({
      render: async () => {
        throw new JobError('encoder_stall');
      },
    });
    let clock = 0;
    await workLoop(
      api,
      io,
      opts,
      { pollMs: 1_000, idleExitMs: 1_000, now: () => clock, sleep: async (ms) => void (clock += ms) },
      new AbortController().signal,
    );
    expect(reported).toEqual(['encoder_stall', 'encoder_stall']);
  });
});
