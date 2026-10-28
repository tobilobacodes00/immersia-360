import AxeBuilder from '@axe-core/playwright';
import { expect, test, type APIRequestContext } from '@playwright/test';
import { adminEmail, createEvent, e2eHeaders, seedSession, signIn } from './helpers';

/**
 * First-party analytics (PRD "Tracked events", "Analytics are first-party, anonymous on guest
 * pages"): what a guest's page view records (and what it does not), what a booth can report over
 * POST /api/t and what is refused, and that the admin console computes its numbers from them.
 */

interface Row {
  name: string;
  props: Record<string, unknown>;
  source: string;
  eventId: string | null;
  occurredAt: string;
}

async function rowsFor(request: APIRequestContext, query: string): Promise<Row[]> {
  const res = await request.get(`/api/test/analytics?${query}`, { headers: e2eHeaders });
  expect(res.ok()).toBe(true);
  return ((await res.json()) as { rows: Row[] }).rows;
}

test('a share-page view records its route, anonymously, and a downloaded file the same route (?route=print)', async ({
  page,
  browser,
  request,
}, testInfo) => {
  test.setTimeout(120_000);
  await signIn(page);
  const eventId = await createEvent(page, 'Analytics test');
  const s = await seedSession(page, request, eventId);

  const guestCtx = await browser.newContext({ baseURL: testInfo.project.use.baseURL });
  const guest = await guestCtx.newPage();
  // ?route= is accepted as the spelled-out form of ?r=
  await guest.goto(`/s/${s.linkId}?route=print`);
  await expect(guest.getByRole('heading', { name: 'Here it is' })).toBeVisible();
  await expect
    .poll(
      async () => (await rowsFor(request, `eventId=${eventId}`)).filter((r) => r.name === 'share_page_viewed').length,
    )
    .toBeGreaterThan(0);
  const view = (await rowsFor(request, `eventId=${eventId}`)).find((r) => r.name === 'share_page_viewed')!;
  expect(view.props).toMatchObject({ output_kind: 'session', route: 'print', session_id: s.sessionId });
  expect(['chrome', 'safari']).toContain(view.props.browser);
  expect(view.source).toBe('server');
  // Anonymous: nothing in the event but the catalogue's own fields (no address, no user agent, no cookie id).
  expect(Object.keys(view.props).sort()).toEqual(['browser', 'output_kind', 'route', 'session_id']);
  expect((await guestCtx.cookies()).filter((c) => /analytics|_ga|visitor/i.test(c.name))).toEqual([]);

  // The download link carries the route on, and the download is recorded against it.
  const href = (await guest.getByRole('link', { name: 'Download' }).first().getAttribute('href'))!;
  expect(href).toContain('r=print');
  const redirect = await request.get(href, { maxRedirects: 0 });
  expect(redirect.status()).toBe(302);
  await expect
    .poll(async () => (await rowsFor(request, `eventId=${eventId}`)).some((r) => r.name === 'file_downloaded'))
    .toBe(true);
  const download = (await rowsFor(request, `eventId=${eventId}`)).find((r) => r.name === 'file_downloaded')!;
  expect(download.props).toMatchObject({ route: 'print', session_id: s.sessionId, output_kind: 'strip' });

  // A scan of the big screen's QR is a display_qr_scanned, by layout.
  await guest.goto(`/s/${s.linkId}?r=display&dl=mosaic`);
  await expect
    .poll(async () => (await rowsFor(request, `eventId=${eventId}`)).some((r) => r.name === 'display_qr_scanned'))
    .toBe(true);
  const scan = (await rowsFor(request, `eventId=${eventId}`)).find((r) => r.name === 'display_qr_scanned')!;
  expect(scan.props).toEqual({ layout: 'mosaic' });

  // A messaging app unfurling the link is not a guest.
  await request.get(`/s/${s.linkId}?r=message`, { headers: { 'user-agent': 'WhatsApp/2.24.10.80 A' } });
  await guest.waitForTimeout(1500);
  expect(
    (await rowsFor(request, `eventId=${eventId}`)).filter(
      (r) => r.name === 'share_page_viewed' && r.props.route === 'message',
    ),
  ).toEqual([]);
  await guestCtx.close();
});

test('POST /api/t takes a booth’s events, refuses what it must, dedupes retries, and the admin metrics are computed from them', async ({
  page,
  browser,
  request,
}, testInfo) => {
  test.setTimeout(150_000);
  const mine = testInfo.project.name === 'webkit' ? 1 : 0;
  // A render path only this project reports on, so the percentiles below are exactly its own events.
  const path = mine ? 'server' : 'wasm';
  const id = (n: number) => `0192e0aa-0000-7000-8000-${String(mine * 1000 + n).padStart(12, '0')}`;

  await signIn(page);
  const eventId = await createEvent(page, 'Ingestion test');
  const seeded = await seedSession(page, request, eventId);
  const auth = { authorization: `Device ${seeded.deviceToken}` };
  const post = (data: unknown, headers: Record<string, string> = auth) =>
    request.post('/api/t', { headers: { ...headers, 'content-type': 'application/json' }, data });

  const now = Date.now();
  const ready = [10, 20, 30, 40, 50];
  const batch = {
    sentAt: now,
    events: [
      ...ready.map((s, i) => ({
        id: id(i),
        at: now - 5_000,
        eventId,
        event: {
          name: 'render_completed',
          render_ms: (i + 1) * 1000,
          path,
          preset: 'e2e',
          effects_count: 0,
          seconds_since_take: s,
        },
      })),
      { id: id(5), at: now - 1_000, eventId, event: { name: 'qr_shown', seconds_since_take: 3 } },
    ],
  };
  const first = (await (await post(batch)).json()) as { accepted: number; duplicates: number; rejected: unknown[] };
  // (A retried test attempt finds its events already stored: that is the dedupe.)
  expect(first.accepted + first.duplicates).toBe(6);
  expect(first.rejected).toEqual([]);
  // The same batch again, as after a lost response: nothing counted twice.
  const again = (await (await post(batch)).json()) as { accepted: number; duplicates: number };
  expect(again).toMatchObject({ accepted: 0, duplicates: 6 });

  // Each event is judged alone: bad numbers, events a booth may not report, and unknown names are refused.
  const mixed = await post({
    sentAt: now,
    events: [
      { id: id(10), at: now, eventId, event: { name: 'print_sent', size: '2x6', copies: 1, double_strip: false } },
      {
        id: id(11),
        at: now,
        eventId,
        event: { name: 'render_completed', render_ms: -1, path, preset: 'x', effects_count: 0 },
      },
      { id: id(12), at: now, eventId, event: { name: 'share_page_viewed', output_kind: 'session', route: 'booth' } },
      { id: id(13), at: now, eventId, event: { name: 'upload_completed', target: 'drive', bytes: 1, retries: 0 } },
      { id: id(14), at: now, eventId, event: { name: 'page_scrolled' } },
    ],
  });
  expect(mixed.status()).toBe(200);
  const refused = ((await mixed.json()) as { rejected: { index: number; reason: string }[] }).rejected;
  expect(refused).toEqual([
    { index: 1, reason: 'invalid' },
    { index: 2, reason: 'not_allowed' },
    { index: 3, reason: 'not_allowed' },
    { index: 4, reason: 'invalid' },
  ]);

  // A booth whose clock is three hours slow still has its event dated correctly.
  const slow = now - 3 * 3_600_000;
  const marker = 7.5 + mine / 10;
  await post({
    sentAt: slow,
    events: [{ id: id(20), at: slow - 2_000, eventId, event: { name: 'qr_shown', seconds_since_take: marker } }],
  });
  const stored = (await rowsFor(request, `eventId=${eventId}`)).find(
    (r) => r.name === 'qr_shown' && r.props.seconds_since_take === marker,
  )!;
  expect(Math.abs(new Date(stored.occurredAt).getTime() - (Date.now() - 2_000))).toBeLessThan(5 * 60_000);
  expect(stored.source).toBe('device');

  // Credentials, shape and size.
  expect((await post(batch, {})).status()).toBe(401);
  expect((await post(batch, { authorization: 'Device not-a-real-token' })).status()).toBe(401);
  expect((await post({ events: [] })).status()).toBe(400);
  expect((await post({ events: 'nope' })).status()).toBe(400);
  expect((await post({ pad: 'x'.repeat(70_000) })).status()).toBe(413);

  // The admin console computes capture-to-QR by render path (percentile_cont) from those events.
  const adminCtx = await browser.newContext({ baseURL: testInfo.project.use.baseURL });
  const admin = await adminCtx.newPage();
  await signIn(admin, adminEmail(testInfo.project.name), '/admin');
  await expect(admin.getByRole('heading', { name: 'Success metrics' })).toBeVisible();
  await expect(admin.locator('[data-metric]')).toHaveCount(6);
  const row = admin.getByRole('row').filter({ has: admin.getByRole('rowheader', { name: path, exact: true }) });
  // ready seconds 10…50: p50 30, p90 46; render 1…5 s: p50 3,000 ms, p90 4,600 ms
  await expect(row).toContainText('30.0 s');
  await expect(row).toContainText('46.0 s');
  await expect(row).toContainText('3,000 ms');
  await expect(row).toContainText('4,600 ms');
  // 30 and 90 day windows
  await admin.getByRole('link', { name: '30 days' }).click();
  await expect(admin).toHaveURL(/window=30/);
  await expect(
    admin.getByRole('row').filter({ has: admin.getByRole('rowheader', { name: path, exact: true }) }),
  ).toContainText('46.0 s');
  const axe = await new AxeBuilder({ page: admin }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  expect(axe.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);

  // The monthly bill is stored and divides into cost per active operator.
  await admin.getByLabel('Bill (USD)').fill('12.34');
  await admin.getByRole('button', { name: 'Save bill' }).click();
  await expect(admin.getByRole('status').filter({ hasText: 'The monthly bill was saved' })).toBeVisible();
  await expect(admin.getByRole('row').filter({ hasText: '$12.34' }).first()).toBeVisible();
  await adminCtx.close();
});
