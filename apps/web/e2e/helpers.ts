import { randomBytes, randomUUID } from 'node:crypto';
import { expect, type APIRequestContext, type Page } from '@playwright/test';

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

/** A 1x1 GIF: a real, tiny file for a session's strip, so uploads and downloads have something to carry. */
const TINY_GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

export interface SeededSession {
  sessionId: string;
  linkId: string;
  shortCode: string;
  outputId: string;
  deviceId: string;
  deviceToken: string;
}

/**
 * Register this browser as a booth device and give the event one finished guest session (a photo
 * strip, uploaded and confirmed), through the same API a booth uses. For specs about what happens to
 * a guest's page, not about capturing it.
 */
export async function seedSession(page: Page, request: APIRequestContext, eventId: string): Promise<SeededSession> {
  await open(page, `/booth/${eventId}`);
  await page.getByRole('button', { name: 'Register and continue' }).click();
  await page.waitForFunction(() => localStorage.getItem('immersia.device.v1') !== null);
  const device = await page.evaluate(
    () => JSON.parse(localStorage.getItem('immersia.device.v1')!) as { id: string; token: string },
  );
  const auth = { authorization: `Device ${device.token}` };

  const sessionId = randomUUID();
  const linkId = randomBytes(16).toString('base64url');
  const registered = await request.post('/api/booth/sessions', {
    headers: auth,
    data: {
      id: sessionId,
      eventId,
      linkId,
      shortCode: null,
      capturedAt: new Date().toISOString(),
      optedOutOfDisplay: false,
      takes: [],
      outputs: [
        {
          id: randomUUID(),
          takeId: null,
          kind: 'strip',
          mime: 'image/gif',
          bytes: TINY_GIF.length,
          width: 600,
          height: 1800,
          durationMs: 0,
        },
      ],
    },
  });
  expect(registered.ok(), await registered.text()).toBe(true);
  const body = (await registered.json()) as {
    shortCode: string;
    uploads: { outputId: string; url: string; headers: Record<string, string> }[];
  };
  const ticket = body.uploads[0]!;
  const put = await request.put(ticket.url, { headers: ticket.headers, data: TINY_GIF });
  expect(put.ok()).toBe(true);
  const done = await request.post(`/api/booth/outputs/${ticket.outputId}/complete`, { headers: auth, data: {} });
  expect(done.ok(), await done.text()).toBe(true);
  return {
    sessionId,
    linkId,
    shortCode: body.shortCode,
    outputId: ticket.outputId,
    deviceId: device.id,
    deviceToken: device.token,
  };
}

/** One admin address per browser project (listed in ADMIN_EMAILS in the CI workflow). */
export const adminEmail = (projectName: string) => `e2e-admin-${projectName}@example.com`;
