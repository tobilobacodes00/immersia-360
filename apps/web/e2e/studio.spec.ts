import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { createEvent, open, signIn, uniqueEmail } from './helpers';

test.describe('accounts (ACC-1)', () => {
  test('signed-out visitors are sent to sign-in, then back where they were going', async ({ page }) => {
    await page.goto('/studio/devices');
    await expect(page).toHaveURL(/\/sign-in\?next=%2Fstudio%2Fdevices/);
    await signIn(page, uniqueEmail(), '/studio/devices');
    await expect(page.getByRole('heading', { level: 1, name: 'Devices and team' })).toBeVisible();
  });

  test('a new operator gets their own organization as owner', async ({ page }) => {
    await signIn(page);
    await expect(page.getByRole('heading', { level: 1, name: 'What are we running?' })).toBeVisible();
    await expect(page.getByText('Owner', { exact: true }).first()).toBeVisible();
  });

  test('the sign-in page ignores off-site redirects', async ({ page }) => {
    await signIn(page, uniqueEmail(), undefined);
    await page.goto('/sign-in?next=//evil.example.com');
    await expect(page).toHaveURL(/\/studio$/);
  });
});

test.describe('events (EVT-1..4)', () => {
  test('create from the launcher, autosave setup, and persist', async ({ page }) => {
    await signIn(page);
    await page.getByRole('link', { name: /360 Booth/ }).click();
    await expect(page).toHaveURL(/\/studio\/events\/new\?mode=video360/);
    await page.getByLabel('Event name').fill('Gala 360');
    await page.getByRole('button', { name: 'Create event' }).click();
    await expect(page).toHaveURL(/\/setup$/);

    // Spin length 8 → 12 s via the number field, then the 60 fps / 4K options.
    const spin = page.getByRole('textbox', { name: 'Spin length' });
    await spin.fill('12');
    await spin.press('Enter');
    await page.getByRole('radio', { name: 'Boomerang' }).click();
    await expect(page.getByText('All changes saved')).toBeVisible({ timeout: 10_000 });

    await page.reload();
    await expect(page.getByRole('textbox', { name: 'Spin length' })).toHaveValue('12');
    await expect(page.getByRole('radio', { name: 'Boomerang' })).toHaveAttribute('aria-checked', 'true');
  });

  test('blocks an invalid slow-motion segment instead of saving it', async ({ page }) => {
    await signIn(page);
    await createEvent(page, 'Slow-mo check');
    const end = page.getByRole('textbox', { name: 'Slow-motion end' });
    const start = page.getByRole('textbox', { name: 'Slow-motion start' });
    await start.fill('5');
    await start.press('Enter');
    await end.fill('4');
    await end.press('Enter');
    await expect(page.getByText('The slow-motion segment must end after it starts.')).toBeVisible();
  });

  test('list, search, duplicate and archive', async ({ page }) => {
    await signIn(page);
    await createEvent(page, 'Alpha wedding');
    await createEvent(page, 'Beta launch', 'Photo Booth');
    await open(page, '/studio/events');
    await expect(page.getByRole('link', { name: 'Alpha wedding' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Beta launch' })).toBeVisible();

    await page.getByRole('textbox', { name: 'Search events' }).fill('beta');
    await expect(page.getByRole('link', { name: 'Alpha wedding' })).toBeHidden();
    await expect(page).toHaveURL(/q=beta/);

    await page.getByRole('textbox', { name: 'Search events' }).fill('');
    await expect(page).not.toHaveURL(/q=/);
    await page.getByRole('radio', { name: 'Photo Booth' }).click();
    await expect(page).toHaveURL(/mode=photo/);
    await expect(page.getByRole('link', { name: 'Alpha wedding' })).toBeHidden();
    await page.getByRole('radio', { name: 'All' }).click();
    await expect(page).not.toHaveURL(/mode=/);

    const alpha = page.getByRole('row', { name: /Alpha wedding/ });
    await alpha.getByRole('button', { name: 'Duplicate' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByRole('dialog').getByRole('button', { name: 'Duplicate' }).click();
    await expect(page).toHaveURL(/\/setup$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Copy of Alpha wedding' })).toBeVisible();

    await open(page, '/studio/events');
    await page
      .getByRole('row', { name: /Beta launch/ })
      .getByRole('button', { name: 'Archive' })
      .click();
    await expect(page.getByRole('link', { name: 'Beta launch' })).toBeHidden();
    await page.getByRole('switch', { name: 'Archived' }).click();
    await expect(page.getByRole('link', { name: 'Beta launch' })).toBeVisible();
  });

  test("an operator can't open another organization's event", async ({ browser }) => {
    const a = await browser.newContext();
    const pa = await a.newPage();
    await signIn(pa);
    const id = await createEvent(pa, 'Private event');

    const b = await browser.newContext();
    const pb = await b.newPage();
    await signIn(pb);
    const res = await pb.goto(`/studio/events/${id}`);
    expect(res?.status()).toBe(404);
    await a.close();
    await b.close();
  });
});

test.describe('devices (ACC-2)', () => {
  test('register, heartbeat, rename and revoke', async ({ page }) => {
    await signIn(page);
    await open(page, '/studio/devices');
    await page.getByRole('button', { name: 'Register device' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('textbox').fill('Booth A laptop');
    await dialog.getByRole('button', { name: 'Register device' }).click();
    await expect(page.getByText('Booth A laptop')).toBeVisible();
    await expect(page.getByText('This device', { exact: true })).toBeVisible();

    const token = await page.evaluate(() => JSON.parse(localStorage.getItem('immersia.device.v1')!).token as string);
    const beat = () =>
      page.request.post('/api/devices/heartbeat', {
        headers: { authorization: `Device ${token}` },
        data: {
          eventId: null,
          renderQueue: 2,
          uploadQueue: 5,
          freeStorageBytes: null,
          appVersion: 'e2e',
          at: new Date().toISOString(),
        },
      });
    expect((await beat()).status()).toBe(200);
    expect(
      (
        await page.request.post('/api/devices/heartbeat', { headers: { authorization: 'Device nope' }, data: {} })
      ).status(),
    ).toBe(401);

    await page.getByRole('button', { name: 'Rename' }).click();
    await page.getByRole('dialog').getByRole('textbox').fill('Booth B laptop');
    await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Booth B laptop')).toBeVisible();

    await page.getByRole('button', { name: 'Revoke' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Revoke' }).click();
    await expect(page.getByText('Revoked')).toBeVisible();
    expect((await beat()).status()).toBe(401);
  });
});

test.describe('accessibility (WCAG 2.2 AA)', () => {
  test('sign-in has no axe violations', async ({ page }) => {
    await page.goto('/sign-in');
    const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
    expect(r.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
  });

  test('studio screens have no axe violations', async ({ page }) => {
    await signIn(page);
    const id = await createEvent(page, 'Axe event');
    for (const path of [
      '/studio',
      '/studio/events',
      `/studio/events/${id}`,
      `/studio/events/${id}/setup`,
      '/studio/devices',
      '/studio/devices/team',
    ]) {
      await page.goto(path);
      const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
      expect(r.violations.map((v) => `${path} ${v.id}: ${v.nodes.length}`)).toEqual([]);
    }
  });
});
