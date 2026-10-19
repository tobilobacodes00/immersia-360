import { expect, test } from '@playwright/test';
import { open } from './helpers';
import { expectRecording, reportPageErrors, setupEvent, startBooth } from './booth-helpers';

/**
 * 360 capture (M2). Chrome uses its fake camera; WebKit has none in CI, so those runs pick the
 * simulated camera (a real canvas MediaStream), which exercises the same recorder and storage.
 */

test.beforeEach(({ page }) => reportPageErrors(page));

test.describe('360 capture (CAP-1, 3, 5, 7, 8) @media', () => {
  test('records a spin, auto-stops, and keeps the camera open for the next guest', async ({ page, browserName }) => {
    const id = await setupEvent(page, { spin: 3 });
    await startBooth(page, id, browserName);
    await page.getByRole('button', { name: 'Tap to start' }).click();
    await expectRecording(page);
    await expect(page.getByText('Saved. Next guest!')).toBeVisible({ timeout: 10_000 });
    // CAP-7: straight back to ready without restarting the camera.
    await expect(page.getByRole('button', { name: 'Tap to start' })).toBeVisible({ timeout: 5_000 });
    // The take renders in the background once the ready screen settles (VID-9), so it is waiting,
    // rendering or already rendered — never failed.
    await expect(page.getByRole('button', { name: /^(1 take waiting|Nothing waiting)$/ })).toBeVisible();

    await page.getByRole('button', { name: 'Booth settings' }).click();
    const drawer = page.getByRole('dialog', { name: 'Booth settings' });
    await expect(drawer.getByText(/^(Ready to render|Rendering|Rendered)$/)).toBeVisible();
    await expect(drawer.getByText(/Saved to (device|browser) storage/)).toBeVisible();
  });

  test('starts from the keyboard and Bluetooth-remote keys', async ({ page, browserName }) => {
    const id = await setupEvent(page, { spin: 3 });
    await startBooth(page, id, browserName);
    await page.keyboard.press('PageDown');
    await expectRecording(page);
    await page.keyboard.press('End');
    await expect(page.getByText('Saved. Next guest!')).toBeVisible({ timeout: 10_000 });
  });

  test('a countdown runs before recording', async ({ page, browserName }) => {
    const id = await setupEvent(page, { spin: 3, countdown: 2 });
    await startBooth(page, id, browserName);
    await page.getByRole('button', { name: 'Tap to start' }).click();
    await expect(page.getByRole('timer', { name: 'Recording in 2' })).toBeVisible();
    await expectRecording(page);
  });

  test('recovers a take after the page dies mid-recording (zero clip loss)', async ({ page, browserName }) => {
    const id = await setupEvent(page, { spin: 10 });
    await startBooth(page, id, browserName);
    await page.getByRole('button', { name: 'Tap to start' }).click();
    await expectRecording(page);
    await page.waitForTimeout(2600); // at least two 1 s chunks flushed
    await page.reload();
    // Diagnostics: what the device database holds after the "crash".
    const takes = await page.evaluate(
      () =>
        new Promise<unknown>((resolve) => {
          const req = indexedDB.open('immersia-booth');
          req.onsuccess = () => {
            const tx = req.result.transaction('takes', 'readonly');
            const all = tx.objectStore('takes').getAll();
            all.onsuccess = () =>
              resolve(
                (all.result as { status: string; chunks: number; bytes: number }[]).map((t) => ({
                  status: t.status,
                  chunks: t.chunks,
                  bytes: t.bytes,
                })),
              );
          };
          req.onerror = () => resolve(String(req.error));
        }),
    );
    console.log('[takes after reload]', JSON.stringify(takes));
    await expect(page.getByText('Recovered 1 take that was interrupted.')).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: 'Start booth' }).click();
    await page.getByRole('button', { name: 'Booth settings' }).click();
    await expect(
      page.getByRole('dialog', { name: 'Booth settings' }).getByText('Recovered', { exact: true }),
    ).toBeVisible();
  });
});

test.describe('motion trigger (CAP-4) @media', () => {
  test('the simulated spinning platform starts a recording on its own', async ({ page }) => {
    const id = await setupEvent(page, { spin: 3 });
    // The simulator pans continuously, like a platform turning.
    await page.addInitScript(() =>
      localStorage.setItem(
        'immersia.booth.camera.v1',
        JSON.stringify({ source: 'simulator', deviceId: null, mirror: false }),
      ),
    );
    await open(page, `/booth/${id}`);
    await page.getByRole('button', { name: 'Register and continue' }).click();
    await page.getByRole('button', { name: 'Start booth' }).click();
    await page.getByRole('button', { name: 'Booth settings' }).click();
    await page.getByRole('switch', { name: 'Start on motion' }).click();
    await page.getByRole('button', { name: 'Close' }).click();
    await expect(page.getByText('Motion start on')).toBeVisible();
    await expectRecording(page, 10_000);
  });
});

test.describe('import (CAP-12) @media', () => {
  test('imports a video file as a take', async ({ page, browserName }) => {
    const id = await setupEvent(page, { spin: 3 });
    await startBooth(page, id, browserName);
    // Make a real 1 s clip in the page with MediaRecorder, then import it through the file picker.
    const bytes = await page.evaluate(async () => {
      const c = document.createElement('canvas');
      c.width = 320;
      c.height = 240;
      const ctx = c.getContext('2d')!;
      const stream = c.captureStream(30);
      const mime = ['video/mp4', 'video/webm'].find((m) => MediaRecorder.isTypeSupported(m))!;
      const rec = new MediaRecorder(stream, { mimeType: mime });
      const parts: Blob[] = [];
      rec.ondataavailable = (e) => parts.push(e.data);
      let f = 0;
      const id = setInterval(() => {
        ctx.fillStyle = `hsl(${(f += 12) % 360} 70% 50%)`;
        ctx.fillRect(0, 0, 320, 240);
      }, 33);
      rec.start();
      await new Promise((r) => setTimeout(r, 1000));
      rec.stop();
      await new Promise((r) => (rec.onstop = r));
      clearInterval(id);
      const buf = new Uint8Array(await new Blob(parts, { type: mime }).arrayBuffer());
      return { data: Array.from(buf), mime };
    });
    await page.getByRole('button', { name: 'Booth settings' }).click();
    await page.getByLabel('Import videos').setInputFiles({
      name: bytes.mime === 'video/mp4' ? 'guest.mp4' : 'guest.webm',
      mimeType: bytes.mime,
      buffer: Buffer.from(bytes.data),
    });
    await expect(
      page.getByRole('dialog', { name: 'Booth settings' }).getByText('Imported', { exact: true }),
    ).toBeVisible();
  });
});

test.describe('graceful degradation', () => {
  test('a browser without MediaRecorder gets an explanation, not a crash', async ({ page, browserName }) => {
    test.skip(browserName !== 'webkit', 'Only WebKitGTK lacks MediaRecorder');
    const id = await setupEvent(page, { spin: 3 });
    await startBooth(page, id, browserName);
    await page.getByRole('button', { name: 'Tap to start' }).click();
    await expect(page.getByRole('alert').filter({ hasText: "This browser can't record video" })).toBeVisible({
      timeout: 10_000,
    });
  });
});
