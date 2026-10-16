import { describe, expect, it } from 'vitest';
import {
  brandingSchema,
  createEventSchema,
  defaultBranding,
  defaultOutputSettings,
  defaultShareSettings,
  video360Schema,
} from '../src/event';
import { canvasSizeFor, mmToPx, templateElementSchema } from '../src/template';

describe('event defaults match the PRD', () => {
  const out = defaultOutputSettings();

  it('360: 8 s spin, 9:16, Balanced, mic off (CAP-5, VID-10, VID-8, CAP-15)', () => {
    expect(out.video360.spinSeconds).toBe(8);
    expect(out.video360.aspect).toBe('9:16');
    expect(out.video360.quality).toBe('balanced');
    expect(out.video360.microphone).toBe(false);
  });

  it('share: QR on, 30-day expiry handled at event level, guest form off (SHR-1, SHR-6)', () => {
    const share = defaultShareSettings();
    expect(share.qr).toBe(true);
    expect(share.guestForm.enabled).toBe(false);
  });

  it('branding defaults to the Cobalt theme', () => {
    expect(defaultBranding().theme.accent).toBe('#2b3fe6');
  });
});

describe('360 settings validation', () => {
  it('accepts spin lengths 3–20 s on a 0.5 s grid (CAP-5)', () => {
    for (const s of [3, 3.5, 8, 19.5, 20]) {
      const r = video360Schema.safeParse({
        spinSeconds: s,
        slowMotion: { enabled: false, startS: 0, endS: 1, speed: 1 },
      });
      expect(r.success, String(s)).toBe(true);
    }
    for (const s of [2.5, 20.5, 8.25]) {
      expect(video360Schema.safeParse({ spinSeconds: s }).success, String(s)).toBe(false);
    }
  });

  it('bounds slow-motion speed to 0.125×–1× (VID-1)', () => {
    expect(video360Schema.safeParse({ slowMotion: { enabled: true, startS: 1, endS: 2, speed: 0.125 } }).success).toBe(
      true,
    );
    expect(video360Schema.safeParse({ slowMotion: { enabled: true, startS: 1, endS: 2, speed: 0.1 } }).success).toBe(
      false,
    );
  });

  it('rejects a slow-motion segment that ends after the spin or before it starts', () => {
    expect(
      video360Schema.safeParse({ spinSeconds: 5, slowMotion: { enabled: true, startS: 2, endS: 6, speed: 0.5 } })
        .success,
    ).toBe(false);
    expect(video360Schema.safeParse({ slowMotion: { enabled: true, startS: 4, endS: 3, speed: 0.5 } }).success).toBe(
      false,
    );
  });
});

describe('create event (EVT-1)', () => {
  it('only allows 7, 30 or 90 day expiry (SHR-8)', () => {
    const base = { name: 'Gala', date: '2026-10-16', mode: 'video360' as const };
    expect(createEventSchema.parse(base).expiryDays).toBe(30);
    expect(createEventSchema.safeParse({ ...base, expiryDays: 14 }).success).toBe(false);
  });

  it('trims names and rejects blanks', () => {
    expect(createEventSchema.safeParse({ name: '   ', date: '2026-10-16', mode: 'photo' }).success).toBe(false);
    expect(createEventSchema.parse({ name: '  Gala ', date: '2026-10-16', mode: 'photo' }).name).toBe('Gala');
  });
});

describe('branding', () => {
  it('rejects non-hex theme colours', () => {
    expect(
      brandingSchema.safeParse({ theme: { accent: 'blue', background: '#ffffff', ink: '#000000', font: 'sans' } })
        .success,
    ).toBe(false);
  });
});

describe('templates', () => {
  it('print canvases are exact at 300 DPI (PHO-3)', () => {
    expect(canvasSizeFor('2x6')).toEqual({ width: 600, height: 1800 });
    expect(canvasSizeFor('4x6')).toEqual({ width: 1200, height: 1800 });
    expect(canvasSizeFor('5x7')).toEqual({ width: 1500, height: 2100 });
    expect(canvasSizeFor('story')).toEqual({ width: 1080, height: 1920 });
  });

  it('an 18 mm strip QR is at least 212 px (DL-3)', () => {
    expect(mmToPx(18)).toBeCloseTo(212.6, 1);
  });

  it('parses each element type and rejects unknown ones', () => {
    const common = { id: 'a', x: 0, y: 0, width: 10, height: 10 };
    expect(templateElementSchema.parse({ ...common, type: 'photo', shot: 0 }).type).toBe('photo');
    expect(
      templateElementSchema.parse({
        ...common,
        type: 'text',
        text: '{eventName}',
        fontFamily: 'Satoshi',
        fontSize: 40,
        color: '#111110',
      }).type,
    ).toBe('text');
    expect(templateElementSchema.safeParse({ ...common, type: 'video' }).success).toBe(false);
    expect(templateElementSchema.safeParse({ ...common, type: 'photo', shot: 4 }).success).toBe(false);
  });
});
