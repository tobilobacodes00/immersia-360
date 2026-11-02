import { describe, expect, it } from 'vitest';
import { ApiError, createApi } from '../src/api';

const cfg = { apiUrl: 'https://immersia.example', secret: 's'.repeat(32), workerId: 'w1' };

/** A fetch that answers from a script and records what it was asked. */
function scripted(...answers: (Response | Error)[]) {
  const seen: { url: string; init: RequestInit }[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    seen.push({ url, init });
    const next = answers.shift() ?? new Response('{}');
    if (next instanceof Error) throw next;
    return next;
  }) as unknown as typeof fetch;
  return { fetchImpl, seen };
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const TOKEN = 'claim-token-0123456789abcdef';

describe('the worker API client', () => {
  it('authenticates every call with the shared secret as a bearer token', async () => {
    const { fetchImpl, seen } = scripted(json({ ok: true }));
    await createApi(cfg, fetchImpl, 0).heartbeat('job-1', TOKEN);
    expect(seen[0]!.url).toBe('https://immersia.example/api/render-worker/jobs/job-1/heartbeat');
    expect((seen[0]!.init.headers as Record<string, string>).authorization).toBe(`Bearer ${cfg.secret}`);
    expect(JSON.parse(seen[0]!.init.body as string)).toEqual({ claimToken: TOKEN });
  });

  it('says whether the lease was extended, lost, or ended by the time limit', async () => {
    const api = (res: Response) => createApi(cfg, scripted(res).fetchImpl, 0);
    expect(await api(json({ ok: true })).heartbeat('j', TOKEN)).toBe('ok');
    expect(await api(json({ error: 'lease_lost' }, 409)).heartbeat('j', TOKEN)).toBe('lease_lost');
    expect(await api(json({ error: 'timeout' }, 409)).heartbeat('j', TOKEN)).toBe('timeout');
  });

  it('retries a network error and a 5xx, then gives the answer', async () => {
    const { fetchImpl, seen } = scripted(
      new Error('network'),
      new Response('oops', { status: 503 }),
      json({ ok: true }),
    );
    expect(await createApi(cfg, fetchImpl, 0).heartbeat('j', TOKEN)).toBe('ok');
    expect(seen).toHaveLength(3);
  });

  it('gives up after four tries', async () => {
    const { fetchImpl, seen } = scripted(...Array.from({ length: 6 }, () => new Response('', { status: 500 })));
    await expect(createApi(cfg, fetchImpl, 0).heartbeat('j', TOKEN)).rejects.toBeInstanceOf(ApiError);
    expect(seen).toHaveLength(4);
  });

  it('does not retry a refusal (a wrong secret is not going to get better)', async () => {
    const { fetchImpl, seen } = scripted(json({ error: 'unauthorized' }, 401));
    await expect(createApi(cfg, fetchImpl, 0).claim()).rejects.toMatchObject({ status: 401, code: 'unauthorized' });
    expect(seen).toHaveLength(1);
  });

  it('claims nothing when the queue is empty', async () => {
    expect(await createApi(cfg, scripted(json({ job: null })).fetchImpl, 0).claim()).toBeNull();
  });

  it('checks the recipe it is handed, and fails a job whose recipe does not validate (for good)', async () => {
    const claim = {
      job: {
        id: 'job-1',
        claimToken: TOKEN,
        attempts: 1,
        maxAttempts: 3,
        leaseMs: 300_000,
        recipe: { version: 1 },
        urls: {},
      },
    };
    const { fetchImpl, seen } = scripted(json(claim), json({ ok: true }));
    expect(await createApi(cfg, fetchImpl, 0).claim()).toBeNull();
    expect(seen[1]!.url).toBe('https://immersia.example/api/render-worker/jobs/job-1/fail');
    expect(JSON.parse(seen[1]!.init.body as string)).toEqual({ claimToken: TOKEN, code: 'invalid_recipe' });
  });

  it('reads outputs, completion and failure answers', async () => {
    const uploads = [{ kind: 'mp4', outputId: 'o', url: 'https://s/x', method: 'PUT', headers: {} }];
    const out = [{ kind: 'mp4' as const, bytes: 10, width: 2, height: 2, durationMs: 1 }];
    expect(await createApi(cfg, scripted(json({ uploads })).fetchImpl, 0).registerOutputs('j', TOKEN, out)).toEqual(
      uploads,
    );
    expect(
      await createApi(cfg, scripted(json({ error: 'lease_lost' }, 409)).fetchImpl, 0).registerOutputs('j', TOKEN, out),
    ).toBe('lease_lost');
    expect(await createApi(cfg, scripted(json({ ok: true })).fetchImpl, 0).complete('j', TOKEN, 5)).toBe('ok');
    expect(
      await createApi(cfg, scripted(json({ error: 'incomplete' }, 409)).fetchImpl, 0).complete('j', TOKEN, 5),
    ).toBe('incomplete');
    expect(
      await createApi(cfg, scripted(json({ error: 'lease_lost' }, 409)).fetchImpl, 0).complete('j', TOKEN, 5),
    ).toBe('lease_lost');
    expect(await createApi(cfg, scripted(json({ ok: true })).fetchImpl, 0).fail('j', TOKEN, 'gpu')).toBe(true);
    expect(
      await createApi(cfg, scripted(json({ error: 'lease_lost' }, 409)).fetchImpl, 0).fail('j', TOKEN, 'gpu'),
    ).toBe(false);
  });
});
