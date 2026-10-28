import { describe, expect, it } from 'vitest';
import type { RenderRecipe, ServerFileTicket, ServerRenderJobView } from '@immersia/shared';
import {
  FAILED_RECHECK_MS,
  MAX_ANSWERS,
  POLL_MS,
  ServerApiError,
  buildRecipe,
  describeBackground,
  describeCard,
  jobFailure,
  originalMime,
  outcomeOf,
  progressOf,
  resultOf,
  recheckOf,
  retryDelayMs,
  serverStep,
  watchesServer,
  type PreparedJob,
  type RecipePlan,
  type ServerRenderApi,
  type ServerStepDeps,
} from './server-render-core';

const NOW = 1_800_000_000_000;
const ASSET = '0198f7a0-6b1c-7d3e-8f4a-5b6c7d8e9f01';
const OTHER = '0198f7a0-6b1c-7d3e-8f4a-5b6c7d8e9f02';

const plan = (patch: Partial<RecipePlan> = {}): RecipePlan => ({
  output: { width: 720, height: 1280, fps: 30, bitrate: 3_500_000 },
  preset: 'balanced',
  slowMotion: { enabled: true, startS: 2, endS: 6, speed: 0.5 },
  reverse: 'none',
  look: { id: 'noir', intensity: 1 },
  effects: [{ id: 'confetti', intensity: 1, colorMode: null }],
  beats: [0.5, 1],
  seed: 12,
  music: { assetId: ASSET, trimStartMs: 0, trimEndMs: null, offsetMs: 0, fadeInMs: 500, fadeOutMs: 1000, volume: 0.9 },
  background: { kind: 'image', assetId: OTHER },
  intro: { assetId: OTHER, kind: 'image', seconds: 2 },
  outro: null,
  endCardSeconds: 2,
  smallCopy: true,
  ...patch,
});

const files = {
  original: { bytes: 5_000_000, mime: 'video/webm;codecs=vp9' },
  overlay: { bytes: 90_000 },
  endCard: { bytes: 60_000 },
};

describe('the recipe the booth sends', () => {
  it('is what the booth gives its own renderer, minus the media, and validates against the shared schema', () => {
    const r = buildRecipe(plan(), files);
    expect(r.version).toBe(2);
    expect(r.output).toEqual({ width: 720, height: 1280, fps: 30, bitrate: 3_500_000 });
    expect(r.effects).toEqual([{ id: 'confetti', intensity: 1, colorMode: null }]);
    expect(r.beats).toEqual([0.5, 1]);
    expect(r.files.original).toEqual({ bytes: 5_000_000, mime: 'video/webm' });
    expect(r.files.overlay).toEqual({ bytes: 90_000, mime: 'image/png' });
    expect(r.endCard).toEqual({ seconds: 2 });
    expect(r.derive).toEqual({ poster: true, small: true });
  });

  it('asks for the lighter copy only when the event wants it', () => {
    expect(buildRecipe(plan({ smallCopy: false }), files).derive).toEqual({ poster: true, small: false });
  });

  it('has no end card unless the booth drew one', () => {
    const r = buildRecipe(plan(), { ...files, endCard: null });
    expect(r.endCard).toBeNull();
    expect(r.files.endCard).toBeNull();
    expect(buildRecipe(plan({ endCardSeconds: null }), files).endCard).toBeNull();
  });

  it('without the library assets (when the server can not use one) keeps a colour or blur background', () => {
    const stripped = buildRecipe(plan(), files, { stripAssets: true });
    expect(stripped.music).toBeNull();
    expect(stripped.intro).toBeNull();
    expect(stripped.background).toBeNull();
    expect(buildRecipe(plan({ background: { kind: 'blur' } }), files, { stripAssets: true }).background).toEqual({
      kind: 'blur',
    });
    expect(
      buildRecipe(plan({ background: { kind: 'color', color: '#00ff88' } }), files, { stripAssets: true }).background,
    ).toEqual({ kind: 'color', color: '#00ff88' });
  });

  it('refuses a recording the server can not render, before anything is uploaded', () => {
    expect(() => buildRecipe(plan(), { ...files, original: { bytes: 10, mime: 'video/x-matroska' } })).toThrow(
      RangeError,
    );
    expect(() => buildRecipe(plan(), { ...files, original: { bytes: 2 * 1024 ** 3, mime: 'video/mp4' } })).toThrow();
  });

  it('reads the recording types it takes', () => {
    expect(originalMime('video/webm;codecs=vp9')).toBe('video/webm');
    expect(originalMime('VIDEO/MP4')).toBe('video/mp4');
    expect(originalMime('video/quicktime')).toBe('video/quicktime');
    expect(originalMime('video/ogg')).toBeNull();
    expect(originalMime('')).toBeNull();
  });
});

describe('the library assets as the recipe names them', () => {
  const assets = new Map([
    ['pic', { mime: 'image/png', durationMs: null }],
    ['clip', { mime: 'video/mp4', durationMs: 1500 }],
    ['long', { mime: 'video/mp4', durationMs: 60_000 }],
    ['unknownlength', { mime: 'video/mp4', durationMs: null }],
    ['tiny', { mime: 'video/mp4', durationMs: 100 }],
    ['song', { mime: 'audio/mpeg', durationMs: 90_000 }],
  ]);

  it('a still card is as long as the card; a clip is capped by the card and by its own length', () => {
    expect(describeCard('pic', assets, 3)).toEqual({ assetId: 'pic', kind: 'image', seconds: 3 });
    expect(describeCard('clip', assets, 3)).toEqual({ assetId: 'clip', kind: 'video', seconds: 1.5 });
    expect(describeCard('long', assets, 3)).toEqual({ assetId: 'long', kind: 'video', seconds: 3 });
    expect(describeCard('unknownlength', assets, 3)).toEqual({ assetId: 'unknownlength', kind: 'video', seconds: 3 });
    expect(describeCard('tiny', assets, 3)?.seconds).toBe(0.5); // the recipe's floor
  });

  it('a card that is not there, or not a picture or video, is left out', () => {
    expect(describeCard(null, assets, 3)).toBeNull();
    expect(describeCard('missing', assets, 3)).toBeNull();
    expect(describeCard('song', assets, 3)).toBeNull();
  });

  it('describes the background by kind', () => {
    expect(describeBackground(null, assets)).toBeNull();
    expect(describeBackground({ color: '#112233' }, assets)).toEqual({ kind: 'color', color: '#112233' });
    expect(describeBackground({ blur: true }, assets)).toEqual({ kind: 'blur' });
    expect(describeBackground({ assetId: 'pic' }, assets)).toEqual({ kind: 'image', assetId: 'pic' });
    expect(describeBackground({ assetId: 'clip' }, assets)).toEqual({ kind: 'video', assetId: 'clip' });
    expect(describeBackground({ assetId: 'missing' }, assets)).toBeNull();
    expect(describeBackground({ assetId: 'song' }, assets)).toBeNull();
  });
});

describe('what the booth makes of a failed call', () => {
  const err = (status: number, code: string, retryAfterS: number | null = null, scope: string | null = null) =>
    new ServerApiError(status, code, retryAfterS, scope);

  it('waits and tries again for a network error, with a growing delay', () => {
    expect(outcomeOf(new TypeError('Failed to fetch'), 0, false)).toEqual({ kind: 'retry', inMs: 5_000, note: null });
    expect(retryDelayMs(1)).toBe(5_000);
    expect(retryDelayMs(2)).toBe(10_000);
    expect(retryDelayMs(3)).toBe(20_000);
    expect(retryDelayMs(99)).toBe(120_000);
  });

  it('shows the limit and waits for it when the hour or the day is used up', () => {
    expect(outcomeOf(err(429, 'render_rate_limited', 90, 'event_hourly'), 0, false)).toEqual({
      kind: 'retry',
      inMs: 90_000,
      note: 'server_rate_limited',
    });
    // Never sooner than a minute, however short the server's hint.
    expect(outcomeOf(err(429, 'render_rate_limited', 3, 'org_daily'), 0, false)).toMatchObject({ inMs: 60_000 });
    expect(outcomeOf(err(429, 'render_rate_limited', null, 'event_hourly'), 0, false)).toMatchObject({ inMs: 60_000 });
  });

  it('fails the take when the event’s total is used up: waiting would never help', () => {
    expect(outcomeOf(err(429, 'render_rate_limited', 0, 'event_total'), 0, false)).toEqual({
      kind: 'fail',
      error: 'server_limit',
    });
  });

  it('fails the take when the deployment has no render worker', () => {
    expect(outcomeOf(err(503, 'server_render_unavailable'), 0, false)).toEqual({
      kind: 'fail',
      error: 'server_unavailable',
    });
  });

  it('drops the library assets once when the server can not use one, then gives up', () => {
    expect(outcomeOf(err(422, 'asset_invalid'), 0, false)).toEqual({ kind: 'strip_assets' });
    expect(outcomeOf(err(422, 'asset_invalid'), 0, true)).toEqual({ kind: 'fail', error: 'server_failed' });
  });

  it('retries what is only a matter of time: not registered yet, files still arriving, a busy server, a bad signature', () => {
    for (const [status, code] of [
      [404, 'take_not_registered'],
      [404, 'session_not_found'],
      [409, 'files_incomplete'],
      [503, 'storage_unavailable'],
      [403, 'storage_403'],
      [429, 'device_rate_limited'],
      [500, 'http_500'],
    ] as const)
      expect(outcomeOf(err(status, code), 1, false), code).toMatchObject({ kind: 'retry' });
  });

  it('gives up on a server that keeps giving the same error', () => {
    expect(outcomeOf(err(503, 'storage_unavailable'), MAX_ANSWERS - 1, false).kind).toBe('retry');
    expect(outcomeOf(err(503, 'storage_unavailable'), MAX_ANSWERS, false)).toEqual({
      kind: 'fail',
      error: 'server_failed',
    });
  });

  it('fails at once for a recording or recipe that can never be sent', () => {
    expect(outcomeOf(new RangeError('no'), 0, false)).toEqual({ kind: 'fail', error: 'server_upload' });
    const zod = Object.assign(new Error('bad'), { name: 'ZodError' });
    expect(outcomeOf(zod, 0, false)).toEqual({ kind: 'fail', error: 'server_upload' });
    expect(outcomeOf(err(400, 'invalid'), 0, false)).toEqual({ kind: 'fail', error: 'server_failed' });
    // The guest erased the session, the platform took it down, or it expired: nothing to render for.
    expect(outcomeOf(err(410, 'session_gone'), 0, false)).toEqual({ kind: 'fail', error: 'server_failed' });
  });

  it('turns an outcome into what is written to the take', () => {
    expect(resultOf({ kind: 'retry', inMs: 20_000, note: 'server_rate_limited' }, 2, NOW)).toEqual({
      kind: 'wait',
      patch: { serverCheckAt: NOW + 20_000, serverAttempts: 3, error: 'server_rate_limited' },
    });
    expect(resultOf({ kind: 'retry', inMs: 5_000, note: null }, 0, NOW).patch.error).toBeUndefined();
    expect(resultOf({ kind: 'strip_assets' }, 4, NOW)).toEqual({
      kind: 'wait',
      patch: { serverStripped: true, serverCheckAt: NOW, serverAttempts: 0, error: undefined },
    });
    expect(resultOf({ kind: 'fail', error: 'server_limit' }, 4, NOW)).toEqual({
      kind: 'failed',
      error: 'server_limit',
      patch: {},
    });
  });
});

describe('what a server job’s state means for the take', () => {
  const job = (
    status: ServerRenderJobView['status'],
    error: ServerRenderJobView['error'] = null,
  ): ServerRenderJobView => ({
    id: 'job-1',
    status,
    attempts: 1,
    error,
    renderMs: status === 'done' ? 41_000 : null,
  });

  it('keeps asking, every few seconds, while the job is queued or rendering', () => {
    for (const status of ['queued', 'running'] as const)
      expect(progressOf(job(status), NOW)).toEqual({
        kind: 'wait',
        patch: { serverJobId: 'job-1', serverCheckAt: NOW + POLL_MS, serverAttempts: 0, error: undefined },
      });
  });

  it('marks the take rendered when the job is done', () => {
    expect(progressOf(job('done'), NOW)).toEqual({
      kind: 'rendered',
      patch: { serverJobId: 'job-1' },
      renderMs: 41_000,
    });
  });

  it('fails the take with the job’s own reason when it is one the operator can read, and a general one otherwise', () => {
    expect(progressOf(job('failed', 'undecodable'), NOW)).toMatchObject({ kind: 'failed', error: 'undecodable' });
    expect(progressOf(job('failed', 'encoder_stall'), NOW)).toMatchObject({ error: 'encoder_stall' });
    expect(progressOf(job('failed', 'timeout'), NOW)).toMatchObject({ error: 'server_failed' });
    expect(jobFailure(null)).toBe('server_failed');
  });
});

describe('a take that failed on the server', () => {
  const job = (status: ServerRenderJobView['status']): ServerRenderJobView => ({
    id: 'job-1',
    status,
    attempts: 1,
    error: null,
    renderMs: status === 'done' ? 41_000 : null,
  });

  it('is looked at again later, in case the operator started the job again from the studio', () => {
    expect(recheckOf(job('failed'), NOW)).toEqual({ kind: 'idle', patch: { serverCheckAt: NOW + FAILED_RECHECK_MS } });
    expect(recheckOf(null, NOW)).toEqual({ kind: 'idle', patch: { serverCheckAt: NOW + FAILED_RECHECK_MS } });
  });

  it('follows the job once it moves: back to waiting while it renders, rendered when it is done', () => {
    expect(recheckOf(job('queued'), NOW)).toMatchObject({ kind: 'wait', patch: { serverJobId: 'job-1' } });
    expect(recheckOf(job('running'), NOW).kind).toBe('wait');
    expect(recheckOf(job('done'), NOW)).toEqual({
      kind: 'rendered',
      patch: { serverJobId: 'job-1' },
      renderMs: 41_000,
    });
  });

  it('is watched only while it has a job to look at', () => {
    expect(watchesServer({ status: 'server' })).toBe(true);
    expect(watchesServer({ status: 'failed', renderPath: 'server', serverJobId: 'j', serverCheckAt: 1 })).toBe(true);
    // A take the booth itself gave up on (the event's limit, say) has no job.
    expect(watchesServer({ status: 'failed', renderPath: 'server' })).toBe(false);
    // A failure on this device is the device's to retry.
    expect(watchesServer({ status: 'failed', renderPath: 'wasm', serverJobId: 'j', serverCheckAt: 1 })).toBe(false);
    // The operator pressed Retry on the booth: nothing of the old job is left.
    expect(watchesServer({ status: 'recorded', renderPath: 'server' })).toBe(false);
    expect(watchesServer({ status: 'rendered', renderPath: 'server', serverJobId: 'j' })).toBe(false);
  });
});

describe('one step of a take on the server', () => {
  const view = (
    status: ServerRenderJobView['status'],
    error: ServerRenderJobView['error'] = null,
  ): ServerRenderJobView => ({
    id: 'job-1',
    status,
    attempts: 0,
    error,
    renderMs: null,
  });

  function fake(
    opts: { stored?: string[]; job?: ServerRenderJobView | null; sessionId?: string | null; fail?: Error } = {},
  ) {
    const log: string[] = [];
    const sent: { recipe?: RenderRecipe; sessionId?: string } = {};
    const api: ServerRenderApi = {
      requestFiles: async (takeId, declared) => {
        log.push(`files:${declared.map((f) => f.role).join('+')}`);
        if (opts.fail) throw opts.fail;
        const uploads: ServerFileTicket[] = declared
          .filter((f) => !(opts.stored ?? []).includes(f.role))
          .map((f) => ({
            role: f.role,
            url: `https://storage.example/${takeId}/${f.role}`,
            method: 'PUT',
            headers: {},
          }));
        return { uploads, stored: (opts.stored ?? []) as never };
      },
      put: async (ticket, body) => {
        log.push(`put:${ticket.role}:${body.size}`);
      },
      requestRender: async (_takeId, input) => {
        log.push('render');
        sent.recipe = input.recipe;
        sent.sessionId = input.sessionId;
        return view('queued');
      },
      job: async () => {
        log.push('job');
        return opts.job === undefined ? view('running') : opts.job;
      },
    };
    const prepared = (): PreparedJob => ({
      plan: plan(),
      original: new Blob([new Uint8Array(1000)]),
      originalMime: 'video/webm',
      overlay: new Blob([new Uint8Array(10)]),
      endCard: new Blob([new Uint8Array(20)]),
    });
    const deps: ServerStepDeps = {
      api,
      sessionId: async () => (opts.sessionId === undefined ? 'session-1' : opts.sessionId),
      prepare: async () => {
        log.push('prepare');
        return prepared();
      },
    };
    return { deps, log, sent };
  }

  const take = { id: 'take-1' };

  it('uploads the files, queues the job, and then waits for it', async () => {
    const f = fake();
    const step = await serverStep(take, f.deps, NOW);
    expect(f.log).toEqual([
      'prepare',
      'files:original+overlay+end_card',
      'put:original:1000',
      'put:overlay:10',
      'put:end_card:20',
      'render',
    ]);
    expect(f.sent.sessionId).toBe('session-1');
    expect(f.sent.recipe?.files.original.bytes).toBe(1000);
    expect(step).toMatchObject({ kind: 'wait', patch: { serverJobId: 'job-1', serverCheckAt: NOW + POLL_MS } });
  });

  it('uploads only what is not in storage yet (a booth that lost its connection part-way carries on)', async () => {
    const f = fake({ stored: ['original'] });
    await serverStep(take, f.deps, NOW);
    expect(f.log.filter((l) => l.startsWith('put'))).toEqual(['put:overlay:10', 'put:end_card:20']);
  });

  it('does not upload twice: once there is a job, it only asks about it', async () => {
    const f = fake({ job: view('done') });
    const step = await serverStep({ ...take, serverJobId: 'job-1' }, f.deps, NOW);
    expect(f.log).toEqual(['job']);
    expect(step.kind).toBe('rendered');
  });

  it('submits again if the server has no job for a take that thinks it has one', async () => {
    const f = fake({ job: null });
    await serverStep({ ...take, serverJobId: 'job-gone' }, f.deps, NOW);
    expect(f.log).toContain('render');
  });

  it('waits for the guest’s session to be registered before naming it', async () => {
    const f = fake({ sessionId: null });
    expect(await serverStep(take, f.deps, NOW)).toEqual({ kind: 'wait', patch: { serverCheckAt: NOW + 5_000 } });
    expect(f.log).toEqual([]);
  });

  it('retries a network failure with a growing delay, counting it', async () => {
    const f = fake({ fail: new TypeError('Failed to fetch') });
    expect(await serverStep({ ...take, serverAttempts: 2 }, f.deps, NOW)).toEqual({
      kind: 'wait',
      patch: { serverCheckAt: NOW + 10_000, serverAttempts: 3, error: undefined },
    });
  });

  it('goes without the library assets once when the server can not use one', async () => {
    const f = fake({ fail: new ServerApiError(422, 'asset_invalid') });
    expect(await serverStep(take, f.deps, NOW)).toMatchObject({ kind: 'wait', patch: { serverStripped: true } });
    const again = fake();
    await serverStep({ ...take, serverStripped: true }, again.deps, NOW);
    expect(again.sent.recipe?.music).toBeNull();
    expect(again.sent.recipe?.intro).toBeNull();
    expect(again.sent.recipe?.background).toBeNull();
  });

  it('fails the take, with a reason, when the event’s limit is used up', async () => {
    const f = fake({ fail: new ServerApiError(429, 'render_rate_limited', 0, 'event_total') });
    expect(await serverStep(take, f.deps, NOW)).toMatchObject({ kind: 'failed', error: 'server_limit' });
  });
});
