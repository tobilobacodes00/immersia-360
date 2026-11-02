import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { WorkerOutputTicket } from '@immersia/shared/render';
import type { ClaimedJob } from '../src/api';
import { HttpStatusError, download, fileIO, putFile } from '../src/files';
import { JobError } from '../src/runner';

/** A storage stand-in: serves what is in `objects`, takes PUTs, and can be told to misbehave. */
let server: http.Server;
let base = '';
const objects = new Map<string, Buffer>();
const hits = new Map<string, number>();
let failFirst: Record<string, number> = {};
let lastPut: { path: string; headers: http.IncomingHttpHeaders; body: Buffer } | null = null;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const path = req.url ?? '';
    hits.set(path, (hits.get(path) ?? 0) + 1);
    if ((failFirst[path] ?? 0) > 0) {
      failFirst[path]!--;
      res.writeHead(503).end();
      return;
    }
    if (req.method === 'PUT') {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        lastPut = { path, headers: req.headers, body: Buffer.concat(chunks) };
        res.writeHead(path.includes('forbidden') ? 403 : 200).end();
      });
      return;
    }
    const body = objects.get(path);
    if (!body) res.writeHead(path.includes('forbidden') ? 403 : 404).end();
    else res.writeHead(200, { 'content-length': body.length }).end(body);
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((ok) => server.close(() => ok())));

const signal = () => new AbortController().signal;
/** A fresh temporary directory; each test removes its own when done. */
const fresh = () => mkdtemp(join(tmpdir(), 'render-files-test-'));

describe('download', () => {
  it('streams an object to disk', async () => {
    objects.set('/a', Buffer.from('hello world'));
    const d = await fresh();
    expect(await download(`${base}/a`, join(d, 'a'), signal())).toBe(11);
    expect((await readFile(join(d, 'a'))).toString()).toBe('hello world');
    await rm(d, { recursive: true });
  });

  it('retries a 5xx and then succeeds', async () => {
    objects.set('/flaky', Buffer.from('ok'));
    failFirst = { '/flaky': 2 };
    const d = await fresh();
    await download(`${base}/flaky`, join(d, 'f'), signal(), { retryDelayMs: 0 });
    expect(hits.get('/flaky')).toBe(3);
    await rm(d, { recursive: true });
  });

  it('does not retry an answer that will not change (404, 403)', async () => {
    const d = await fresh();
    await expect(download(`${base}/missing`, join(d, 'm'), signal(), { retryDelayMs: 0 })).rejects.toMatchObject({
      status: 404,
    });
    expect(hits.get('/missing')).toBe(1);
    await expect(download(`${base}/forbidden`, join(d, 'x'), signal(), { retryDelayMs: 0 })).rejects.toBeInstanceOf(
      HttpStatusError,
    );
    expect(hits.get('/forbidden')).toBe(1);
    await rm(d, { recursive: true });
  });

  it('stops when aborted', async () => {
    objects.set('/b', Buffer.from('x'));
    const ac = new AbortController();
    ac.abort();
    const d = await fresh();
    await expect(download(`${base}/b`, join(d, 'b'), ac.signal)).rejects.toThrow();
    await rm(d, { recursive: true });
  });
});

describe('putFile', () => {
  const ticket = (path: string): WorkerOutputTicket => ({
    kind: 'mp4',
    outputId: 'o',
    url: `${base}${path}`,
    method: 'PUT',
    headers: { 'content-type': 'video/mp4' },
  });

  it('sends the exact length and type the signature covers, streamed from disk', async () => {
    const d = await fresh();
    const path = join(d, 'video');
    await writeFile(path, Buffer.alloc(5000, 7));
    await putFile(ticket('/up'), { path, bytes: 5000 }, signal());
    expect(lastPut!.headers['content-length']).toBe('5000');
    expect(lastPut!.headers['content-type']).toBe('video/mp4');
    expect(lastPut!.body.length).toBe(5000);
    await rm(d, { recursive: true });
  });

  it('retries a 5xx, but not a refused signature', async () => {
    const d = await fresh();
    const path = join(d, 'v');
    await writeFile(path, Buffer.from('abc'));
    failFirst = { '/up2': 1 };
    await putFile(ticket('/up2'), { path, bytes: 3 }, signal(), { retryDelayMs: 0 });
    expect(hits.get('/up2')).toBe(2);
    await expect(
      putFile(ticket('/forbidden-put'), { path, bytes: 3 }, signal(), { retryDelayMs: 0 }),
    ).rejects.toBeInstanceOf(HttpStatusError);
    expect(hits.get('/forbidden-put')).toBe(1);
    await rm(d, { recursive: true });
  });
});

describe('the files of a job', () => {
  const job = (urls: Partial<ClaimedJob['urls']> = {}): ClaimedJob => ({
    id: 'j',
    claimToken: 't'.repeat(24),
    attempts: 1,
    maxAttempts: 3,
    leaseMs: 1,
    recipe: {} as ClaimedJob['recipe'],
    urls: {
      original: `${base}/orig`,
      overlay: null,
      endCard: null,
      intro: null,
      outro: null,
      music: null,
      background: null,
      ...urls,
    },
  });

  it('downloads the recording and the optional files that exist, under their own names', async () => {
    objects.set('/orig', Buffer.from('recording'));
    objects.set('/song', Buffer.from('song'));
    const io = fileIO(tmpdir(), { retryDelayMs: 0 });
    const d = await io.prepare(job());
    await io.download(job({ music: `${base}/song` }), d, signal());
    expect((await readFile(join(d, 'original'))).toString()).toBe('recording');
    expect((await readFile(join(d, 'music'))).toString()).toBe('song');
    expect(await stat(join(d, 'overlay')).catch(() => null)).toBeNull();
    await io.cleanup(d);
    expect(await stat(d).catch(() => null)).toBeNull();
  });

  it('a recording that is gone fails the job for good; an optional file that is gone is rendered without', async () => {
    const io = fileIO(tmpdir(), { retryDelayMs: 0 });
    const d = await io.prepare(job());
    await expect(io.download(job({ original: `${base}/nope` }), d, signal())).rejects.toMatchObject({
      code: 'source_missing',
    });
    objects.set('/orig', Buffer.from('recording'));
    await io.download(job({ intro: `${base}/gone-intro` }), d, signal());
    expect(await stat(join(d, 'intro')).catch(() => null)).toBeNull();
    await io.cleanup(d);
  });

  it('any other trouble fetching an optional file is a retryable download failure', async () => {
    objects.set('/orig', Buffer.from('recording'));
    failFirst = { '/music-bad': 99 };
    const io = fileIO(tmpdir(), { retryDelayMs: 0 });
    const d = await io.prepare(job());
    const err = await io.download(job({ music: `${base}/music-bad` }), d, signal()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(JobError);
    expect((err as JobError).code).toBe('download_failed');
    await io.cleanup(d);
  });

  it('a claim without a link for the recording is a missing source', async () => {
    const io = fileIO(tmpdir());
    const d = await io.prepare(job());
    await expect(io.download(job({ original: '' }), d, signal())).rejects.toMatchObject({ code: 'source_missing' });
    await io.cleanup(d);
  });
});
