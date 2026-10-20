import { randomBytes, randomUUID } from 'node:crypto';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { createEvent, open, signIn } from './helpers';

/**
 * Privacy (SHR-6 and the PRD's privacy obligations): the optional guest form, what the operator can
 * do with the details, a guest erasing their own session, the by-email deletion request, and
 * deleting the organization. Sessions are registered through the booth's own API (a device token and
 * a presigned upload to S3-compatible storage), so no camera or render is involved.
 */

// A real 1×1 PNG: the share page shows it as the guest's "photo strip".
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

const axe = (page: Page) => new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
const violations = async (page: Page) => (await axe(page)).violations.map((v) => `${v.id}: ${v.nodes.length}`);

/** Register this browser as a booth device and return its token. */
async function deviceToken(page: Page, eventId: string): Promise<string> {
  await open(page, `/booth/${eventId}`);
  await page.getByRole('button', { name: 'Register and continue' }).click();
  await page.waitForFunction(() => localStorage.getItem('immersia.device.v1') !== null);
  return page.evaluate(() => (JSON.parse(localStorage.getItem('immersia.device.v1')!) as { token: string }).token);
}

interface Registered {
  linkId: string;
  sessionId: string;
  outputId: string;
  token: string;
  eventId: string;
}

/** What a booth does: register a session with one photo strip, upload it, confirm it. */
async function registerSession(page: Page, token: string, eventId: string): Promise<Registered> {
  const linkId = randomBytes(16).toString('base64url');
  const sessionId = randomUUID();
  const outputId = randomUUID();
  const auth = { authorization: `Device ${token}` };
  const res = await page.request.post('/api/booth/sessions', {
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
          id: outputId,
          takeId: null,
          kind: 'strip',
          mime: 'image/png',
          bytes: PNG.length,
          width: 400,
          height: 1200,
          durationMs: 0,
        },
      ],
    },
  });
  expect(res.ok(), await res.text()).toBe(true);
  const { uploads } = (await res.json()) as {
    uploads: { outputId: string; url: string; headers: Record<string, string> }[];
  };
  const ticket = uploads[0]!;
  const put = await page.request.put(ticket.url, { headers: ticket.headers, data: PNG });
  expect(put.ok()).toBe(true);
  const done = await page.request.post(`/api/booth/outputs/${ticket.outputId}/complete`, { headers: auth, data: {} });
  expect(done.ok()).toBe(true);
  return { linkId, sessionId, outputId: ticket.outputId, token, eventId };
}

/** Turn the guest form on in Setup → Sharing, with the operator's own policy link and sentence. */
async function enableGuestForm(page: Page, eventId: string) {
  await open(page, `/studio/events/${eventId}/setup`);
  await page.getByRole('switch', { name: 'Ask guests for their details' }).click();
  await page.getByLabel('Your privacy policy link').fill('https://studio.example/privacy');
  await page.getByLabel('Extra consent sentence').fill('Add me to the newsletter.');
  await expect(page.getByText('All changes saved')).toBeVisible({ timeout: 10_000 });
}

async function guestPage(browser: Browser, path: string) {
  const context = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  const page = await context.newPage();
  await page.goto(path);
  return { context, page };
}

test.describe('guest form, erasure and the operator side (SHR-6, GDPR/NDPA)', () => {
  test('skip works, a submission reaches the operator, the CSV is safe, and a guest can delete their session', async ({
    page,
    browser,
  }) => {
    test.setTimeout(120_000);
    await signIn(page);
    const eventId = await createEvent(page, 'Privacy test');
    await enableGuestForm(page, eventId);
    await expect(page.getByText('What guests will tick')).toBeVisible();
    await expect(page.getByText(/I agree that .* may keep my name and email address/)).toBeVisible();

    const token = await deviceToken(page, eventId);
    const session = await registerSession(page, token, eventId);

    // A guest who skips still gets their files, and is not asked again in this browser.
    const skipper = await guestPage(browser, `/s/${session.linkId}`);
    await expect(skipper.page.getByRole('heading', { name: 'Before you download' })).toBeVisible();
    await expect(skipper.page.getByRole('img', { name: 'Photo strip' })).toBeVisible();
    await expect(skipper.page.getByRole('link', { name: 'Download' })).toHaveCount(0);
    await expect(skipper.page.getByRole('checkbox')).not.toBeChecked();
    await expect(skipper.page.getByRole('link', { name: 'Read the privacy notice' })).toHaveAttribute(
      'href',
      'https://studio.example/privacy',
    );
    expect(await violations(skipper.page)).toEqual([]);
    await skipper.page.getByRole('button', { name: 'Skip: just my files' }).click();
    await expect(skipper.page.getByRole('link', { name: 'Download' }).first()).toBeVisible();
    await expect(skipper.page.getByRole('heading', { name: 'Before you download' })).toHaveCount(0);
    await skipper.page.reload();
    await expect(skipper.page.getByRole('link', { name: 'Download' }).first()).toBeVisible();
    await expect(skipper.page.getByRole('heading', { name: 'Before you download' })).toHaveCount(0);
    await skipper.context.close();

    // A guest who fills it in: the box must be ticked to send, then the files appear.
    const guest = await guestPage(browser, `/s/${session.linkId}`);
    await guest.page.getByLabel('Name (optional)').fill('=1+1');
    await guest.page.getByLabel('Email', { exact: true }).fill('Ada@Example.com');
    await guest.page.getByRole('button', { name: 'Send my details' }).click();
    await expect(guest.page.getByRole('heading', { name: 'Before you download' })).toBeVisible(); // blocked: unticked
    await guest.page.getByRole('checkbox').check();
    await guest.page.getByRole('button', { name: 'Send my details' }).click();
    await expect(guest.page.getByText(/Your details were sent to/)).toBeVisible();
    const href = (await guest.page.getByRole('link', { name: 'Download' }).first().getAttribute('href'))!;
    expect((await guest.page.request.get(href, { maxRedirects: 0 })).status()).toBe(302);

    // The operator sees the contact, with the consent proof.
    await open(page, `/studio/events/${eventId}/guests`);
    await expect(page.getByRole('cell', { name: 'ada@example.com' })).toBeVisible();
    await page.getByText('Consent wording').first().click();
    await expect(page.getByText(/Add me to the newsletter\./)).toBeVisible();
    await expect(page.getByText('https://studio.example/privacy')).toBeVisible();
    expect(await violations(page)).toEqual([]);
    await page.getByLabel('Search by name or email').fill('nobody');
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(page.getByText('No contacts match “nobody”.')).toBeVisible();

    // CSV: UTF-8 with a BOM, and the guest-typed "=1+1" is defused.
    const csv = await page.request.get(`/api/events/${eventId}/guests`);
    expect(csv.status()).toBe(200);
    expect(csv.headers()['content-type']).toContain('text/csv');
    const bytes = await csv.body();
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const text = bytes.toString('utf8');
    expect(text).toContain('"ada@example.com"');
    expect(text).toContain(`"'=1+1"`);
    expect(text).toContain('Add me to the newsletter.');

    // The guest deletes their own session: the link then says so, and nothing downloads.
    await guest.page.getByText('Delete my photos and videos').click();
    await guest.page.getByRole('button', { name: 'Yes, delete my files' }).click();
    await expect(guest.page.getByRole('heading', { name: 'Your files were deleted' })).toBeVisible();
    expect(await violations(guest.page)).toEqual([]);
    expect((await guest.page.goto(`/s/${session.linkId}`))!.status()).toBe(410);
    await expect(guest.page.getByRole('heading', { name: 'Your files were deleted' })).toBeVisible();
    expect((await guest.page.request.get(href, { maxRedirects: 0 })).status()).toBe(410);
    await guest.context.close();

    // Their details went with the session.
    await open(page, `/studio/events/${eventId}/guests`);
    await expect(page.getByText('No contacts yet')).toBeVisible();

    // A booth still holding the session is refused, not allowed to bring it back.
    const again = await page.request.post('/api/booth/sessions', {
      headers: { authorization: `Device ${token}` },
      data: {
        id: session.sessionId,
        eventId,
        linkId: session.linkId,
        shortCode: null,
        capturedAt: new Date().toISOString(),
        optedOutOfDisplay: false,
        takes: [],
        outputs: [
          {
            id: session.outputId,
            takeId: null,
            kind: 'strip',
            mime: 'image/png',
            bytes: PNG.length,
            width: 400,
            height: 1200,
            durationMs: 0,
          },
        ],
      },
    });
    expect(again.status()).toBe(410);
    expect(((await again.json()) as { error: string }).error).toBe('session_erased');
    const late = await page.request.post(`/api/booth/outputs/${session.outputId}/complete`, {
      headers: { authorization: `Device ${token}` },
      data: {},
    });
    expect(late.status()).toBe(410);
  });

  test('an operator deletes everything held under an email address, sessions included', async ({ page, browser }) => {
    test.setTimeout(120_000);
    await signIn(page);
    const eventId = await createEvent(page, 'Request test');
    await enableGuestForm(page, eventId);
    const session = await registerSession(page, await deviceToken(page, eventId), eventId);

    const guest = await guestPage(browser, `/s/${session.linkId}`);
    await guest.page.getByLabel('Email', { exact: true }).fill('request@example.com');
    await guest.page.getByRole('checkbox').check();
    await guest.page.getByRole('button', { name: 'Send my details' }).click();
    await expect(guest.page.getByText(/Your details were sent to/)).toBeVisible();

    await open(page, '/studio/settings');
    expect(await violations(page)).toEqual([]);
    await page.getByLabel('Guest’s email address').fill('REQUEST@example.com');
    await page.getByRole('button', { name: 'Find', exact: true }).click();
    await expect(page.getByText(/1 contact found under request@example\.com, and 1 session with files/)).toBeVisible();
    await page.getByLabel(/Also delete their photos and videos/).check();
    await page.getByRole('button', { name: 'Delete their data' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(page.getByText('1 contact and 1 session deleted.')).toBeVisible();

    // Their link now says it was deleted, and the operator's list is empty.
    expect((await guest.page.goto(`/s/${session.linkId}`))!.status()).toBe(410);
    await expect(guest.page.getByRole('heading', { name: 'Your files were deleted' })).toBeVisible();
    await guest.context.close();
    await open(page, `/studio/events/${eventId}/guests`);
    await expect(page.getByText('No contacts yet')).toBeVisible();
  });

  test('the owner exports their data and deletes the organization', async ({ page }) => {
    await signIn(page);
    await createEvent(page, 'Doomed event');
    await open(page, '/studio/settings');

    const exported = await page.request.get('/api/studio/export');
    expect(exported.status()).toBe(200);
    expect(exported.headers()['content-disposition']).toMatch(/attachment; filename="immersia-360-.*\.json"/);
    const data = (await exported.json()) as { format: string; events: { name: string }[]; devices: unknown[] };
    expect(data.format).toBe('immersia-360-export');
    expect(data.events.map((e) => e.name)).toContain('Doomed event');
    expect(JSON.stringify(data)).not.toMatch(/tokenHash|token_hash|encryptedRefreshToken/);

    const name = (await page.locator('dd').first().innerText()).trim();
    await page.getByRole('button', { name: 'Delete organization…' }).click();
    const dialog = page.getByRole('dialog');
    const confirm = dialog.getByRole('button', { name: 'Delete everything' });
    await expect(confirm).toBeDisabled();
    await dialog.getByRole('textbox').fill(`${name} nope`);
    await expect(confirm).toBeDisabled();
    await dialog.getByRole('textbox').fill(name);
    await confirm.click();

    // Back in the studio, in a fresh organization: the old events are gone.
    await expect(page).toHaveURL(/\/studio$/);
    await open(page, '/studio/events');
    await expect(page.getByText('Doomed event')).toHaveCount(0);
  });

  test('the privacy notice and terms are public, in every language, with no violations', async ({ page }) => {
    for (const path of ['/privacy', '/terms']) {
      await open(page, path);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      expect(await violations(page)).toEqual([]);
    }
    await open(page, '/privacy');
    await expect(page.getByRole('heading', { name: 'No ads, no trackers' })).toBeVisible();
    await page.getByRole('combobox', { name: 'Language' }).selectOption('es');
    await expect(page.getByRole('heading', { name: 'Sin anuncios ni rastreadores' })).toBeVisible();
    await page.getByRole('combobox', { name: 'Language' }).selectOption('pt');
    await expect(page.getByRole('heading', { name: 'Sem anúncios, sem rastreadores' })).toBeVisible();
  });
});
