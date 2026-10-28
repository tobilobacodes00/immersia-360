import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { outputPath, startFileServer, type FileServer } from '../src/file-server';

let root: string;
let pageDir: string;
let jobDir: string;
let server: FileServer;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'render-fs-test-'));
  pageDir = join(root, 'page');
  jobDir = join(root, 'job');
  await mkdir(join(pageDir, 'mediapipe'), { recursive: true });
  await mkdir(jobDir);
  await writeFile(join(pageDir, 'index.html'), '<!doctype html>');
  await writeFile(join(pageDir, 'render.js'), 'export {}');
  await writeFile(join(pageDir, 'mediapipe', 'm.wasm'), Buffer.from([0, 97, 115, 109]));
  await writeFile(join(root, 'secret.txt'), 'not for the page');
  await writeFile(join(jobDir, 'original'), 'the guest recording');
  server = await startFileServer({ page: pageDir });
});
afterAll(async () => {
  await server.close();
  await rm(root, { recursive: true, force: true });
});

const get = (path: string) => fetch(`${server.base}${path}`);
const put = (path: string, body: string) => fetch(`${server.base}${path}`, { method: 'PUT', body });

describe('the worker’s local file server', () => {
  it('serves the render page and its assets with the right types', async () => {
    const html = await get('/page/index.html');
    expect(html.status).toBe(200);
    expect(html.headers.get('content-type')).toContain('text/html');
    expect((await get('/page/render.js')).headers.get('content-type')).toContain('text/javascript');
    expect((await get('/page/mediapipe/m.wasm')).headers.get('content-type')).toBe('application/wasm');
    expect((await get('/page/')).status).toBe(200); // the index
  });

  it('answers only to its random token: another process on the machine can not read a recording', async () => {
    const origin = new URL(server.base).origin;
    expect((await fetch(`${origin}/page/index.html`)).status).toBe(404);
    expect((await fetch(`${origin}/wrong-token/page/index.html`)).status).toBe(404);
    expect(server.base).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/[A-Za-z0-9_-]{20,}$/);
  });

  it('never serves a file outside the page directory, however the path is spelled', async () => {
    for (const p of [
      '/page/../secret.txt',
      '/page/%2e%2e/secret.txt',
      '/page/..%2fsecret.txt',
      '/page/mediapipe/../../secret.txt',
    ])
      expect((await get(p)).status, p).toBe(404);
  });

  it('serves the job’s files only while a job is set, and only the names a job has', async () => {
    expect((await get('/job/original')).status).toBe(404);
    server.setJobDir(jobDir);
    const res = await get('/job/original');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('the guest recording');
    expect((await get('/job/overlay')).status).toBe(404); // a name a job has, but no such file
    expect((await get('/job/secret.txt')).status).toBe(404); // not a name a job has
    expect((await get('/job/..%2fsecret.txt')).status).toBe(404);
    server.setJobDir(null);
    expect((await get('/job/original')).status).toBe(404);
  });

  it('takes the results by PUT into the job directory, and refuses anything else', async () => {
    expect((await put('/out/mp4', 'x')).status).toBe(404); // no job
    server.setJobDir(jobDir);
    expect((await put('/out/mp4', 'video bytes')).status).toBe(204);
    expect((await readFile(outputPath(jobDir, 'mp4'))).toString()).toBe('video bytes');
    expect((await put('/out/poster', 'jpeg')).status).toBe(204);
    expect((await put('/out/../../escape', 'x')).status).toBe(404);
    expect((await put('/out/original', 'overwrite the recording')).status).toBe(404);
    expect((await readFile(join(jobDir, 'original'))).toString()).toBe('the guest recording');
    expect((await fetch(`${server.base}/out/mp4`, { method: 'POST', body: 'x' })).status).toBe(404);
    server.setJobDir(null);
  });
});
