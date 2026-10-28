import { describe, expect, it } from 'vitest';
import { mmToPx, type TemplateElement } from '@immersia/shared';
import { encodeGif, pingPong } from '../src/gif';
import { presetTemplate } from '../src/presets';
import { renderTemplate, renderToBlob, type Template } from '../src/render';

/** A solid-colour "photo". */
function photo(color: string, w = 640, h = 480): ImageBitmap {
  const c = new OffscreenCanvas(w, h);
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, w, h);
  return c.transferToImageBitmap();
}

function render(
  t: Template,
  photos: (ImageBitmap | null)[],
  extra: Partial<Parameters<typeof renderTemplate>[2]> = {},
) {
  const c = new OffscreenCanvas(t.canvas.width, t.canvas.height);
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  renderTemplate(ctx, t, { photos, tokens: { eventName: 'Golden Hour Gala', eventDate: '2026-10-11' }, ...extra });
  const px = (x: number, y: number) =>
    Array.from(ctx.getImageData(Math.round(x), Math.round(y), 1, 1).data.slice(0, 3));
  return { ctx, px };
}

const COLORS = ['#ff0000', '#00ff00', '#0000ff', '#ffff00'];
const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

describe('template renderer (PHO-3, acceptance #3)', () => {
  it('puts each shot in its own slot', () => {
    const t = presetTemplate('4x6', { shots: 4, background: '#f7f6f2', ink: '#111110', font: 'sans' });
    const { px } = render(
      t,
      COLORS.map((c) => photo(c)),
    );
    for (const el of t.elements)
      if (el.type === 'photo')
        expect(px(el.x + el.width / 2, el.y + el.height / 2), el.id).toEqual(rgb(COLORS[el.shot]!));
  });

  it('places elements to the pixel at 300 DPI (1 mm = 11.8 px)', () => {
    const at = Math.round(mmToPx(10)); // 10 mm from the left edge
    const t: Template = {
      canvas: { width: 1200, height: 1800, dpi: 300, printSize: '4x6', background: '#ffffff', backgroundAssetId: null },
      elements: [
        {
          id: 'bar',
          type: 'shape',
          shape: 'rect',
          x: at,
          y: 0,
          width: 1,
          height: 1800,
          fill: '#000000',
          stroke: null,
          strokeWidth: 0,
          cornerRadius: 0,
          rotation: 0,
          opacity: 1,
          locked: false,
          hidden: false,
        },
      ],
    };
    const { px } = render(t, []);
    expect(px(at, 900)).toEqual([0, 0, 0]);
    expect(px(at - 1, 900)).toEqual([255, 255, 255]);
    expect(px(at + 1, 900)).toEqual([255, 255, 255]);
  });

  it('shrinks a long event name to fit its box instead of overflowing', () => {
    const box = { x: 100, y: 100, width: 400, height: 120 };
    const text: TemplateElement = {
      id: 't',
      type: 'text',
      ...box,
      text: '{eventName}',
      fontFamily: 'Satoshi',
      fontWeight: 700,
      fontStyle: 'normal',
      fontSize: 110,
      lineHeight: 1.1,
      letterSpacing: 0,
      color: '#000000',
      align: 'center',
      verticalAlign: 'middle',
      uppercase: false,
      autoFit: true,
      rotation: 0,
      opacity: 1,
      locked: false,
      hidden: false,
    };
    const t: Template = {
      canvas: { width: 600, height: 400, dpi: 300, printSize: null, background: '#ffffff', backgroundAssetId: null },
      elements: [text],
    };
    const { ctx } = render(t, [], {
      tokens: { eventName: 'The Very Long Annual Founders and Friends Celebration Dinner' },
    });
    const data = ctx.getImageData(0, 0, 600, 400).data;
    let inside = 0;
    let outside = 0;
    for (let y = 0; y < 400; y++)
      for (let x = 0; x < 600; x++) {
        if (data[(y * 600 + x) * 4]! > 128) continue;
        const inBox = x >= box.x - 2 && x < box.x + box.width + 2 && y >= box.y - 2 && y < box.y + box.height + 2;
        if (inBox) inside++;
        else outside++;
      }
    expect(inside).toBeGreaterThan(200); // the text was drawn…
    expect(outside).toBe(0); // …and stayed in its box
  });

  it('draws a QR for the session link with its short code (DL-3)', () => {
    const t = presetTemplate('2x6', { shots: 3, background: '#ffffff', ink: '#000000', font: 'sans' });
    const qr = t.elements.find((e) => e.type === 'qr')!;
    const { ctx } = render(t, [null, null, null], {
      qr: { url: 'https://example.com/s/AAAAAAAAAAAAAAAAAAAAAQ', code: 'K7M2QX' },
    });
    const side = Math.min(qr.width, qr.height * 0.84);
    const d = ctx.getImageData(qr.x + (qr.width - side) / 2, qr.y, side, side).data;
    let dark = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i]! < 128) dark++;
    const share = dark / (d.length / 4);
    expect(share).toBeGreaterThan(0.3); // a real module pattern, not an empty box
    expect(share).toBeLessThan(0.7);
  });

  it('encodes to JPEG at print size', async () => {
    const t = presetTemplate('2x6', { shots: 4, background: '#f7f6f2', ink: '#111110', font: 'serif' });
    const blob = await renderToBlob(t, { photos: COLORS.map((c) => photo(c)), tokens: { eventName: 'Gala' } });
    expect(blob.type).toBe('image/jpeg');
    const bmp = await createImageBitmap(blob);
    expect([bmp.width, bmp.height]).toEqual([600, 1800]);
  });
});

describe('GIF (PHO-2)', () => {
  it('encodes a looping GIF in ping-pong order', async () => {
    const frames = pingPong(COLORS.map((c) => ({ image: photo(c, 64, 48), delayMs: 120 })));
    expect(frames).toHaveLength(6);
    const gif = await encodeGif(frames, 64, 48, { sharedPalette: true });
    const head = new TextDecoder().decode(new Uint8Array(await gif.slice(0, 6).arrayBuffer()));
    expect(head).toBe('GIF89a');
    expect(gif.size).toBeGreaterThan(200);
  });
});
