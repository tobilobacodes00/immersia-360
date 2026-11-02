import { expect, type Locator, type Page } from '@playwright/test';

/** The test-only routes demand this run's secret (see src/server/e2e.ts). */
export const e2eHeaders = { 'x-e2e-token': process.env.E2E_TOKEN ?? '' };

export const uniqueEmail = (tag = 'op') =>
  `e2e-${tag}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}@example.com`;

/** Navigate and wait until React has hydrated (fields typed earlier could be reset by hydration). */
export async function open(page: Page, path: string) {
  await page.goto(path);
  await page.locator('html[data-hydrated="1"]').waitFor({ state: 'attached' });
}

/** Sign in through the real magic-link flow, reading the link from the e2e mailbox. */
export async function signIn(page: Page, email = uniqueEmail(), next?: string): Promise<string> {
  await open(page, next ? `/sign-in?next=${encodeURIComponent(next)}` : '/sign-in');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByRole('button', { name: 'Email me a sign-in link' }).click();
  await expect(page.getByRole('heading', { name: 'Check your inbox' })).toBeVisible();
  let link: string | undefined;
  await expect
    .poll(
      async () => {
        const res = await page.request.get(`/api/test/mailbox?to=${encodeURIComponent(email)}`, {
          headers: e2eHeaders,
        });
        if (!res.ok()) return undefined;
        const mail = (await res.json()) as { text: string };
        link = /https?:\/\/\S+/.exec(mail.text)?.[0];
        return link;
      },
      { timeout: 10_000 },
    )
    .toBeTruthy();
  await page.goto(link!);
  await expect(page).toHaveURL(new RegExp(next ? next.replace(/[/?]/g, '\\$&') : '/studio$'));
  await page.locator('html[data-hydrated="1"]').waitFor({ state: 'attached' });
  return email;
}

export async function createEvent(page: Page, name: string, mode: '360 Booth' | 'Photo Booth' = '360 Booth') {
  await open(page, '/studio/events/new');
  await page.getByLabel('Event name').fill(name);
  await page.getByRole('radio', { name: mode }).click();
  await page.getByRole('button', { name: 'Create event' }).click();
  await expect(page).toHaveURL(/\/studio\/events\/[0-9a-f-]{36}\/setup$/);
  await page.locator('html[data-hydrated="1"]').waitFor({ state: 'attached' });
  return page.url().split('/').at(-2)!;
}

/**
 * Wait until `locator` and everything it sits inside have finished fading in. Playwright calls an
 * element visible as soon as it has a box, and opacity plays no part in that, so a scan started
 * straight after `toBeVisible()` can read a panel that is still half transparent: axe then measures
 * text blended with whatever is behind it and reports contrast failures that no one ever sees
 * (the modal's spring made the red "Delete" fail that way). Checked as the product of the opacities
 * up the tree, since the modal fades its backdrop and its panel separately.
 */
export async function settled(locator: Locator) {
  await expect
    .poll(
      () =>
        locator.evaluate((el) => {
          let opacity = 1;
          for (let node: Element | null = el; node; node = node.parentElement)
            opacity *= Number(getComputedStyle(node).opacity);
          return opacity;
        }),
      { timeout: 10_000 },
    )
    .toBeGreaterThan(0.999);
}
