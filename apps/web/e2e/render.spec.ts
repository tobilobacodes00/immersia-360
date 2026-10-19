import { expect, test } from '@playwright/test';
import { expectRecording, reportPageErrors, setupEvent, startBooth } from './booth-helpers';

/**
 * The booth's background render (M3), end to end: queue → render worker → MP4 saved on the device →
 * playable. Runs as its own project after the others: a GPU-less runner renders on SwiftShader,
 * which saturates the CPU and would starve timing-sensitive tests running beside it. It uses a
 * 720p/30 fps event: the default 1080p60 takes minutes in software, which measures the runner, not
 * the code (render speed is the M3 benchmark's job, on real devices).
 */

test.beforeEach(({ page }) => reportPageErrors(page));

test.describe('render (M3) @media', () => {
  test('a recorded spin renders to a playable MP4 in the background (VID-8, VID-9)', async ({ page, browserName }) => {
    test.setTimeout(240_000);
    const id = await setupEvent(page, { spin: 3, light: true });
    await startBooth(page, id, browserName);
    await page.getByRole('button', { name: 'Tap to start' }).click();
    await expectRecording(page);
    await expect(page.getByText('Saved. Next guest!')).toBeVisible({ timeout: 10_000 });
    // The booth is ready for the next guest while the render runs.
    await expect(page.getByRole('button', { name: 'Tap to start' })).toBeVisible({ timeout: 5_000 });

    await page.getByRole('button', { name: /take(s)? waiting|Rendering|Nothing waiting/ }).click();
    const queue = page.getByRole('dialog', { name: 'Render queue' });
    await expect(queue.getByText('Rendered', { exact: true })).toBeVisible({ timeout: 150_000 });
    await queue.getByRole('button', { name: 'Play' }).click();
    const video = page.getByRole('dialog', { name: 'Rendered video' }).locator('video');
    await expect
      .poll(() => video.evaluate((v: HTMLVideoElement) => (Number.isFinite(v.duration) ? v.duration : 0)), {
        timeout: 15_000,
      })
      .toBeGreaterThan(2);
    const size = await video.evaluate((v: HTMLVideoElement) => [v.videoWidth, v.videoHeight]);
    expect(size).toEqual([720, 1280]); // 9:16 at the event's resolution (VID-10)
  });
});
