import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { createEvent, open, signIn } from './helpers';

/**
 * DL-10: the event gallery's link on an NFC tag or wristband. Web NFC exists only in Chrome on Android, so on desktop
 * the studio must say so and hand over the link (tagged as the NFC route, DL-13) for any NFC-writing app; and where
 * the API exists, the button writes a single URL record. The API is stood in for here: there is no tag to hold.
 */

const scan = (page: Page) => new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
const violations = async (page: Page) => (await scan(page)).violations.map((v) => `${v.id}: ${v.nodes.length}`);

/** The tagged link in the NFC section (the dashboard and the signage screen both have one). */
const nfcLink = (page: Page) => page.getByRole('textbox', { name: 'NFC link' });

type FakeWindow = {
  NDEFReader?: unknown;
  __nfcWrites?: { message: unknown; overwrite?: boolean; hasSignal: boolean }[];
};

test.describe('NFC tags and wristbands (DL-10)', () => {
  test('on a browser without Web NFC the dashboard explains it and gives the link for any NFC-writing app', async ({
    page,
    context,
    browserName,
  }) => {
    test.setTimeout(90_000);
    await signIn(page);
    const id = await createEvent(page, 'NFC wedding');
    await open(page, `/studio/events/${id}`);

    // The link carries the NFC route, so analytics can count guests who tapped (DL-13).
    await expect(nfcLink(page)).toHaveValue(/\/g\/[\w-]{16}\?r=nfc$/);
    // No NDEFReader here (desktop Chrome, WebKit): no write button, and the guidance says why and what to do instead.
    await expect(page.getByRole('button', { name: 'Write to NFC tag' })).toHaveCount(0);
    await expect(page.getByText(/Writing tags from this browser isn.t possible/)).toBeVisible();
    await expect(page.getByText(/NFC Tools or NXP TagWriter/)).toBeVisible();

    // Tips for tags and wristbands are one click away, and keyboard-reachable.
    const tips = page.getByText('Tips for tags and wristbands');
    await tips.click();
    await expect(page.getByText(/NTAG213, NTAG215 or NTAG216/)).toBeVisible();
    await expect(page.getByText(/Don.t lock a tag until you have tested it/)).toBeVisible();

    expect(await violations(page)).toEqual([]);

    if (browserName === 'chromium') {
      await context.grantPermissions(['clipboard-read', 'clipboard-write']);
      const link = await nfcLink(page).inputValue();
      await page.getByRole('button', { name: 'Copy NFC link' }).click();
      await expect(page.getByRole('button', { name: 'Copied' })).toBeVisible();
      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(link);
    }

    // The signage screen has the same section: the poster and the tag go together.
    await page.getByRole('navigation', { name: 'Event sections' }).getByRole('link', { name: 'QR signage' }).click();
    await expect(page).toHaveURL(new RegExp(`/studio/events/${id}/signage$`));
    await expect(nfcLink(page)).toHaveValue(/\/g\/[\w-]{16}\?r=nfc$/);
    await expect(page.getByText(/Writing tags from this browser isn.t possible/)).toBeVisible();
    // …and the QR's own link keeps its own route.
    await expect(page.getByRole('textbox', { name: 'Gallery link' })).toHaveValue(/\?r=event_qr$/);
    expect(await violations(page)).toEqual([]);
  });

  test('where Web NFC exists, the button writes one URL record and says when it is done', async ({ page }) => {
    test.setTimeout(90_000);
    await page.addInitScript(() => {
      const w = window as unknown as FakeWindow;
      w.__nfcWrites = [];
      class FakeReader {
        async write(message: unknown, options: { overwrite?: boolean; signal?: unknown }) {
          w.__nfcWrites!.push({
            message,
            overwrite: options.overwrite,
            hasSignal: options.signal instanceof AbortSignal,
          });
        }
      }
      Object.defineProperty(window, 'NDEFReader', { value: FakeReader, configurable: true });
    });
    await signIn(page);
    const id = await createEvent(page, 'NFC tap');
    await open(page, `/studio/events/${id}`);

    // The page is served as unsupported first and corrected in the browser: wait for the button.
    const write = page.getByRole('button', { name: 'Write to NFC tag' });
    await expect(write).toBeVisible();
    await expect(page.getByText(/Writing tags from this browser isn.t possible/)).toHaveCount(0);
    const link = await nfcLink(page).inputValue();
    await write.click();
    await expect(page.getByText(/Written\. Tap the tag with another phone/)).toBeVisible();

    const writes = await page.evaluate(() => (window as unknown as FakeWindow).__nfcWrites);
    expect(writes).toHaveLength(1);
    expect(writes![0]).toEqual({
      message: { records: [{ recordType: 'url', data: link }] },
      // A tag that already holds something is replaced, not added to; and the wait can be cancelled.
      overwrite: true,
      hasSignal: true,
    });
    expect(link).toMatch(/\?r=nfc$/);
    expect(await violations(page)).toEqual([]);
  });

  test('says what to do when the phone refuses, or the tag moves away', async ({ page }) => {
    test.setTimeout(90_000);
    await page.addInitScript(() => {
      let attempt = 0;
      class FakeReader {
        async write() {
          attempt++;
          throw new DOMException('refused', attempt === 1 ? 'NotAllowedError' : 'NetworkError');
        }
      }
      Object.defineProperty(window, 'NDEFReader', { value: FakeReader, configurable: true });
    });
    await signIn(page);
    const id = await createEvent(page, 'NFC refused');
    await open(page, `/studio/events/${id}`);
    const write = page.getByRole('button', { name: 'Write to NFC tag' });
    await write.click();
    await expect(page.getByRole('alert').filter({ hasText: /blocked NFC/ })).toBeVisible();
    await write.click();
    await expect(page.getByRole('alert').filter({ hasText: /moved away before it was written/ })).toBeVisible();
    expect(await violations(page)).toEqual([]);
  });
});
