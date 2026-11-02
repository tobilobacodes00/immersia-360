/* eslint-disable no-console -- a command-line program: its output is the log */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RenderRecipe } from '@immersia/shared/render';
import type { SmokeCheck } from '../page/protocol';
import type { ClaimedJob, WorkerApi } from './api';
import { ChromeHost } from './chrome';
import { startFileServer } from './file-server';
import { fileIO } from './files';
import { renderIO } from './render-io';
import { runJob, type JobIO } from './runner';

/**
 * CI's smoke test of the render worker, with real Chrome and the real bundle (scripts/smoke.mjs builds
 * both, then runs this):
 *
 *  1. In the page: recipes rendered through the worker's own `renderFromRecipe`, with the render engine's
 *     test fixture as the recording, and the output decoded and checked (page/smoke-entry.ts).
 *  2. End to end on the worker's side: one job through `runJob` with the production page, the local file
 *     server and Chrome, against a fake server. What would be uploaded is checked for being an MP4 that
 *     starts playing at once (faststart), a JPEG poster and the lighter copy.
 *
 * Exit code 1 on any failed check.
 */

const log = (message: string, extra: Record<string, unknown> = {}) =>
  console.log(`  [worker] ${message} ${Object.keys(extra).length ? JSON.stringify(extra) : ''}`);

let failures = 0;
function report(name: string, ok: boolean, detail = '') {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
}

const hasBox = (bytes: Uint8Array, box: string, within = bytes.length) =>
  Buffer.from(bytes.subarray(0, within)).includes(Buffer.from(box, 'latin1'));

async function main() {
  const dist = fileURLToPath(new URL('./', import.meta.url));
  const server = await startFileServer({ page: join(dist, 'page'), smoke: join(dist, 'smoke') });
  const chrome = new ChromeHost({
    channel: process.env.CHROME_CHANNEL ?? 'chrome',
    executablePath: process.env.CHROME_PATH ?? null,
    log,
  });
  const work = await mkdtemp(join(tmpdir(), 'render-smoke-'));
  try {
    // 1. In the page.
    const { page, close } = await chrome.open();
    await page.goto(`${server.base}/smoke/index.html`, { waitUntil: 'load' });
    await page.waitForFunction('typeof window.__smoke === "function"', null, { timeout: 30_000 });
    const checks = await page.evaluate((base) => window.__smoke!(base), `${server.base}/page/mediapipe`);
    for (const c of checks as SmokeCheck[]) report(c.name, c.ok, c.detail);
    const clipBase64 = await page.evaluate(() => window.__fixtureClip!());
    await close();
    const clip = Buffer.from(clipBase64, 'base64');

    // 2. Through the worker's own pipeline.
    const recipe: RenderRecipe = {
      version: 2,
      output: { width: 640, height: 480, fps: 30, bitrate: 6_000_000 },
      preset: 'balanced',
      slowMotion: { enabled: false, startS: 0, endS: 0, speed: 1 },
      reverse: 'none',
      look: null,
      effects: [],
      beats: [],
      seed: 1,
      music: null,
      background: null,
      intro: null,
      outro: null,
      endCard: null,
      files: { original: { bytes: clip.length, mime: 'video/mp4' }, overlay: null, endCard: null },
      derive: { poster: true, small: true },
    };
    const job: ClaimedJob = {
      id: '0198f7a0-6b1c-7d3e-8f4a-5b6c7d8e9f10',
      claimToken: 'smoke-claim-token-0123456789abcdef',
      attempts: 1,
      maxAttempts: 3,
      leaseMs: 300_000,
      recipe,
      urls: {
        original: 'unused',
        overlay: null,
        endCard: null,
        intro: null,
        outro: null,
        music: null,
        background: null,
      },
    };
    const uploaded = new Map<string, Buffer>();
    const reported: string[] = [];
    const api: WorkerApi = {
      claim: async () => null,
      heartbeat: async () => 'ok',
      registerOutputs: async (_id, _token, outputs) =>
        outputs.map((o) => ({
          kind: o.kind,
          outputId: o.kind,
          url: 'http://unused.invalid',
          method: 'PUT',
          headers: {},
        })),
      complete: async () => 'ok',
      fail: async (_id, _token, code) => {
        reported.push(code);
        return true;
      },
    };
    const io: JobIO = {
      ...fileIO(work),
      ...renderIO({ server, chrome, log }),
      // The fixture stands in for the download; the files are read here instead of PUT to storage.
      download: async (_job, dir) => writeFile(join(dir, 'original'), clip),
      upload: async (ticket, file) => {
        uploaded.set(file.kind, await readFile(file.path));
      },
    };
    const result = await runJob(job, api, io, { heartbeatMs: 60_000, maxRenderMs: 10 * 60_000, log });
    report(
      'pipeline: the job finishes',
      result === 'done',
      `${result}${reported.length ? ` (reported ${reported})` : ''}`,
    );
    const mp4 = uploaded.get('mp4');
    report('pipeline: an MP4 is produced', Boolean(mp4) && hasBox(mp4!, 'ftyp', 16), `${mp4?.length ?? 0} bytes`);
    report('pipeline: it starts playing at once (moov first)', Boolean(mp4) && hasBox(mp4!, 'moov', 8192), '');
    report('pipeline: the poster is a JPEG', uploaded.get('poster')?.subarray(0, 2).toString('hex') === 'ffd8', '');
    report(
      'pipeline: the lighter copy is an MP4',
      Boolean(uploaded.get('small_mp4')) && hasBox(uploaded.get('small_mp4')!, 'ftyp', 16),
      '',
    );
  } finally {
    await chrome.close();
    await server.close();
    await rm(work, { recursive: true, force: true });
  }
}

main()
  .catch((err: unknown) => {
    console.error(err);
    failures++;
  })
  .finally(() => {
    console.log(failures ? `\n${failures} check(s) failed` : '\nrender worker smoke test passed');
    // Not process.exit(): straight after Chrome and the sockets that can trip a libuv assertion on Windows.
    process.exitCode = failures ? 1 : 0;
  });
