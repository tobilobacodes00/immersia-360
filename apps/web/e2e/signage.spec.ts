import { readFile } from 'node:fs/promises';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { createEvent, signIn } from './helpers';

/**
 * Screen 25: the event QR as print-ready signage (DL-5). The files are made in the browser by the
 * same renderer as the preview, so the checks read the downloaded bytes: a real PDF at paper size, a
 * PNG that declares 300 DPI.
 */

const preview = (page: Page, name: string) => page.getByRole('img', { name: `Preview of the ${name}` });

async function openSignage(page: Page, eventId: string) {
  const nav = page.getByRole('navigation', { name: 'Event sections' });
  await nav.getByRole('link', { name: 'QR signage' }).click();
  await expect(page).toHaveURL(new RegExp(`/studio/events/${eventId}/signage$`));
  await expect(nav.getByRole('link', { name: 'QR signage' })).toHaveAttribute('aria-current', 'page');
  await expect(preview(page, 'A4 poster')).toBeVisible();
}

/** Click a download button once the fonts are in, and read what the browser saved. */
async function save(page: Page, button: 'Download PDF' | 'Download PNG') {
  const target = page.getByRole('button', { name: button });
  await expect(target).toBeEnabled({ timeout: 20_000 });
  const [download] = await Promise.all([page.waitForEvent('download'), target.click()]);
  return { name: download.suggestedFilename(), bytes: await readFile(await download.path()) };
}

/** The preview is drawn (paper, ink, accent, the QR), not an empty canvas. */
const colourCount = (page: Page) =>
  page.locator('canvas[role="img"]').evaluate((c: HTMLCanvasElement) => {
    const { data } = c.getContext('2d')!.getImageData(0, 0, c.width, c.height);
    const seen = new Set<string>();
    for (let i = 0; i < data.length; i += 4 * 61) seen.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
    return seen.size;
  });

test.describe('event QR signage (DL-5)', () => {
  test('choose a format, preview it, and download a PDF and a PNG at paper size', async ({ page }) => {
    test.setTimeout(90_000);
    await signIn(page);
    const id = await createEvent(page, 'Signage wedding');
    await openSignage(page, id);

    // The code points at the event gallery, tagged as the event QR route (DL-13).
    await expect(page.getByRole('textbox', { name: 'Gallery link' })).toHaveValue(/\/g\/[\w-]{16}\?r=event_qr$/);
    expect(await colourCount(page)).toBeGreaterThan(3);

    // Switching format redraws the preview and explains how to use it.
    await page.getByRole('radio', { name: 'A5 flyer' }).click();
    await expect(preview(page, 'A5 flyer')).toBeVisible();
    await expect(page.getByText('148 × 210 mm')).toBeVisible();
    await page.getByRole('radio', { name: 'Table tent' }).click();
    await expect(preview(page, 'Table tent')).toBeVisible();
    await expect(page.getByText(/fold along the dashed line/)).toBeVisible();
    expect(await colourCount(page)).toBeGreaterThan(3);

    // The wording is editable; a defaults line is translated.
    await expect(page.getByRole('textbox', { name: 'Headline' })).toHaveValue('Get your photos & videos');
    await page.getByRole('textbox', { name: 'Headline' }).fill('Tonight’s photos, right here');

    const a11y = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
    expect(a11y.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);

    // Table tent PDF: an A4 sheet in portrait, one JPEG at 300 DPI over the whole page.
    const tent = await save(page, 'Download PDF');
    expect(tent.name).toBe('signage-wedding-tent.pdf');
    expect(tent.bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(tent.bytes.subarray(-6).toString('latin1')).toBe('%%EOF\n');
    const head = tent.bytes.subarray(0, 700).toString('latin1');
    expect(head).toContain('/MediaBox [0 0 595.28 841.89]');
    expect(head).toContain('/Width 2480 /Height 3508');
    expect(head).toContain('/Filter /DCTDecode');

    // A5 flyer PDF.
    await page.getByRole('radio', { name: 'A5 flyer' }).click();
    await expect(preview(page, 'A5 flyer')).toBeVisible();
    const flyer = await save(page, 'Download PDF');
    expect(flyer.name).toBe('signage-wedding-a5.pdf');
    expect(flyer.bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    const flyerHead = flyer.bytes.subarray(0, 700).toString('latin1');
    expect(flyerHead).toContain('/MediaBox [0 0 419.53 595.28]');
    expect(flyerHead).toContain('/Width 1748 /Height 2480');

    // A4 poster PNG: 2480 × 3508 px, declared as 300 DPI (11811 pixels per metre).
    await page.getByRole('radio', { name: 'A4 poster' }).click();
    await expect(preview(page, 'A4 poster')).toBeVisible();
    const poster = await save(page, 'Download PNG');
    expect(poster.name).toBe('signage-wedding-a4.png');
    expect([...poster.bytes.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect([poster.bytes.readUInt32BE(16), poster.bytes.readUInt32BE(20)]).toEqual([2480, 3508]);
    expect(poster.bytes.subarray(37, 41).toString('latin1')).toBe('pHYs');
    expect([poster.bytes.readUInt32BE(41), poster.bytes.readUInt32BE(45)]).toEqual([11811, 11811]);
  });

  test('copies the gallery link', async ({ page, context, browserName }) => {
    test.skip(browserName !== 'chromium', 'Clipboard permissions can only be granted in Chromium');
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await signIn(page);
    const id = await createEvent(page, 'Copy link wedding', 'Photo Booth');
    await openSignage(page, id);
    const link = await page.getByRole('textbox', { name: 'Gallery link' }).inputValue();
    await page.getByRole('button', { name: 'Copy link' }).click();
    await expect(page.getByRole('button', { name: 'Copied' })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(link);
  });
});
