import { expect, test, type Page } from '@playwright/test';
import { expectRecording, expectResult, reportPageErrors, setupEvent, startBooth } from './booth-helpers';

/**
 * Camera controls (M10): the lens list, torch and fill light in the operator's settings drawer.
 * Chrome's fake camera is a single device with no torch, so the lens list and the torch reason run
 * on it; the fill light does not depend on a camera, so it runs on the simulated camera, which is
 * the same in every browser (and reports no facing, which keeps the fill-light control in play).
 */

test.beforeEach(({ page }) => reportPageErrors(page));

const CAMERA_KEY = 'immersia.booth.camera.v1';

/** Start the booth on the simulated camera whatever the browser. */
async function useSimulator(page: Page) {
  await page.addInitScript(
    (key) => localStorage.setItem(key, JSON.stringify({ source: 'simulator', deviceId: null, mirror: false })),
    CAMERA_KEY,
  );
}

const drawerOf = (page: Page) => page.getByRole('dialog', { name: 'Booth settings' });

async function openSettings(page: Page) {
  await page.getByRole('button', { name: 'Booth settings' }).click();
  const drawer = drawerOf(page);
  await expect(drawer).toBeVisible();
  return drawer;
}

const savedChoice = (page: Page) =>
  page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? 'null') as Record<string, unknown> | null, CAMERA_KEY);

test.describe('lens list and torch (CAP-2, CAP-6) @media', () => {
  test('lists the camera, marks the one in use, and says why the torch is off', async ({ page, browserName }) => {
    const id = await setupEvent(page, { spin: 3 });
    await startBooth(page, id, browserName);
    const drawer = await openSettings(page);

    // Default camera, Chrome's one fake device, and the simulator.
    const cameras = drawer.getByRole('radiogroup', { name: 'Camera' });
    await expect(cameras.getByRole('radio')).toHaveCount(3);
    await expect(cameras.getByRole('radio', { name: 'Default camera' })).toBeChecked();
    // Names arrive with permission, which the running camera has: nothing left to wait for.
    await expect(cameras.getByText('In use', { exact: true })).toBeVisible();
    await expect(drawer.getByText('Camera names appear once the camera has started.')).toHaveCount(0);

    // The fake camera has no light: the switch is off the table, and the drawer says why.
    await expect(drawer.getByRole('switch', { name: 'Torch' })).toBeDisabled();
    await expect(drawer.getByText(/^Not supported: /)).toBeVisible();
  });

  test('choosing a camera reopens it and remembers the choice', async ({ page, browserName }) => {
    const id = await setupEvent(page, { spin: 3 });
    await startBooth(page, id, browserName);
    const drawer = await openSettings(page);
    const cameras = drawer.getByRole('radiogroup', { name: 'Camera' });

    // The fake device sits between "Default camera" and the simulator, once the list has loaded.
    await expect(cameras.getByRole('radio')).toHaveCount(3);
    const device = cameras.getByRole('radio').nth(1);
    await cameras.locator('label').nth(1).click();
    await expect(device).toBeChecked();
    await expect(cameras.getByRole('radio', { name: 'Default camera' })).not.toBeChecked();
    // Through the same path as Start booth: the camera restarts and the booth is ready again.
    await expect(page.getByRole('button', { name: 'Tap to start' })).toBeVisible({ timeout: 15_000 });
    await expect.poll(async () => (await savedChoice(page))?.deviceId).toEqual(expect.any(String));
    await expect(cameras.getByText('In use', { exact: true })).toBeVisible();
  });
});

test.describe('fill light (CAP-6)', () => {
  test('a glowing frame shows at Soft and Bright, takes the tint, and is gone at Off', async ({
    page,
    browserName,
  }) => {
    const id = await setupEvent(page, { spin: 3 });
    await useSimulator(page);
    await startBooth(page, id, browserName);
    const frame = page.locator('[data-fill-light]');
    await expect(frame).toHaveCount(0);

    const drawer = await openSettings(page);
    const level = drawer.getByRole('radiogroup', { name: 'Fill light' });
    // Off until chosen, with nothing about tint or screen brightness cluttering the drawer.
    await expect(level.getByRole('radio', { name: 'Off' })).toHaveAttribute('aria-checked', 'true');
    await expect(drawer.getByRole('radiogroup', { name: 'Light colour' })).toHaveCount(0);

    await level.getByRole('radio', { name: 'Bright' }).click();
    await expect(frame).toHaveAttribute('data-fill-light', 'bright');
    await expect(frame).toBeVisible();
    // A frame of light, not a control: it takes no taps and sits under every guest screen.
    await expect(frame).toHaveCSS('pointer-events', 'none');
    await expect(frame).toHaveCSS('z-index', '5');
    await expect(frame).toHaveCSS('box-shadow', /inset/);
    await expect(frame).toHaveAttribute('aria-hidden', 'true');
    // A web page can't raise the screen brightness: the drawer tells the operator to.
    await expect(drawer.getByText(/set this device's screen brightness to maximum/i)).toBeVisible();

    await drawer.getByRole('radiogroup', { name: 'Light colour' }).getByRole('radio', { name: 'Warm' }).click();
    await expect(frame).toHaveAttribute('data-fill-tint', 'warm');

    await level.getByRole('radio', { name: 'Soft' }).click();
    await expect(frame).toHaveAttribute('data-fill-light', 'soft');
    // Remembered for this device, and in the shape the camera choice has always had.
    await expect.poll(async () => (await savedChoice(page))?.fillLight).toEqual({ level: 'soft', tint: 'warm' });
    expect(await savedChoice(page)).toMatchObject({ source: 'simulator', deviceId: null, mirror: false });

    await level.getByRole('radio', { name: 'Off' }).click();
    await expect(frame).toHaveCount(0);
    await expect(drawer.getByRole('radiogroup', { name: 'Light colour' })).toHaveCount(0);
  });

  test('stays on through a recording, never blocks the guest, and goes before the QR @media', async ({
    page,
    browserName,
  }) => {
    const id = await setupEvent(page, { spin: 6 });
    await useSimulator(page);
    await startBooth(page, id, browserName);
    const drawer = await openSettings(page);
    await drawer.getByRole('radiogroup', { name: 'Fill light' }).getByRole('radio', { name: 'Bright' }).click();
    await drawer.getByRole('button', { name: 'Close' }).click();
    await expect(drawer).toHaveCount(0);

    // The frame is under the attract screen, so the guest's tap lands on the button.
    await page.getByRole('button', { name: 'Tap to start' }).click();
    await expectRecording(page);
    const frame = page.locator('[data-fill-light="bright"]');
    await expect(frame).toBeVisible();

    // The operator can look at the settings mid-recording, but cannot touch the camera.
    const open = await openSettings(page);
    await expect(open.getByRole('radio', { name: 'Default camera' })).toBeDisabled();
    await expect(open.getByRole('switch', { name: 'Torch' })).toBeDisabled();
    await expect(open.getByText('Camera changes pause while a guest is using the booth.').first()).toBeVisible();
    await open.getByRole('button', { name: 'Close' }).click();

    // The recording ran to its end undisturbed; the QR gets the whole screen.
    await expectResult(page);
    await expect(page.locator('[data-fill-light]')).toHaveCount(0);
  });
});
