import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { reportPageErrors, setupEvent } from './booth-helpers';
import { createEvent, open, signIn } from './helpers';

/**
 * The setup check (HLP-1, screen 9): reachable from the event page, offered the first time a device
 * opens a booth, walks the camera, storage, a test take, the render, a QR scan and the upload path,
 * and ends in results. CI uses Chrome's fake camera, so the walk itself is a Chrome-only (@media) test;
 * what needs no camera runs on WebKit as well.
 */

const WCAG = ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'];

async function axeViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  return results.violations.map((v) => `${v.id}: ${v.nodes.length}`);
}

/** WebKit in CI has no camera device: choose the simulator before the booth starts (see booth-helpers). */
async function useSimulatorOnWebKit(page: Page, browserName: string) {
  if (browserName !== 'webkit') return;
  await page.addInitScript(() =>
    localStorage.setItem(
      'immersia.booth.camera.v1',
      JSON.stringify({ source: 'simulator', deviceId: null, mirror: false }),
    ),
  );
}

test.describe('setup check (screen 9)', () => {
  test('is one click from the event page, registers the device first and has no axe violations', async ({
    page,
    browserName,
  }) => {
    await useSimulatorOnWebKit(page, browserName);
    await signIn(page);
    const id = await createEvent(page, 'Check entry');
    await page.getByRole('link', { name: 'Setup check' }).click();
    await expect(page).toHaveURL(new RegExp(`/booth/${id}/check$`));
    await expect(page.getByRole('heading', { level: 1, name: 'Setup check' })).toBeVisible();
    await expect(page.getByText('Check entry')).toBeVisible();
    // A device that is not registered yet is registered first, as the booth does.
    await expect(page.getByRole('button', { name: 'Register and continue' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Back to the booth' })).toHaveAttribute('href', `/booth/${id}`);
    expect(await axeViolations(page)).toEqual([]);

    await page.getByRole('button', { name: 'Register and continue' }).click();
    await expect(page.getByRole('heading', { level: 2, name: /^Camera and lens/ })).toBeVisible({ timeout: 15_000 });
    // The steps are an ordered list, the current one marked.
    const steps = page.getByRole('list', { name: 'Setup check steps' });
    await expect(steps.getByRole('listitem')).toHaveCount(6);
    // Its help link opens the public article in a new tab, so the check is never left half done.
    await expect(page.getByRole('link', { name: /How the setup check works/ })).toHaveAttribute(
      'href',
      '/help/setup-check',
    );
    await expect(page.getByRole('link', { name: /How the setup check works/ })).toHaveAttribute('target', '_blank');
  });

  test('a photo booth event adds the printer step', async ({ page, browserName }) => {
    await useSimulatorOnWebKit(page, browserName);
    await signIn(page);
    const id = await createEvent(page, 'Check photo', 'Photo Booth');
    await open(page, `/booth/${id}/check`);
    await page.getByRole('button', { name: 'Register and continue' }).click();
    await expect(page.getByRole('list', { name: 'Setup check steps' }).getByRole('listitem')).toHaveCount(7, {
      timeout: 15_000,
    });
  });

  test('a device is offered the check the first time it opens a booth, and skipping is remembered', async ({
    page,
    browserName,
  }) => {
    await useSimulatorOnWebKit(page, browserName);
    await signIn(page);
    const id = await createEvent(page, 'Check prompt');
    await open(page, `/booth/${id}`);
    await page.getByRole('button', { name: 'Register and continue' }).click();

    const prompt = page.getByRole('heading', { name: 'First time on this device?' });
    await expect(prompt).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('link', { name: 'Run the setup check' })).toHaveAttribute('href', `/booth/${id}/check`);
    await page.getByRole('button', { name: 'Skip for now' }).click();
    await expect(prompt).toBeHidden();

    // Remembered for this device: the booth does not ask again.
    await page.reload();
    await page.locator('html[data-hydrated="1"]').waitFor({ state: 'attached' });
    await expect(page.getByRole('button', { name: 'Start booth' })).toBeVisible({ timeout: 15_000 });
    await expect(prompt).toBeHidden();
  });

  test('a phone that opens a code that is not valid is told so, and the page has no axe violations', async ({
    page,
  }) => {
    await open(page, '/check/not-a-real-test-code');
    await expect(page.getByRole('heading', { level: 1, name: "This isn't a valid test code" })).toBeVisible();
    await expect(page.getByText('Scan the code shown by the setup check on the booth.')).toBeVisible();
    expect(await axeViolations(page)).toEqual([]);
  });

  test('the report endpoint refuses a caller that is not a registered device', async ({ request }) => {
    const res = await request.post('/api/devices/check', { data: { steps: [] } });
    expect(res.status()).toBe(401);
    const qr = await request.post('/api/devices/check/qr', { data: { action: 'start' } });
    expect(qr.status()).toBe(401);
    const upload = await request.post('/api/devices/check/upload', { data: { action: 'start' } });
    expect(upload.status()).toBe(401);
  });

  test('walks every step to the results, with a phone opening the test code @media', async ({ page }) => {
    test.setTimeout(300_000);
    reportPageErrors(page);
    // A lighter output (720p, 30 fps): the render step runs on a GPU-less runner.
    const id = await setupEvent(page, { light: true });
    await open(page, `/booth/${id}/check`);
    await page.getByRole('button', { name: 'Register and continue' }).click();

    const next = page.getByRole('button', { name: /^Continue/ });
    /** The step being worked on (every step is listed, only the current one is open). */
    const current = page.locator('section[aria-current="step"]');
    /** Wait for the step's verdict, then go on. */
    const advance = async (to: RegExp | null, timeout = 30_000) => {
      await expect(next).toBeEnabled({ timeout });
      await next.click();
      if (to) await expect(current.getByRole('heading', { level: 2, name: to })).toBeVisible();
    };

    // 1 Camera: Chrome's fake camera delivers a picture, and its frame rate is measured.
    await expect(page.getByRole('heading', { level: 2, name: /^Camera and lens/ })).toBeVisible({ timeout: 15_000 });
    await advance(/^Storage/);

    // 2 Storage.
    await expect(page.getByText('Free space')).toBeVisible({ timeout: 15_000 });
    await advance(/^Test recording/);

    // 3 A test take through the booth's own capture path, saved and read back.
    await page.getByRole('button', { name: 'Record a test take' }).click();
    await expect(page.getByText('Recorded, saved on the device and read back whole.')).toBeVisible({
      timeout: 30_000,
    });
    await advance(/^Render speed/);

    // 4 The real render engine, scaled to a 15 s 1080p clip.
    await expect(page.getByText('A 15 s 1080p clip would take')).toBeVisible({ timeout: 200_000 });
    await advance(/^Test QR scan/, 10_000);

    // 5 A phone opens the code: the booth, polling, sees "Scanned".
    const address = page.getByRole('link', { name: /\/check\// });
    await expect(address).toBeVisible({ timeout: 15_000 });
    const href = (await address.getAttribute('href'))!;
    const phone = await page.context().newPage();
    await open(phone, href);
    await expect(phone.getByRole('heading', { level: 1, name: 'Scanned' })).toBeVisible();
    expect(await axeViolations(phone)).toEqual([]);
    await phone.close();
    await expect(page.getByRole('status').filter({ hasText: 'Scanned' })).toBeVisible({ timeout: 20_000 });
    await advance(/^Upload and network/, 10_000);

    // 6 The upload path to storage (S3Mock in CI).
    await advance(null, 60_000);

    // The results: every step listed, nothing kept, and the result saved on the device's record.
    await expect(page.getByRole('heading', { level: 2, name: 'Results' })).toBeVisible();
    const results = page.getByRole('region', { name: 'Results' });
    for (const step of [
      'Camera and lens',
      'Storage',
      'Test recording',
      'Render speed',
      'Test QR scan',
      'Upload and network',
    ])
      await expect(results.getByText(step, { exact: true })).toBeVisible();
    await expect(page.getByText('The test recording was deleted from this device')).toBeVisible();
    await expect(page.getByText("The result is saved on this device's record under Devices.")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByRole('link', { name: 'Back to the booth' }).last()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Run the check again' })).toBeVisible();
    expect(await axeViolations(page)).toEqual([]);

    // Having run it, the booth no longer offers it on the start screen.
    await open(page, `/booth/${id}`);
    await expect(page.getByRole('button', { name: 'Start booth' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('heading', { name: 'First time on this device?' })).toBeHidden();
  });
});
