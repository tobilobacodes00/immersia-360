import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { adminEmail, createEvent, e2eHeaders, seedSession, signIn } from './helpers';

/**
 * Abuse (PRD Abuse NFR; risk table "report link, 24-hour takedown process"): a guest reports a
 * session from its share page; the operator sees it and can hide the item at once; a platform admin
 * (ADMIN_EMAILS) takes it down, and the share page answers 451. Needs S3-compatible storage (S3Mock
 * in CI) for the seeded session's file.
 */

const WCAG = ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'];

test('a guest reports a session, the operator hides it, an admin takes it down (451)', async ({
  page,
  browser,
  request,
}, testInfo) => {
  test.setTimeout(150_000);
  const details = `e2e report ${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

  // An operator with an event and one finished guest session.
  await signIn(page);
  const eventId = await createEvent(page, 'Report test');
  const seeded = await seedSession(page, request, eventId);

  // The guest: the share page has a way to report.
  const guestCtx = await browser.newContext({ baseURL: testInfo.project.use.baseURL });
  const guest = await guestCtx.newPage();
  await guest.goto(`/s/${seeded.linkId}?r=booth`);
  await expect(guest.getByRole('heading', { name: 'Here it is' })).toBeVisible();
  await guest.getByRole('link', { name: 'Report this' }).click();
  await expect(guest).toHaveURL(new RegExp(`/report\\?l=${seeded.linkId}&r=booth$`));
  await expect(guest.getByRole('heading', { name: 'Report this content' })).toBeVisible();
  const axe = await new AxeBuilder({ page: guest }).withTags(WCAG).analyze();
  expect(axe.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);

  // The form needs a reason; a reason alone is enough.
  await guest.getByRole('button', { name: 'Send report' }).click();
  await expect(guest.getByRole('alert').filter({ hasText: 'Choose what the problem is' })).toBeVisible();
  await guest.getByRole('radio', { name: 'It may be illegal' }).check();
  await guest.getByLabel('Anything we should know (optional)').fill(details);
  await guest.getByRole('button', { name: 'Send report' }).click();
  await expect(guest.getByRole('heading', { name: 'Thank you' })).toBeVisible();
  // The same reporter reporting the same session again is acknowledged, not duplicated.

  // The operator sees it on the event dashboard (and as a badge), and hides the item at once.
  await page.goto(`/studio/events/${eventId}`);
  await expect(page.getByRole('heading', { name: 'Reports' })).toBeVisible();
  const row = page.getByRole('listitem').filter({ hasText: details });
  await expect(row).toBeVisible();
  await expect(row.getByText('May be illegal')).toBeVisible();
  await expect(page.getByRole('link', { name: /^Reports/ }).first()).toContainText('1');
  await row.getByRole('button', { name: 'Hide now' }).click();
  await expect(page.getByText('Hidden. It is off the share page')).toBeVisible();
  const hidden = await request.get(`/s/${seeded.linkId}`);
  expect(hidden.status()).toBe(410);
  // …and can take it back: the hide is the operator's own.
  await row.getByRole('button', { name: 'Restore' }).click();
  await expect(page.getByText('Restored. Guests can open it again.')).toBeVisible();
  expect((await request.get(`/s/${seeded.linkId}`)).status()).toBe(200);

  // Only platform admins reach /admin: the operator (not on the allowlist) and a signed-out visitor get a 404.
  expect((await page.goto('/admin'))!.status()).toBe(404);
  expect((await page.goto('/admin/reports'))!.status()).toBe(404);
  expect((await guest.goto('/admin'))!.status()).toBe(404);

  // The admin: the queue shows the report with its 24-hour clock.
  const adminCtx = await browser.newContext({ baseURL: testInfo.project.use.baseURL });
  const admin = await adminCtx.newPage();
  await signIn(admin, adminEmail(testInfo.project.name), '/admin/reports');
  const item = admin.getByTestId('report').filter({ hasText: details });
  await expect(item).toBeVisible();
  await expect(item).toHaveAttribute('data-overdue', 'false');
  await expect(item.getByText(/24-hour clock: .* left/)).toBeVisible();

  // Past its 24 hours it is highlighted as overdue.
  const reportId = (await item.getAttribute('data-report-id'))!;
  const aged = await admin.request.post(`/api/test/age-report?id=${reportId}&hours=25`, { headers: e2eHeaders });
  expect(aged.ok()).toBe(true);
  await admin.reload();
  await expect(item).toHaveAttribute('data-overdue', 'true');
  await expect(item.getByText(/overdue/)).toBeVisible();

  // Take it down: illegal content defaults to 451 with the files quarantined.
  await item.getByRole('button', { name: 'Take down' }).click();
  await expect(admin.getByRole('status').filter({ hasText: 'Taken down' })).toBeVisible();
  await admin.getByRole('link', { name: 'Decided' }).click();
  await expect(admin.getByTestId('report').filter({ hasText: details })).toContainText('Taken down');

  // The share page, its download and the operator's view all say it is gone.
  const gone = await guest.goto(`/s/${seeded.linkId}`);
  expect(gone!.status()).toBe(451);
  await expect(guest.getByRole('heading', { name: 'Unavailable for legal reasons' })).toBeVisible();
  const axeGone = await new AxeBuilder({ page: guest }).withTags(WCAG).analyze();
  expect(axeGone.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
  const download = await request.get(`/d/${seeded.outputId}?l=${seeded.linkId}`, { maxRedirects: 0 });
  expect(download.status()).toBe(451);
  // The operator cannot bring back what the platform removed.
  await page.goto(`/studio/events/${eventId}`);
  await expect(page.getByText('Removed by Immersia')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Restore' })).toHaveCount(0);
  // A new report about it is acknowledged as already handled.
  await guest.goto(`/report?l=${seeded.linkId}`);
  await expect(guest.getByText('That content has already been removed')).toBeVisible();

  await guestCtx.close();
  await adminCtx.close();
});

test('a policy takedown answers 410 and a dismissal leaves the session up', async ({
  page,
  browser,
  request,
}, testInfo) => {
  test.setTimeout(150_000);
  await signIn(page);
  const eventId = await createEvent(page, 'Report policy test');
  const a = await seedSession(page, request, eventId);
  const b = await seedSession(page, request, eventId);
  const guestCtx = await browser.newContext({ baseURL: testInfo.project.use.baseURL });
  const guest = await guestCtx.newPage();
  const note = `e2e ${Date.now().toString(36)}`;
  for (const [s, reason] of [
    [a, 'It’s inappropriate or offensive'],
    [b, 'Something else'],
  ] as const) {
    await guest.goto(`/report?l=${s.linkId}`);
    await guest.getByRole('radio', { name: reason }).check();
    await guest.getByLabel('Anything we should know (optional)').fill(`${note} ${s.shortCode}`);
    await guest.getByRole('button', { name: 'Send report' }).click();
    await expect(guest.getByRole('heading', { name: 'Thank you' })).toBeVisible();
  }

  const adminCtx = await browser.newContext({ baseURL: testInfo.project.use.baseURL });
  const admin = await adminCtx.newPage();
  await signIn(admin, adminEmail(testInfo.project.name), '/admin/reports');
  // Inappropriate → a policy takedown (410, files deleted).
  const first = admin.getByTestId('report').filter({ hasText: `${note} ${a.shortCode}` });
  await expect(first.locator('select')).toHaveValue('policy');
  await first.getByRole('button', { name: 'Take down' }).click();
  await expect(admin.getByRole('status').filter({ hasText: 'Taken down' })).toBeVisible();
  // Something else → dismissed.
  const second = admin.getByTestId('report').filter({ hasText: `${note} ${b.shortCode}` });
  await second.getByRole('button', { name: 'Dismiss' }).click();
  await expect(admin.getByRole('status').filter({ hasText: 'Report dismissed' })).toBeVisible();

  expect((await request.get(`/s/${a.linkId}`)).status()).toBe(410);
  expect((await request.get(`/s/${b.linkId}`)).status()).toBe(200);
  await guestCtx.close();
  await adminCtx.close();
});
