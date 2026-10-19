import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { createEvent, open, signIn } from './helpers';
import { latestSession, reportPageErrors } from './booth-helpers';

/**
 * M5: the photo booth (Chrome's fake camera) and kiosk mode. Photo sessions don't render video, so
 * these run with the capture specs.
 */

test.beforeEach(({ page }) => reportPageErrors(page));

async function setupPhotoEvent(page: Page, { shots = 2 } = {}) {
  await signIn(page);
  const id = await createEvent(page, 'Photo test', 'Photo Booth');
  await page.getByRole('radio', { name: String(shots), exact: true }).click();
  for (const name of ['Countdown', 'Pause between photos']) {
    const field = page.getByRole('textbox', { name });
    await field.fill('0');
    await field.press('Enter');
  }
  await expect(page.getByText('All changes saved')).toBeVisible({ timeout: 10_000 });
  return id;
}

async function startPhotoBooth(page: Page, id: string) {
  await open(page, `/booth/${id}`);
  await page.getByRole('button', { name: 'Register and continue' }).click();
  await page.getByRole('button', { name: 'Start booth' }).click();
  await expect(page.getByRole('button', { name: 'Tap to start' })).toBeVisible({ timeout: 15_000 });
}

test.describe('photo booth (PHO-1, 2, 3, 11; SHR-1) @media', () => {
  test('two shots, a retake, keep: the strip reaches the guest page', async ({ page, context, request }) => {
    const id = await setupPhotoEvent(page, { shots: 2 });
    await startPhotoBooth(page, id);

    await page.getByRole('button', { name: 'Tap to start' }).click();
    await expect(page.getByRole('heading', { name: 'Looking good!' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('img', { name: 'Your photo strip' })).toBeVisible();
    // PHO-1: a retake runs the whole session again.
    await page.getByRole('button', { name: 'Retake' }).click();
    await expect(page.getByRole('heading', { name: 'Looking good!' })).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: 'Keep it' }).click();

    // SHR-1: the QR is on screen at once, with the strip beside it.
    await expect(page.getByRole('heading', { name: 'Scan for your photos' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('img', { name: 'QR code for your video page' })).toBeVisible();
    const session = await latestSession(page);

    // The strip and the GIF (on by default) upload; the share page shows the strip.
    await expect
      .poll(
        async () => ((await (await request.get(`/api/share/${session.linkId}`)).json()) as { ready: number }).ready,
        {
          timeout: 60_000,
          intervals: [1_000],
        },
      )
      .toBeGreaterThanOrEqual(2);
    const guest = await context.newPage();
    await guest.goto(`/s/${session.linkId}?r=booth`);
    await expect(guest.getByRole('heading', { name: 'Here it is' })).toBeVisible();
    const strip = guest.getByRole('img', { name: 'Photo strip' });
    await expect(strip).toBeVisible();
    // PHO-3: a 2×6 strip at 300 DPI.
    expect(await strip.evaluate((img: HTMLImageElement) => [img.naturalWidth, img.naturalHeight])).toEqual([600, 1800]);
    await expect(guest.getByText('GIF', { exact: true })).toBeVisible();
  });
});

test.describe('operator event gallery (screen 15) @media', () => {
  test('lists the strip with its code, reshares its QR and exports a ZIP', async ({ page }) => {
    const id = await setupPhotoEvent(page, { shots: 1 });
    await startPhotoBooth(page, id);
    await page.getByRole('button', { name: 'Tap to start' }).click();
    await expect(page.getByRole('heading', { name: 'Looking good!' })).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: 'Keep it' }).click();
    await expect(page.getByRole('heading', { name: 'Scan for your photos' })).toBeVisible({ timeout: 15_000 });

    // The gallery shows the code the session ended up with (the pool's, or the server's once registered).
    await expect
      .poll(async () => (await latestSession(page)).shortCode, { timeout: 60_000, intervals: [500] })
      .not.toBeNull();
    const code = (await latestSession(page)).shortCode!;
    const label = `${code.slice(0, 3)}-${code.slice(3)}`;

    await page.getByRole('button', { name: 'Gallery', exact: true }).click();
    const gallery = page.getByRole('dialog', { name: 'Event gallery' });
    await expect(gallery).toBeVisible();
    await gallery.getByRole('radio', { name: /^Strips/ }).click();
    // By label: the card is a button now and a checkbox once selecting starts.
    const card = gallery.getByLabel(/^Photo strip,/);
    await expect(card).toHaveCount(1);
    await expect(card).toContainText(label);

    // Reshare: the guest's QR and code, large.
    await card.click();
    const detail = page.getByRole('dialog', { name: 'Photo strip' });
    await expect(detail.getByRole('img', { name: /QR code for this guest/ })).toBeVisible();
    await expect(detail).toContainText(label);
    await detail.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(detail).toHaveCount(0);

    // Select it and export. Without the File System Access API (Safari, Firefox) the ZIP is built in
    // memory and handed to the browser as a download; the native save dialog can't be driven here.
    await page.evaluate(() => {
      Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true, writable: true });
    });
    await gallery.getByRole('button', { name: 'Select', exact: true }).click();
    await card.click();
    await expect(card).toHaveAttribute('aria-checked', 'true');
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      gallery.getByRole('button', { name: 'Export selected (1)' }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/^Photo-test-\d{4}-\d{2}-\d{2}\.zip$/);
    const zip = readFileSync(await download.path());
    expect([...zip.subarray(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]); // "PK\x03\x04"
    expect(zip.toString('latin1')).toContain(`strips/strip-${code}.jpg`);

    // Chromium: the archive streams straight into the file the operator picked.
    await page.evaluate(() => {
      const parts: Uint8Array[] = [];
      const w = window as unknown as { __zipParts: Uint8Array[] };
      w.__zipParts = parts;
      Object.defineProperty(window, 'showSaveFilePicker', {
        configurable: true,
        writable: true,
        value: async () => ({
          createWritable: async () =>
            new WritableStream<Uint8Array>({
              write(chunk) {
                parts.push(chunk);
              },
            }),
        }),
      });
    });
    await gallery.getByRole('button', { name: 'Export selected (1)' }).click();
    await expect(gallery.getByText(/^Saved Photo-test-.*\.zip\.$/)).toBeVisible({ timeout: 15_000 });
    const streamed = await page.evaluate(() => {
      const w = window as unknown as { __zipParts: Uint8Array[] };
      const head = new Uint8Array(4);
      let at = 0;
      for (const part of w.__zipParts) {
        for (const byte of part) {
          if (at === 4) break;
          head[at++] = byte;
        }
      }
      return Array.from(head);
    });
    expect(streamed).toEqual([0x50, 0x4b, 0x03, 0x04]);
  });
});

test.describe('kiosk mode (KIO-1) @media', () => {
  test('hides the operator controls until the exit PIN is entered', async ({ page }) => {
    const id = await setupPhotoEvent(page, { shots: 1 });
    await page.getByLabel('Exit PIN').fill('2468');
    await page.getByRole('button', { name: 'Set PIN' }).click();
    await expect(page.getByText('PIN saved')).toBeVisible();

    await startPhotoBooth(page, id);
    await expect(page.getByRole('button', { name: 'Booth settings' })).toHaveCount(0);

    const corner = page.getByRole('button', { name: 'Operator controls' });
    for (let i = 0; i < 3; i++) await corner.click({ force: true });
    const pad = page.getByRole('dialog', { name: 'Enter the exit PIN' });
    await expect(pad).toBeVisible();
    for (const d of '1111') await pad.getByRole('button', { name: d, exact: true }).click();
    await pad.getByRole('button', { name: 'Unlock' }).click();
    await expect(pad.getByText('Wrong PIN. Try again.')).toBeVisible();
    for (const d of '2468') await pad.getByRole('button', { name: d, exact: true }).click();
    await pad.getByRole('button', { name: 'Unlock' }).click();

    await expect(pad).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Booth settings' })).toBeVisible();
  });
});
