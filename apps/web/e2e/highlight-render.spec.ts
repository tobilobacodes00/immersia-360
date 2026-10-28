import { readFile } from 'node:fs/promises';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { reportPageErrors } from './booth-helpers';
import { createEvent, open, signIn } from './helpers';
import { deviceToken, registerSession, stripPng, type Registered } from './session-helpers';

/**
 * LIV-14, the highlight reel, end to end: captures in the gallery (registered through the booth's API, no camera),
 * the reel built in the operator's browser by the real render engine, previewed, downloaded, published to the top of
 * the client gallery, and pulled again when a guest erases their session. Runs in the render project, last and alone
 * (a software-GL render is the slow part).
 */

const scan = (page: Page) => new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
const violations = async (page: Page) => (await scan(page)).violations.map((v) => `${v.id}: ${v.nodes.length}`);

type Rgb = [number, number, number];
const STRIPS: [Rgb, Rgb][] = [
  [
    [208, 32, 32],
    [32, 32, 208],
  ],
  [
    [32, 160, 64],
    [240, 200, 32],
  ],
  [
    [128, 32, 176],
    [32, 176, 176],
  ],
];

const duration = (page: Page, label: string) =>
  page.getByLabel(label).evaluate((v: HTMLVideoElement) => (Number.isFinite(v.duration) ? v.duration : 0));

/** The gallery lists what Live Display may show (a session captured while it is off is never listed): turn it on first. */
async function enableLiveDisplay(page: Page, eventId: string) {
  const toggle = page.getByRole('switch', { name: 'Show captures on screens' });
  await open(page, `/studio/events/${eventId}/live`);
  await toggle.click();
  // The change is saved by a server action: wait until a fresh load shows it stuck.
  await expect(async () => {
    await open(page, `/studio/events/${eventId}/live`);
    await expect(toggle).toBeChecked({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
}

test.beforeEach(({ page }) => reportPageErrors(page));

// @media: WebKit has no H.264 WebCodecs render; the webkit project skips what carries this tag.
test.describe('highlight reel (LIV-14) @media', () => {
  test('builds from the gallery, previews, downloads, publishes to the client gallery, and goes when a guest erases their session', async ({
    page,
    browser,
  }) => {
    test.setTimeout(420_000);
    await signIn(page);
    const eventId = await createEvent(page, 'Reel gala', 'Photo Booth');
    await enableLiveDisplay(page, eventId);

    // Three guests' photo strips, each a different colour, through the booth's own API.
    const token = await deviceToken(page, eventId);
    const sessions: Registered[] = [];
    for (const [top, bottom] of STRIPS)
      sessions.push(await registerSession(page, token, eventId, stripPng(top, bottom, 90, 270)));

    // They reach the gallery once the booth's uploads are confirmed.
    await expect(async () => {
      await open(page, `/studio/events/${eventId}`);
      await expect(page.getByText('3 captures so far')).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 60_000 });

    // DL-10: the same page carries the NFC link, tagged as the NFC route; the gallery's slug comes from it.
    const nfc = await page.getByRole('textbox', { name: 'NFC link' }).inputValue();
    const slug = /\/g\/([\w-]{16})\?r=nfc$/.exec(nfc)?.[1];
    expect(slug).toBeTruthy();

    // The reel: 30 s at 720p keeps a software-rendered build short.
    const build = page.getByRole('button', { name: 'Build highlight reel' });
    await expect(build).toBeVisible();
    await page.getByRole('radio', { name: '720p' }).click();
    await page.getByRole('radio', { name: '30 s' }).click();
    await build.click();
    await expect(page.getByRole('progressbar', { name: 'Building the reel' })).toBeVisible();
    const ready = page.getByRole('heading', { name: 'Your reel is ready' });
    const failed = page.getByRole('alert').filter({ hasText: /reel|capture|browser/i });
    await expect(ready.or(failed)).toBeVisible({ timeout: 240_000 });
    if (await failed.isVisible()) throw new Error(`The reel failed: ${await failed.innerText()}`);

    // Three strips, each a few seconds with a cross-fade between: well over the cards' five.
    await expect(page.getByText(/^\d+:\d{2} · 3 captures/)).toBeVisible();
    await expect.poll(() => duration(page, 'Preview of the highlight reel'), { timeout: 20_000 }).toBeGreaterThan(8);
    expect(
      await page
        .getByLabel('Preview of the highlight reel')
        .evaluate((v: HTMLVideoElement) => [v.videoWidth, v.videoHeight]),
    ).toEqual([720, 1280]);
    expect(await violations(page)).toEqual([]);

    // Download: a real MP4 under a name that says what it is.
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Download MP4' }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/^Reel-gala-\d+s-highlights\.mp4$/);
    const bytes = await readFile(await download.path());
    expect(bytes.subarray(4, 8).toString('latin1')).toBe('ftyp');

    // Publish: it replaces nothing yet, and the operator sees it on the card.
    await page.getByRole('button', { name: 'Show on the client gallery' }).click();
    await expect(page.getByText('It is on the client gallery now.')).toBeVisible({ timeout: 90_000 });
    await expect(page.getByLabel('The published highlight reel')).toBeVisible();

    // The client gallery opens with it, and the NFC route follows a guest from the gallery to each capture (DL-13).
    const guestContext = await browser.newContext({ baseURL: test.info().project.use.baseURL });
    const guest = await guestContext.newPage();
    await guest.goto(`/g/${slug}?r=nfc`);
    await expect(guest.getByRole('heading', { name: 'Highlight reel' })).toBeVisible();
    await expect.poll(() => duration(guest, 'Highlight reel of the event'), { timeout: 30_000 }).toBeGreaterThan(8);
    await expect(guest.getByRole('link', { name: 'Download the reel' })).toHaveAttribute('href', /.+/);
    const hrefs = await guest.locator('ul a[href^="/s/"]').evaluateAll((a) => a.map((x) => x.getAttribute('href')));
    expect(hrefs).toHaveLength(3);
    for (const href of hrefs) expect(href).toMatch(/^\/s\/[\w-]+\?r=nfc$/);
    expect(await violations(guest)).toEqual([]);

    // A guest erases their session: the reel, which holds their footage, goes with it.
    await guest.goto(`/s/${sessions[0]!.linkId}`);
    await guest.getByText('Delete my photos and videos').click();
    await guest.getByRole('button', { name: 'Yes, delete my files' }).click();
    await expect(guest.getByRole('heading', { name: 'Your files were deleted' })).toBeVisible();
    await guest.goto(`/g/${slug}`);
    await expect(guest.getByRole('heading', { name: 'Highlight reel' })).toHaveCount(0);
    await expect(guest.getByLabel('Highlight reel of the event')).toHaveCount(0);
    await guestContext.close();
    await open(page, `/studio/events/${eventId}`);
    await expect(page.getByLabel('The published highlight reel')).toHaveCount(0);
    await expect(page.getByText('2 captures so far')).toBeVisible();
  });
});
