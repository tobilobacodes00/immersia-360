import { randomBytes, randomUUID } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { expect, type Page } from '@playwright/test';
import { open } from './helpers';

/**
 * Guest sessions made the way a booth makes them, through its own API (a device token and a presigned upload to
 * S3-compatible storage), so a spec can have a gallery of captures without a camera or a render.
 */

/** A real 1×1 PNG: the share page shows it as the guest's "photo strip". */
export const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

export interface SessionImage {
  data: Buffer;
  width: number;
  height: number;
}

/** The default image: the 1×1 PNG, declared at a photo strip's size, as the privacy specs always did. */
const DEFAULT_IMAGE: SessionImage = { data: PNG, width: 400, height: 1200 };

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
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

/** A real photo-strip-shaped PNG, `top` colour above and `bottom` below, so each session in a gallery looks different. */
export function stripPng(
  top: [number, number, number],
  bottom: [number, number, number],
  width = 60,
  height = 180,
): SessionImage {
  const rows = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    const at = y * (width * 3 + 1);
    rows[at] = 0; // filter: none
    const [r, g, b] = y < height / 2 ? top : bottom;
    for (let x = 0; x < width; x++) rows.set([r, g, b], at + 1 + x * 3);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 2, 0, 0, 0], 8); // 8-bit RGB, no interlace
  const data = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(rows)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  return { data, width, height };
}

/** Register this browser as a booth device and return its token. */
export async function deviceToken(page: Page, eventId: string): Promise<string> {
  await open(page, `/booth/${eventId}`);
  await page.getByRole('button', { name: 'Register and continue' }).click();
  await page.waitForFunction(() => localStorage.getItem('immersia.device.v1') !== null);
  return page.evaluate(() => (JSON.parse(localStorage.getItem('immersia.device.v1')!) as { token: string }).token);
}

export interface Registered {
  linkId: string;
  sessionId: string;
  outputId: string;
  token: string;
  eventId: string;
}

/** What a booth does: register a session with one photo strip, upload it, confirm it. */
export async function registerSession(
  page: Page,
  token: string,
  eventId: string,
  image: SessionImage = DEFAULT_IMAGE,
): Promise<Registered> {
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
          bytes: image.data.length,
          width: image.width,
          height: image.height,
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
  const put = await page.request.put(ticket.url, { headers: ticket.headers, data: image.data });
  expect(put.ok()).toBe(true);
  const done = await page.request.post(`/api/booth/outputs/${ticket.outputId}/complete`, { headers: auth, data: {} });
  expect(done.ok()).toBe(true);
  return { linkId, sessionId, outputId: ticket.outputId, token, eventId };
}
