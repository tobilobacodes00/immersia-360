import { describe, expect, it } from 'vitest';
import {
  THEME_PRESETS,
  contrastRatio,
  evaluate,
  mmToPx,
  templateDocumentSchema,
  type TemplateElement,
} from '@immersia/shared';
import {
  SIGNAGE_FORMATS,
  SIGNAGE_MIN_QR_MM,
  SIGNAGE_SAFE_MM,
  SIGNAGE_SHEET_MM,
  literalText,
  signageSizePx,
  signageTemplate,
  type SignageFormat,
  type SignageOptions,
} from '../src/signage';

const theme = { accent: '#2b3fe6', background: '#f7f6f2', ink: '#111110', font: 'sans' as const };
const full: SignageOptions = {
  theme,
  eventName: 'Sarah & Tom’s Wedding',
  hashtag: '#SarahAndTom2026',
  headline: 'Get your photos & videos',
  cta: 'Scan with your phone camera',
  logoAssetId: '0198f6b0-0000-7000-8000-000000000001',
  logoAspect: 2.5,
};
const bare: SignageOptions = { ...full, hashtag: '', logoAssetId: null, logoAspect: null };
const variants: [string, SignageOptions][] = [
  ['with logo and hashtag', full],
  ['without logo or hashtag', bare],
  ['with only the name and the QR', { ...bare, headline: '', cta: '  ' }],
  [
    'serif theme, long texts',
    {
      ...full,
      theme: { ...theme, font: 'serif' },
      eventName: 'The Annual Gala Dinner and Charity Auction in Support of the Children’s Hospital',
      headline: 'Get all of your photos, videos and GIFs from tonight, straight to your phone',
      cta: 'Scan the code with your phone camera to open the gallery',
      logoAspect: null,
    },
  ],
];

const fold = (el: TemplateElement) => el.id.startsWith('fold-');
const overlap = (a: TemplateElement, b: TemplateElement) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
const SAFE = mmToPx(SIGNAGE_SAFE_MM);

describe('event QR signage (DL-5)', () => {
  it('offers an A4 poster, an A5 flyer and a table tent', () => {
    expect([...SIGNAGE_FORMATS]).toEqual(['a4', 'a5', 'tent']);
  });

  for (const format of SIGNAGE_FORMATS)
    describe(format, () => {
      for (const [label, options] of variants)
        describe(label, () => {
          const t = signageTemplate(format, options);

          it('is a valid template document at 300 DPI', () => {
            const parsed = templateDocumentSchema.safeParse(t);
            expect(parsed.error?.issues).toBeUndefined();
            expect(t.canvas.dpi).toBe(300);
            expect(t.canvas.printSize).toBeNull();
            expect(t.canvas.background).toBe(theme.background);
          });

          it('is the exact paper size', () => {
            const mm = SIGNAGE_SHEET_MM[format];
            expect(Math.abs(t.canvas.width - mmToPx(mm.width))).toBeLessThanOrEqual(1);
            expect(Math.abs(t.canvas.height - mmToPx(mm.height))).toBeLessThanOrEqual(1);
            expect(signageSizePx(format)).toEqual({ width: t.canvas.width, height: t.canvas.height });
          });

          it('has a QR big enough to scan, without a short code', () => {
            const qrs = t.elements.filter((e) => e.type === 'qr');
            expect(qrs).toHaveLength(format === 'tent' ? 2 : 1);
            for (const qr of qrs) {
              if (qr.type !== 'qr') continue;
              expect(qr.showCode).toBe(false);
              expect(qr.width).toBe(qr.height);
              expect(qr.width).toBeGreaterThanOrEqual(mmToPx(SIGNAGE_MIN_QR_MM[format]) - 0.5);
              expect(qr.light.toLowerCase()).toBe('#ffffff');
              // Always dark modules on the light card.
              expect(contrastRatio(qr.dark, qr.light)).toBeGreaterThanOrEqual(7);
            }
          });

          it('keeps everything inside the safe area', () => {
            const { width: W, height: H } = t.canvas;
            const half = H / 2;
            for (const el of t.elements) {
              const inX = el.x >= SAFE - 1 && el.x + el.width <= W - SAFE + 1;
              expect(inX, `${el.id} horizontally`).toBe(true);
              if (fold(el)) {
                expect(el.y + el.height / 2).toBe(half);
              } else if (format === 'tent') {
                // Each panel has the margin from the fold too.
                const below = el.y >= half + SAFE - 1 && el.y + el.height <= H - SAFE + 1;
                const above = el.y >= SAFE - 1 && el.y + el.height <= half - SAFE + 1;
                expect(below || above, `${el.id} vertically`).toBe(true);
              } else {
                expect(el.y >= SAFE - 1 && el.y + el.height <= H - SAFE + 1, `${el.id} vertically`).toBe(true);
              }
            }
          });

          it('has no overlapping blocks', () => {
            // The QR sits on its card and the CTA text on its pill; everything else keeps clear.
            const blocks = t.elements.filter((e) => !fold(e) && e.type !== 'qr' && !e.id.endsWith('cta'));
            for (let i = 0; i < blocks.length; i++)
              for (let j = i + 1; j < blocks.length; j++)
                expect(overlap(blocks[i]!, blocks[j]!), `${blocks[i]!.id} over ${blocks[j]!.id}`).toBe(false);
          });

          it('carries the event name, headline, call to action and hashtag as plain text', () => {
            const said = t.elements
              .filter((e) => e.type === 'text')
              .map((e) => evaluate(e.type === 'text' ? e.text : '', {}));
            const copies = format === 'tent' ? 2 : 1;
            const count = (s: string) => said.filter((x) => x === s).length;
            expect(count(options.eventName)).toBe(copies);
            expect(count(options.headline)).toBe(options.headline ? copies : 0);
            expect(count(options.cta)).toBe(options.cta.trim() ? copies : 0);
            expect(count(options.hashtag ?? '')).toBe(options.hashtag ? copies : 0);
            const logos = t.elements.filter((e) => e.type === 'image');
            expect(logos).toHaveLength(options.logoAssetId ? copies : 0);
            for (const l of logos) expect(l.type === 'image' && l.assetId).toBe(options.logoAssetId);
          });
        });
    });

  it('prints the poster and flyer upright with the QR in the lower half', () => {
    for (const format of ['a4', 'a5'] as SignageFormat[]) {
      const t = signageTemplate(format, full);
      expect(t.elements.every((e) => e.rotation === 0)).toBe(true);
      const qr = t.elements.find((e) => e.type === 'qr')!;
      expect(qr.x + qr.width / 2).toBeCloseTo(t.canvas.width / 2, -1);
      expect(qr.y + qr.height / 2).toBeGreaterThan(t.canvas.height / 2);
    }
  });

  describe('table tent', () => {
    const t = signageTemplate('tent', full);
    const { width: W, height: H } = t.canvas;
    const bottom = t.elements.filter((e) => e.id.startsWith('bottom-'));
    const top = t.elements.filter((e) => e.id.startsWith('top-'));

    it('is an A4 sheet in portrait: two A5 landscape panels', () => {
      expect([W, H]).toEqual([2480, 3508]);
      expect(H / 2 / W).toBeCloseTo(148.5 / 210, 2);
    });

    it('has two identical panels, the upper one turned 180° about the centre of the sheet', () => {
      expect(top.length).toBeGreaterThan(0);
      expect(top).toHaveLength(bottom.length);
      for (const b of bottom) {
        const m = top.find((e) => e.id === b.id.replace('bottom-', 'top-'));
        expect(m, b.id).toBeDefined();
        // Same element, turned: its box lands opposite and it rotates 180° about its own centre.
        expect({ ...m!, id: '', x: 0, y: 0, rotation: 0 }).toEqual({ ...b, id: '', x: 0, y: 0, rotation: 0 });
        expect(b.rotation).toBe(0);
        expect(m!.rotation).toBe(180);
        expect(m!.x + m!.width + b.x).toBe(W);
        expect(m!.y + m!.height + b.y).toBe(H);
        expect(b.y).toBeGreaterThanOrEqual(H / 2);
        expect(m!.y + m!.height).toBeLessThanOrEqual(H / 2);
      }
    });

    it('draws a fold guide across the middle, below the panels in the layer order', () => {
      const dashes = t.elements.filter(fold);
      expect(dashes.length).toBeGreaterThan(10);
      const first = t.elements.findIndex((e) => !fold(e));
      expect(t.elements.slice(0, first).every(fold)).toBe(true);
      // Evenly spaced and centred on the sheet.
      const left = dashes[0]!.x;
      const right = W - (dashes.at(-1)!.x + dashes.at(-1)!.width);
      expect(Math.abs(left - right)).toBeLessThanOrEqual(1);
    });

    it('puts the QR on opposite sides so each panel is balanced from its own side of the table', () => {
      const qrs = t.elements.filter((e) => e.type === 'qr');
      const [a, b] = [qrs.find((e) => e.id.startsWith('bottom-'))!, qrs.find((e) => e.id.startsWith('top-'))!];
      expect(a.x).toBeGreaterThan(W / 2);
      expect(b.x + b.width).toBeLessThan(W / 2);
    });
  });

  describe('colours', () => {
    for (const { name, theme: preset } of THEME_PRESETS)
      it(`keeps text readable on ${name}`, () => {
        const t = signageTemplate('a4', { ...full, theme: preset });
        for (const el of t.elements) {
          if (el.type !== 'text') continue;
          const ground = el.id === 'cta' ? preset.accent : preset.background;
          expect(contrastRatio(el.color, ground), el.id).toBeGreaterThanOrEqual(4.5);
        }
      });

    it('falls back to safe colours for a malformed theme', () => {
      const t = signageTemplate('a5', { ...full, theme: { accent: 'blue', background: '', ink: 'x', font: 'sans' } });
      expect(templateDocumentSchema.safeParse(t).success).toBe(true);
    });
  });

  describe('literalText', () => {
    it('survives the token language unchanged', () => {
      for (const s of [
        'Plain',
        'Tom & Jerry’s',
        '{eventName} stays literal',
        '50% off, %d %B %Y',
        'back\\slash \\{ \\}',
        'follow @alice and @bob_1 — @a@b@',
        '{upper,loud}, x',
        '#Hashtag',
      ])
        expect(evaluate(literalText(s), { eventName: 'WRONG', alice: 'WRONG', a: 'WRONG' }), s).toBe(s);
    });
  });
});
