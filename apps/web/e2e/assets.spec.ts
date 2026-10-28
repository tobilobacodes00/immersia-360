import { deflateSync } from 'node:zlib';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { open, settled, signIn } from './helpers';

/**
 * Screen 8, the asset library: upload (checked in the browser, then verified on the server against
 * the stored bytes), rename, delete. Runs against S3-compatible storage (S3Mock in CI).
 */

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes: Buffer): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** A real, decodable, solid-colour RGBA PNG, built here so the test needs no fixture file. */
function png(width: number, height: number): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  const row = Buffer.alloc(1 + width * 4); // filter byte 0, then pixels
  for (let x = 0; x < width; x++) row.set([0x2b, 0x3f, 0xe6, 0xff], 1 + x * 4);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const fileInput = (page: Page) => page.locator('input[type="file"]');

/** A server action finished: the write is in the database, so a reload will see it. */
const actionSettled = (page: Page) =>
  page.waitForResponse((r) => r.request().method() === 'POST' && r.request().headers()['next-action'] !== undefined);

test.describe('assets library (screen 8)', () => {
  test('upload, preview, rename, reload, delete', async ({ page }) => {
    await signIn(page);
    await open(page, '/studio/assets');
    await expect(page.getByRole('heading', { level: 1, name: 'Assets' })).toBeVisible();
    await expect(page.getByRole('radio', { name: 'Overlays & frames' })).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByText('No overlays or frames yet')).toBeVisible();

    await fileInput(page).setInputFiles({ name: 'Gold frame.png', mimeType: 'image/png', buffer: png(64, 64) });
    await expect(page.getByRole('button', { name: 'Rename Gold frame' })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('No overlays or frames yet')).toBeHidden();
    // Measured in the browser, stored with the asset, and the card says what kind it is.
    await expect(page.getByText(/Overlay · .+ · 64 × 64/)).toBeVisible();
    // The preview is the stored object itself, fetched back from storage.
    const preview = page.locator('main ul img');
    await expect(preview).toHaveJSProperty('naturalWidth', 64);
    const src = await preview.getAttribute('src');

    // Inline rename: click the name, type, Enter.
    await page.getByRole('button', { name: 'Rename Gold frame' }).click();
    const field = page.getByRole('textbox', { name: 'Asset name' });
    await field.fill('Summer frame');
    const saved = actionSettled(page);
    await field.press('Enter');
    await expect(page.getByRole('button', { name: 'Rename Summer frame' })).toBeVisible();
    await saved;

    // Escape abandons an edit.
    await page.getByRole('button', { name: 'Rename Summer frame' }).click();
    await page.getByRole('textbox', { name: 'Asset name' }).fill('Discarded');
    await page.getByRole('textbox', { name: 'Asset name' }).press('Escape');
    await expect(page.getByRole('button', { name: 'Rename Summer frame' })).toBeVisible();

    await page.reload();
    await page.locator('html[data-hydrated="1"]').waitFor({ state: 'attached' });
    await expect(page.getByRole('button', { name: 'Rename Summer frame' })).toBeVisible();

    // Deleting asks first, then removes the card and the stored file.
    await page.getByRole('button', { name: 'Delete Summer frame' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'Delete Summer frame?' })).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('button', { name: 'Rename Summer frame' })).toBeVisible();

    await page.getByRole('button', { name: 'Delete Summer frame' }).click();
    const deleted = actionSettled(page);
    await dialog.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(page.getByText('No overlays or frames yet')).toBeVisible();
    await deleted;
    expect((await page.request.get(src!)).status()).toBe(404);

    await page.reload();
    await expect(page.getByText('No overlays or frames yet')).toBeVisible();
  });

  test('files land in the section they were uploaded to', async ({ page }) => {
    await signIn(page);
    await open(page, '/studio/assets');
    await page.getByRole('radio', { name: 'Logos' }).click();
    await expect(page.getByText('No logos yet')).toBeVisible();
    await fileInput(page).setInputFiles({ name: 'Brand mark.png', mimeType: 'image/png', buffer: png(32, 16) });
    await expect(page.getByRole('button', { name: 'Rename Brand mark' })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/· 32 × 16/)).toBeVisible();

    await page.getByRole('radio', { name: 'Overlays & frames' }).click();
    await expect(page.getByRole('button', { name: 'Rename Brand mark' })).toBeHidden();
    await expect(page.getByText('No overlays or frames yet')).toBeVisible();

    // Two kinds share the Overlays tab: choose which one the upload is.
    await page.getByRole('radio', { name: 'Frame', exact: true }).click();
    await fileInput(page).setInputFiles({ name: 'Strip frame.png', mimeType: 'image/png', buffer: png(48, 48) });
    await expect(page.getByText(/Frame · .+ · 48 × 48/)).toBeVisible({ timeout: 20_000 });
  });

  test('refuses a file that is not what its name says, before uploading it', async ({ page }) => {
    await signIn(page);
    await open(page, '/studio/assets');
    // SVG is never accepted (it is script when served), whatever the extension or declared type.
    await fileInput(page).setInputFiles({
      name: 'logo.png',
      mimeType: 'image/png',
      buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"></svg>'),
    });
    await expect(page.getByRole('alert').filter({ hasText: 'accepted here' })).toBeVisible();
    await page.getByRole('button', { name: 'Dismiss logo.png' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'accepted here' })).toBeHidden();

    // A real PNG, but not a kind of file an audio library takes.
    await page.getByRole('radio', { name: 'Music' }).click();
    await fileInput(page).setInputFiles({ name: 'song.mp3', mimeType: 'audio/mpeg', buffer: png(8, 8) });
    await expect(page.getByRole('alert').filter({ hasText: 'accepted here' })).toBeVisible();

    // Neither was added to the library.
    await expect(page.getByText('No music yet')).toBeVisible();
  });

  test('has no axe violations, empty or with an asset', async ({ page }) => {
    await signIn(page);
    await open(page, '/studio/assets');
    const scan = () => new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
    expect(
      (await scan()).violations.map((v) => `${v.id}: ${v.nodes.map((node) => node.target.join(' ')).join(' | ')}`),
    ).toEqual([]);

    await fileInput(page).setInputFiles({ name: 'Gold frame.png', mimeType: 'image/png', buffer: png(64, 64) });
    await expect(page.getByRole('button', { name: 'Rename Gold frame' })).toBeVisible({ timeout: 20_000 });
    expect(
      (await scan()).violations.map((v) => `${v.id}: ${v.nodes.map((node) => node.target.join(' ')).join(' | ')}`),
    ).toEqual([]);

    await page.getByRole('button', { name: 'Delete Gold frame' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    // The colours axe reads must be the ones the operator ends up seeing, not a panel mid-fade.
    await settled(page.getByRole('dialog'));
    expect(
      (await scan()).violations.map((v) => `${v.id}: ${v.nodes.map((node) => node.target.join(' ')).join(' | ')}`),
    ).toEqual([]);
  });

  test('the hourly sweep reports what it removed from the library', async ({ request }) => {
    test.skip(!process.env.CRON_SECRET, 'needs the CRON_SECRET the server was started with');
    const res = await request.get('/api/cron/expire', {
      headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
    });
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { assets: { pending: number; deleted: number } };
    expect(body.assets).toEqual({ pending: expect.any(Number), deleted: expect.any(Number) });
    expect((await request.get('/api/cron/expire')).status()).toBe(401);
  });
});
