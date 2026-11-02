import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import {
  expectRecording,
  expectResult,
  latestSession,
  reportPageErrors,
  setupEvent,
  startBooth,
} from './booth-helpers';
import { open } from './helpers';

/**
 * The render path ladder (`local` → `wasm` → `server`), end to end.
 *
 * The booth's test hook (a localStorage key, honoured only when the server runs in E2E mode, which it
 * refuses to do on any Vercel deployment) fails chosen rungs on purpose, as if their encoder were missing.
 * The next rung then does the work for real:
 *
 *  - local forced to fail → the WebAssembly encoder renders the take, in this very Chrome, and the device
 *    remembers it;
 *  - local and wasm forced to fail → the take goes to the server rung. No worker runs in CI, so the test
 *    plays the worker's part through the worker endpoints (claim, outputs, complete, fail) with the
 *    shared secret, and checks what the booth, the guest's link and the studio dashboard make of it.
 *
 * Runs in the render project (one at a time, after the others): a software render saturates the runner.
 */

const FORCE_FAIL_KEY = 'immersia.e2e.render-fail';
const WORKER_SECRET = process.env.RENDER_WORKER_SECRET ?? '';

test.beforeEach(({ page }) => reportPageErrors(page));

/** The booth, opened with the given rungs forced to fail. */
async function boothWithFailing(page: Page, rungs: string, browserName: string) {
  const id = await setupEvent(page, { spin: 3, light: true });
  await page.addInitScript(([key, value]) => localStorage.setItem(key!, value!), [FORCE_FAIL_KEY, rungs] as const);
  await startBooth(page, id, browserName);
  return id;
}

/** One guest's take, up to their QR and back to the attract screen. */
async function recordOne(page: Page) {
  await page.getByRole('button', { name: 'Tap to start' }).click();
  await expectRecording(page);
  await expectResult(page);
  const session = await latestSession(page);
  await page.getByRole('button', { name: 'Next guest' }).click();
  await expect(page.getByRole('button', { name: 'Tap to start' })).toBeVisible({ timeout: 5_000 });
  return session;
}

const openQueue = async (page: Page) => {
  await page.getByRole('button', { name: /take(s)? waiting|Rendering|Nothing waiting/ }).click();
  return page.getByRole('dialog', { name: 'Render queue' });
};

test.describe('render ladder (M3, M11) @media', () => {
  test('a take whose local render fails is rendered by the WebAssembly rung, and the device remembers it', async ({
    page,
    browserName,
  }) => {
    test.setTimeout(330_000);
    await boothWithFailing(page, 'local', browserName);
    await recordOne(page);

    const queue = await openQueue(page);
    // The local rung was failed on purpose; the take did not fail with it.
    await expect(queue.getByText('Rendered', { exact: true })).toBeVisible({ timeout: 240_000 });
    await expect(queue.getByText(/compatibility mode/)).toBeVisible();
    await queue.getByRole('button', { name: 'Play' }).click();
    const video = page.getByRole('dialog', { name: 'Rendered video' }).locator('video');
    await expect
      .poll(() => video.evaluate((v: HTMLVideoElement) => (Number.isFinite(v.duration) ? v.duration : 0)), {
        timeout: 15_000,
      })
      .toBeGreaterThan(2);
    // The WebAssembly encoder wrote a video the browser's own decoder plays, at the event's size.
    expect(await video.evaluate((v: HTMLVideoElement) => [v.videoWidth, v.videoHeight])).toEqual([720, 1280]);

    // The rung that worked is the device's record on the server.
    await expect
      .poll(
        async () => {
          await open(page, '/studio/devices');
          return page.getByText('renders on device (slower)').count();
        },
        { timeout: 30_000, intervals: [3_000] },
      )
      .toBeGreaterThan(0);
  });

  test.describe('the server rung', () => {
    test.skip(!WORKER_SECRET, 'the server render worker is not configured (RENDER_WORKER_SECRET)');
    const auth = { authorization: `Bearer ${WORKER_SECRET}` };

    /** The next job of this event, as the worker would claim it (strays from other runs are put aside). */
    async function claim(request: APIRequestContext, eventId: string) {
      let found: Claim | null = null;
      await expect
        .poll(
          async () => {
            for (let i = 0; i < 10 && !found; i++) {
              const res = await request.post('/api/render-worker/claim', {
                headers: auth,
                data: { workerId: 'e2e-worker' },
              });
              expect(res.ok()).toBe(true);
              const { job } = (await res.json()) as { job: Claim | null };
              if (!job) break;
              if (job.urls.original.includes(`/e/${eventId}/`)) found = job;
              else
                await request.post(`/api/render-worker/jobs/${job.id}/fail`, {
                  headers: auth,
                  data: { claimToken: job.claimToken, code: 'source_missing' },
                });
            }
            return found !== null;
          },
          { timeout: 60_000, intervals: [1_000] },
        )
        .toBe(true);
      return found!;
    }

    /** The worker's side of a finished render: register the outputs, upload them, complete the job. */
    async function finish(request: APIRequestContext, job: Claim) {
      const outputs = [
        { kind: 'mp4', bytes: 2048, width: 720, height: 1280, durationMs: 3000 },
        { kind: 'small_mp4', bytes: 1024, width: 720, height: 1280, durationMs: 3000 },
        { kind: 'poster', bytes: 512, width: 720, height: 1280, durationMs: 0 },
      ];
      const registered = await request.post(`/api/render-worker/jobs/${job.id}/outputs`, {
        headers: auth,
        data: { claimToken: job.claimToken, outputs },
      });
      expect(registered.status()).toBe(200);
      const { uploads } = (await registered.json()) as {
        uploads: { kind: string; url: string; headers: Record<string, string> }[];
      };
      expect(uploads.map((u) => u.kind).sort()).toEqual(['mp4', 'poster', 'small_mp4']);
      for (const u of uploads) {
        const bytes = outputs.find((o) => o.kind === u.kind)!.bytes;
        const put = await request.put(u.url, { headers: u.headers, data: Buffer.alloc(bytes, 1) });
        expect(put.ok(), `${u.kind} upload`).toBe(true);
      }
      const done = await request.post(`/api/render-worker/jobs/${job.id}/complete`, {
        headers: auth,
        data: { claimToken: job.claimToken, renderMs: 41_000 },
      });
      expect(done.status()).toBe(200);
    }

    const ready = async (request: APIRequestContext, linkId: string) =>
      ((await (await request.get(`/api/share/${linkId}`)).json()) as { ready: number }).ready;

    test('a take no on-device rung can render goes to the server worker; a failed render can be retried from the studio', async ({
      page,
      request,
      browserName,
    }) => {
      test.setTimeout(300_000);
      const eventId = await boothWithFailing(page, 'local,wasm', browserName);

      // --- A guest's take, handed to the server, finished by the worker.
      const first = await recordOne(page);
      const job = await claim(request, eventId);
      expect(job.attempts).toBe(1);
      // The recipe is the booth's own render settings: the event's 720p/30 fps, 9:16 output.
      expect(job.recipe.output).toMatchObject({ width: 720, height: 1280, fps: 30 });
      expect(job.recipe.files.original.bytes).toBeGreaterThan(1_000);
      // The booth really uploaded the recording, at the size it declared.
      const original = await request.get(job.urls.original);
      expect(original.ok()).toBe(true);
      expect((await original.body()).length).toBe(job.recipe.files.original.bytes);

      // Refused: not this worker, and a made-up claim token.
      const stranger = await request.post(`/api/render-worker/jobs/${job.id}/complete`, {
        headers: { authorization: 'Bearer not-the-secret-not-the-secret-not-the-secret' },
        data: { claimToken: job.claimToken, renderMs: 1 },
      });
      expect(stranger.status()).toBe(401);
      const forged = await request.post(`/api/render-worker/jobs/${job.id}/heartbeat`, {
        headers: auth,
        data: { claimToken: 'x'.repeat(32) },
      });
      expect(forged.status()).toBe(409);
      expect((await request.post('/api/render-worker/claim', { data: { workerId: 'w' } })).status()).toBe(401);

      // The worker's heartbeat keeps the lease, then it finishes.
      const beat = await request.post(`/api/render-worker/jobs/${job.id}/heartbeat`, {
        headers: auth,
        data: { claimToken: job.claimToken },
      });
      expect(beat.status()).toBe(200);
      await finish(request, job);

      // The guest's link now has the video, the lighter copy and the poster, like a booth's own uploads.
      await expect
        .poll(() => ready(request, first.linkId), { timeout: 30_000, intervals: [1_000] })
        .toBeGreaterThanOrEqual(3);
      // The booth noticed (it asks the server about its takes), and says where the video was made.
      const queue = await openQueue(page);
      await expect(queue.getByText('Rendered', { exact: true })).toBeVisible({ timeout: 60_000 });
      await expect(queue.getByText('On the server')).toBeVisible();
      await page.keyboard.press('Escape');

      // --- A take whose render fails for good, then started again from the studio.
      const second = await recordOne(page);
      const doomed = await claim(request, eventId);
      const failed = await request.post(`/api/render-worker/jobs/${doomed.id}/fail`, {
        headers: auth,
        data: { claimToken: doomed.claimToken, code: 'undecodable' },
      });
      expect(failed.status()).toBe(200);
      // Not retried by itself: nothing the next try could change.
      const next = await request.post('/api/render-worker/claim', { headers: auth, data: { workerId: 'w' } });
      expect(((await next.json()) as { job: unknown }).job).toBeNull();

      await open(page, `/studio/events/${eventId}`);
      const panel = page.getByRole('region', { name: 'Server renders' });
      await expect(panel.getByText('Failed · 1')).toBeVisible();
      await expect(panel.getByText("The video format can't be read")).toBeVisible();
      await panel.getByRole('button', { name: 'Try again' }).click();
      await expect(panel.getByText(/Queued again/)).toBeVisible();

      const again = await claim(request, eventId);
      expect(again.id).toBe(doomed.id);
      expect(again.attempts).toBe(1); // a fresh set of tries
      await finish(request, again);
      await expect
        .poll(() => ready(request, second.linkId), { timeout: 30_000, intervals: [1_000] })
        .toBeGreaterThanOrEqual(3);

      await open(page, `/studio/events/${eventId}`);
      await expect(page.getByRole('region', { name: 'Server renders' }).getByText('Done · 2')).toBeVisible();
    });
  });
});

interface Claim {
  id: string;
  claimToken: string;
  attempts: number;
  recipe: {
    output: { width: number; height: number; fps: number; bitrate: number };
    files: { original: { bytes: number; mime: string } };
  };
  urls: { original: string };
}
