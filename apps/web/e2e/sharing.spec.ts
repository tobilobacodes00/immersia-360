import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import {
  expectRecording,
  expectResult,
  latestSession,
  reportPageErrors,
  setupEvent,
  startBooth,
} from './booth-helpers';

/**
 * M4, the guest's whole journey: QR on the booth → the share page ("on their way", then the video)
 * → download → short code → expiry. Runs in the render project (it waits on a real render and
 * upload) against S3-compatible storage (S3Mock in CI).
 */

test.beforeEach(({ page }) => reportPageErrors(page));

test('a guest gets their video by QR and by code, until the event expires (DL-1, 2, 8, 9, 12; SHR-1) @media', async ({
  page,
  browser,
  browserName,
  context,
  request,
}) => {
  test.setTimeout(330_000);
  const id = await setupEvent(page, { spin: 3, light: true });
  await page.getByRole('textbox', { name: 'Contact for guests' }).fill('ops@example.com');
  await expect(page.getByText('All changes saved')).toBeVisible({ timeout: 10_000 });
  await startBooth(page, id, browserName);
  await page.getByRole('button', { name: 'Tap to start' }).click();
  await expectRecording(page);
  await expectResult(page);
  const minted = await latestSession(page);

  // DL-1: the link works before anything is uploaded.
  const guest = await context.newPage();
  await guest.goto(`/s/${minted.linkId}?r=booth`);
  await expect(
    guest
      .getByRole('heading', { name: 'Your files are on their way' })
      .or(guest.getByRole('heading', { name: 'Here it is' })),
  ).toBeVisible();

  // The booth renders and uploads in the background; the page picks the video up.
  const status = async () =>
    (await (await request.get(`/api/share/${minted.linkId}`)).json()) as { ready: number; total: number };
  await expect.poll(async () => (await status()).ready, { timeout: 240_000, intervals: [2_000] }).toBeGreaterThan(0);
  // DL-8: the poster and the lighter messaging copy follow the main video.
  await expect
    .poll(async () => (await status()).ready, { timeout: 120_000, intervals: [2_000] })
    .toBeGreaterThanOrEqual(3);
  await guest.reload();
  await expect(guest.getByRole('heading', { name: 'Here it is' })).toBeVisible();
  await expect
    .poll(
      () => guest.locator('video').evaluate((v: HTMLVideoElement) => (Number.isFinite(v.duration) ? v.duration : 0)),
      {
        timeout: 15_000,
      },
    )
    .toBeGreaterThan(2);
  await expect(guest.locator('video')).toHaveAttribute('poster', /.+/);
  await expect(guest.getByText('Smaller video', { exact: true })).toBeVisible();
  const axe = await new AxeBuilder({ page: guest }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  expect(axe.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);

  // SHR-2: the page loads in under 2 s on 4G (throttled fast 4G: 9 Mbit/s down, 150 ms latency).
  // A fresh context with the cache off: a guest's first visit, not a revisit served from cache.
  const fresh = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  const slow = await fresh.newPage();
  const cdp = await fresh.newCDPSession(slow);
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 150,
    downloadThroughput: (9_000_000 / 8) | 0,
    uploadThroughput: (1_500_000 / 8) | 0,
  });
  await slow.goto(`/s/${minted.linkId}?r=booth`, { waitUntil: 'load' });
  const perf = await slow.evaluate(
    () =>
      new Promise<{ lcp: number; fcp: number; load: number; jsBytes: number }>((resolve) => {
        let lcp = 0;
        new PerformanceObserver((list) => {
          for (const e of list.getEntries()) lcp = e.startTime;
        }).observe({ type: 'largest-contentful-paint', buffered: true });
        setTimeout(() => {
          const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
          const jsBytes = (performance.getEntriesByType('resource') as PerformanceResourceTiming[])
            .filter((r) => r.initiatorType === 'script')
            .reduce((sum, r) => sum + r.transferSize, 0);
          const fcp = performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? 0;
          resolve({ lcp, fcp, load: nav.loadEventEnd, jsBytes });
        }, 300);
      }),
  );
  console.log(
    `[share page, fast 4G] LCP ${Math.round(perf.lcp)} ms, FCP ${Math.round(perf.fcp)} ms, load ${Math.round(perf.load)} ms, JS ${Math.round(perf.jsBytes / 1024)} KB`,
  );
  // The measurement must be real (a cached or blank page would pass vacuously)…
  expect(perf.jsBytes).toBeGreaterThan(0);
  const painted = perf.lcp || perf.fcp;
  expect(painted).toBeGreaterThan(0);
  // …and the page meaningfully painted within 2 s on 4G.
  expect(painted).toBeLessThan(2000);
  await fresh.close();

  // DL-8: the download goes through our route (counted) to a short-lived storage URL.
  const href = (await guest.getByRole('link', { name: 'Download' }).first().getAttribute('href'))!;
  const redirect = await request.get(href, { maxRedirects: 0 });
  expect(redirect.status()).toBe(302);
  const file = await request.get(redirect.headers()['location']!);
  expect(file.ok()).toBe(true);
  expect(new TextDecoder().decode((await file.body()).subarray(4, 8))).toBe('ftyp');

  // DL-2: the short code (the device's own, or one the server assigned) finds the same page.
  const registered = await latestSession(page);
  expect(registered.shortCode).toMatch(/^[2-9A-HJKMNP-Z]{6}$/);
  await guest.goto('/c');
  await guest.getByLabel('Your code').fill(`${registered.shortCode!.slice(0, 3)}-${registered.shortCode!.slice(3)}`);
  await guest.getByRole('button', { name: 'Find my files' }).click();
  await expect(guest).toHaveURL(new RegExp(`/s/${minted.linkId}\\?r=code$`));
  await expect(guest.getByRole('heading', { name: 'Here it is' })).toBeVisible();
  // A wrong code says so (and counts against this IP's miss budget).
  await guest.goto('/c/ZZZ-ZZZ');
  await expect(guest.getByRole('alert')).toHaveText(/couldn.t find that code/);

  // DL-12: the operator can give live links more time.
  await page.goto(`/studio/events/${id}`);
  await page.getByRole('button', { name: 'Extend by 7 days' }).click();
  await expect(page.getByText('1 link extended by 7 days')).toBeVisible();

  // DL-9 / acceptance #8: once the event's retention runs out, the link answers 410.
  expect((await request.post(`/api/test/expire?linkId=${minted.linkId}`)).ok()).toBe(true);
  const gone = await guest.goto(`/s/${minted.linkId}`);
  expect(gone!.status()).toBe(410);
  await expect(guest.getByRole('heading', { name: 'This event has ended' })).toBeVisible();
  // DL-12: with the operator's contact.
  await expect(guest.getByRole('link', { name: 'ops@example.com' })).toHaveAttribute('href', 'mailto:ops@example.com');
  expect((await request.get(href, { maxRedirects: 0 })).status()).toBe(410);
});
