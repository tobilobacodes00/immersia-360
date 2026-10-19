import { expect, type Page } from '@playwright/test';
import { createEvent, open, signIn } from './helpers';

/** Booth (M2+) test steps shared by the capture and render specs. */

/** Surface what the page itself reports, so a CI failure explains itself. */
export function reportPageErrors(page: Page) {
  page.on('pageerror', (err) => console.log(`[pageerror] ${err.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error' || msg.type() === 'warning') console.log(`[console.${msg.type()}] ${msg.text()}`);
  });
}

/** Fail with the booth's own error message instead of a bare timeout. */
export async function expectRecording(page: Page, timeout = 5_000) {
  const recording = page.getByRole('status', { name: 'Recording' });
  const failure = page.locator('[role=alert]').filter({ hasText: /camera|record|browser/i });
  await expect(recording.or(failure)).toBeVisible({ timeout });
  if (await failure.isVisible()) throw new Error(`Booth error: ${await failure.innerText()}`);
}

export async function setupEvent(
  page: Page,
  { spin = 3, countdown = 0, light = false }: { spin?: number; countdown?: number; light?: boolean } = {},
) {
  await signIn(page);
  const id = await createEvent(page, 'Booth test');
  const spinField = page.getByRole('textbox', { name: 'Spin length' });
  // Slow motion must end within the spin: turn it off for short test spins.
  await page.getByRole('switch', { name: 'Slow motion' }).click();
  // A lighter output (720p, 30 fps) for specs that wait on a full render on a GPU-less runner.
  if (light) {
    await page.getByRole('radio', { name: '720p' }).click();
    await page.getByRole('radio', { name: '30 fps' }).click();
  }
  await spinField.fill(String(spin));
  await spinField.press('Enter');
  const cd = page.getByRole('textbox', { name: 'Countdown' });
  await cd.fill(String(countdown));
  await cd.press('Enter');
  await expect(page.getByText('All changes saved')).toBeVisible({ timeout: 10_000 });
  return id;
}

export async function startBooth(page: Page, eventId: string, browserName: string) {
  // WebKit in CI has no camera device: choose the simulator before starting.
  if (browserName === 'webkit') {
    await page.addInitScript(() =>
      localStorage.setItem(
        'immersia.booth.camera.v1',
        JSON.stringify({ source: 'simulator', deviceId: null, mirror: false }),
      ),
    );
  }
  await open(page, `/booth/${eventId}`);
  await page.getByRole('button', { name: 'Register and continue' }).click();
  await page.getByRole('button', { name: 'Start booth' }).click();
  await expect(page.getByRole('button', { name: 'Tap to start' })).toBeVisible({ timeout: 15_000 });
}

/** The guest's result screen (screen 13) after a take is saved. */
export async function expectResult(page: Page) {
  await expect(page.getByRole('heading', { name: 'Scan for your video' })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole('img', { name: 'QR code for your video page' })).toBeVisible();
}

/** The newest guest session the booth minted, read from its device database. */
export async function latestSession(page: Page) {
  return page.evaluate(
    () =>
      new Promise<{ id: string; linkId: string; shortCode: string | null; state: string }>((resolve, reject) => {
        const req = indexedDB.open('immersia-booth');
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const all = req.result.transaction('sessions').objectStore('sessions').getAll();
          all.onsuccess = () => {
            const rows = all.result as {
              id: string;
              linkId: string;
              shortCode: string | null;
              state: string;
              createdAt: number;
            }[];
            rows.sort((a, b) => b.createdAt - a.createdAt);
            if (!rows[0]) reject(new Error('no session'));
            else resolve(rows[0]);
          };
        };
      }),
  );
}
