import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { createEvent, signIn } from './helpers';

/**
 * Bring-your-own cloud (SHR-7, screen 20). CI has no Google or Dropbox credentials and no
 * INTEGRATION_TOKEN_KEY, so every provider is "not configured"; the real OAuth round trip needs
 * live credentials and is exercised by hand (see the README).
 */
test.describe('integrations (screen 20)', () => {
  test('lists Google Drive and Dropbox as not configured, with no way to connect them, and has no axe violations', async ({
    page,
  }) => {
    await signIn(page);
    await page.getByRole('link', { name: 'Integrations', exact: true }).click();
    await expect(page).toHaveURL(/\/studio\/integrations$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Integrations' })).toBeVisible();

    for (const provider of ['Google Drive', 'Dropbox']) {
      const card = page.getByRole('region', { name: provider });
      await expect(card.getByText('Not configured', { exact: true })).toBeVisible();
      await expect(card.getByText(`isn't set up for ${provider} yet`)).toBeVisible();
      await expect(card.getByRole('link')).toHaveCount(0);
    }
    await expect(page.getByRole('heading', { level: 2, name: 'Recent copies' })).toBeVisible();
    await expect(page.getByText('Nothing copied yet')).toBeVisible();

    const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
    expect(r.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
  });

  test('starting a connection on a server that is not set up says so instead of leaving the app', async ({ page }) => {
    await signIn(page);
    await page.goto('/api/integrations/drive/connect');
    await expect(page).toHaveURL(/\/studio\/integrations\?error=unavailable&provider=drive$/);
    // (Next's route announcer is a role=alert too, so pick ours by its text.)
    await expect(
      page.getByRole('alert').filter({ hasText: "This server isn't set up for Google Drive." }),
    ).toBeVisible();
  });

  test('a made-up OAuth state is refused and nothing is connected', async ({ page }) => {
    await signIn(page);
    await page.goto('/api/integrations/dropbox/callback?code=stolen-code&state=forged.state');
    await expect(page).toHaveURL(/\/studio\/integrations\?error=state&provider=dropbox$/);
    await expect(
      page.getByRole('alert').filter({ hasText: "That sign-in link expired or didn't come from this account" }),
    ).toBeVisible();
    await expect(page.getByText('Connected as')).toHaveCount(0);
  });

  test('the connect routes refuse anonymous visitors and unknown providers', async ({ request }) => {
    const anonymous = await request.get('/api/integrations/drive/connect', { maxRedirects: 0 });
    expect(anonymous.status()).toBe(302);
    expect(anonymous.headers().location).toContain('/sign-in');
    const callback = await request.get('/api/integrations/drive/callback?code=x&state=y', { maxRedirects: 0 });
    expect(callback.status()).toBe(302);
    expect(callback.headers().location).toContain('/sign-in');
    const unknown = await request.get('/api/integrations/box/connect', { maxRedirects: 0 });
    expect(unknown.status()).toBe(404);
  });

  test('event setup offers only connected clouds and points to Integrations', async ({ page }) => {
    await signIn(page);
    await createEvent(page, 'Cloud choice');
    const cloud = page.getByRole('combobox', { name: 'Also copy to my cloud' });
    await expect(cloud).toHaveValue('none');
    await expect(cloud.getByRole('option', { name: 'Immersia only' })).toBeEnabled();
    await expect(cloud.getByRole('option', { name: 'Google Drive (not set up)' })).toBeDisabled();
    await expect(cloud.getByRole('option', { name: 'Dropbox (not set up)' })).toBeDisabled();
    await page.getByRole('link', { name: 'Manage integrations' }).click();
    await expect(page).toHaveURL(/\/studio\/integrations$/);
  });
});
