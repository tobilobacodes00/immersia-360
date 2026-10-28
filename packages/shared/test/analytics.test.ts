import { describe, expect, it } from 'vitest';
import {
  EVENT_SOURCES,
  INGEST_MAX_EVENTS,
  MAX_EVENT_AGE_MS,
  analyticsEventSchema,
  canEmit,
  ingestBatchSchema,
  parseDisplayLayout,
  parseScreenSize,
  resolveOccurredAt,
  type AnalyticsEvent,
  type AnalyticsEventName,
} from '../src/analytics';

const SESSION = '0192f3a0-7c1e-7a55-9a5b-3f6f2d3c9a10';

/** One valid example of every event in the PRD's table (plus the crash and session markers). */
const EXAMPLES: AnalyticsEvent[] = [
  { name: 'event_created', mode: 'video360', from_duplicate: false },
  { name: 'setup_check_completed', render_speed_ms: 5400, camera_fps: 30, browser: 'Chrome' },
  { name: 'take_recorded', mode: 'video360', duration_s: 8.2, fps: 60, resolution: '1080p', trigger: 'tap' },
  { name: 'render_completed', render_ms: 11_200, path: 'local', preset: '1080p-60fps-balanced', effects_count: 2 },
  { name: 'render_failed', error_code: 'encoder_stall', path: 'local', browser: 'Safari' },
  { name: 'qr_shown', seconds_since_take: 1.4 },
  { name: 'share_page_viewed', output_kind: 'session', route: 'print' },
  { name: 'gallery_viewed', route: 'event_qr' },
  { name: 'file_downloaded', output_kind: 'mp4', bytes: 14_000_000 },
  { name: 'print_sent', size: '2x6', copies: 2, double_strip: true },
  { name: 'upload_completed', target: 'hosted', bytes: 14_000_000, retries: 1 },
  { name: 'device_registered', platform: 'macOS', browser: 'Chrome' },
  { name: 'display_paired', layout: 'spotlight', screen_size: '1920x1080' },
  { name: 'item_displayed', seconds_on_screen: 8 },
  { name: 'display_qr_scanned', layout: 'mosaic' },
  { name: 'booth_crashed', error_name: 'TypeError', location: 'a1b2c3d4', kind: 'error' },
  { name: 'booth_session_started', session_id: SESSION, mode: 'photo' },
  { name: 'booth_session_ended', session_id: SESSION, duration_s: 3600, takes: 41 },
  { name: 'guest_form_submitted', scope: 'session' },
  { name: 'guest_form_skipped', scope: 'gallery' },
  { name: 'guest_data_erased', by: 'operator' },
];

describe('analytics event catalogue', () => {
  it('has an example for every event, and an owner for every event', () => {
    const names = EXAMPLES.map((e) => e.name).sort();
    expect(names).toEqual(Object.keys(EVENT_SOURCES).sort());
    for (const name of names) expect(EVENT_SOURCES[name as AnalyticsEventName].length).toBeGreaterThan(0);
  });

  it.each(EXAMPLES.map((e) => [e.name, e] as const))('accepts a valid %s', (_name, event) => {
    expect(analyticsEventSchema.parse(event)).toEqual(event);
  });

  it('rejects an unknown event name', () => {
    expect(analyticsEventSchema.safeParse({ name: 'page_scrolled' }).success).toBe(false);
  });

  it('strips properties the catalogue does not know, so nothing rides along', () => {
    const parsed = analyticsEventSchema.parse({
      name: 'qr_shown',
      seconds_since_take: 2,
      email: 'guest@example.com',
      userAgent: 'Mozilla/5.0',
    });
    expect(parsed).toEqual({ name: 'qr_shown', seconds_since_take: 2 });
  });

  it('bounds numbers and rejects NaN, negatives and absurd values', () => {
    const base = { name: 'render_completed', path: 'local', preset: 'x', effects_count: 0 };
    expect(analyticsEventSchema.safeParse({ ...base, render_ms: -1 }).success).toBe(false);
    expect(analyticsEventSchema.safeParse({ ...base, render_ms: Number.NaN }).success).toBe(false);
    expect(analyticsEventSchema.safeParse({ ...base, render_ms: 10 * 3_600_000 }).success).toBe(false);
    expect(analyticsEventSchema.safeParse({ name: 'qr_shown', seconds_since_take: -3 }).success).toBe(false);
    expect(analyticsEventSchema.safeParse({ name: 'file_downloaded', output_kind: 'mp4', bytes: 1.5 }).success).toBe(
      false,
    );
  });

  it('keeps error codes to machine codes, not sentences', () => {
    const base = { name: 'render_failed', path: 'local', browser: 'Chrome' };
    expect(analyticsEventSchema.safeParse({ ...base, error_code: 'encoder_stall' }).success).toBe(true);
    expect(analyticsEventSchema.safeParse({ ...base, error_code: 'could not read /Users/ana/clip.mov' }).success).toBe(
      false,
    );
  });

  it('accepts only the PRD routes, with direct for the rest', () => {
    expect(analyticsEventSchema.safeParse({ name: 'gallery_viewed', route: 'nfc' }).success).toBe(true);
    expect(analyticsEventSchema.safeParse({ name: 'gallery_viewed', route: 'direct' }).success).toBe(true);
    expect(analyticsEventSchema.safeParse({ name: 'gallery_viewed', route: 'twitter' }).success).toBe(false);
  });

  it('takes a crash report as an error name and a location hash and nothing more', () => {
    const crash = { name: 'booth_crashed', kind: 'unhandledrejection' };
    expect(analyticsEventSchema.safeParse({ ...crash, error_name: 'RangeError', location: 'deadbeef' }).success).toBe(
      true,
    );
    // a message in place of a name, or a URL in place of a hash, is refused
    expect(
      analyticsEventSchema.safeParse({ ...crash, error_name: 'Cannot read properties of null', location: 'deadbeef' })
        .success,
    ).toBe(false);
    expect(
      analyticsEventSchema.safeParse({ ...crash, error_name: 'TypeError', location: 'https://x.test/a.js' }).success,
    ).toBe(false);
  });
});

describe('privacy events (SHR-6)', () => {
  it('are recorded by the server only: a booth, a display or the studio cannot report them', () => {
    for (const name of ['guest_form_submitted', 'guest_form_skipped', 'guest_data_erased'] as const) {
      expect(EVENT_SOURCES[name], name).toEqual(['server']);
      for (const source of ['device', 'display', 'studio'] as const)
        expect(canEmit(source, name), `${source} ${name}`).toBe(false);
    }
  });

  it('carry counts and a scope, never a guest detail', () => {
    expect(
      analyticsEventSchema.parse({
        name: 'guest_form_submitted',
        scope: 'gallery',
        email: 'guest@example.com',
        guestName: 'Ana',
      }),
    ).toEqual({ name: 'guest_form_submitted', scope: 'gallery' });
    expect(analyticsEventSchema.parse({ name: 'guest_data_erased', by: 'guest', sessionId: SESSION })).toEqual({
      name: 'guest_data_erased',
      by: 'guest',
    });
    expect(analyticsEventSchema.safeParse({ name: 'guest_form_skipped', scope: 'event' }).success).toBe(false);
    expect(analyticsEventSchema.safeParse({ name: 'guest_data_erased', by: 'someone' }).success).toBe(false);
  });
});

describe('who may emit what', () => {
  it('lets a booth report its own work but not page views or downloads', () => {
    expect(canEmit('device', 'take_recorded')).toBe(true);
    expect(canEmit('device', 'booth_crashed')).toBe(true);
    expect(canEmit('device', 'share_page_viewed')).toBe(false);
    expect(canEmit('device', 'file_downloaded')).toBe(false);
    expect(canEmit('device', 'event_created')).toBe(false);
  });

  it('lets a display report what it showed, and the setup check come from a booth or the studio', () => {
    expect(canEmit('display', 'item_displayed')).toBe(true);
    expect(canEmit('display', 'take_recorded')).toBe(false);
    expect(canEmit('device', 'setup_check_completed')).toBe(true);
    expect(canEmit('studio', 'setup_check_completed')).toBe(true);
    expect(canEmit('display', 'setup_check_completed')).toBe(false);
  });

  it('keeps the guest-facing measurements server-side only', () => {
    for (const name of ['share_page_viewed', 'gallery_viewed', 'file_downloaded', 'display_qr_scanned'] as const)
      expect(EVENT_SOURCES[name]).toEqual(['server']);
  });
});

describe('the ingestion envelope', () => {
  const event = { id: SESSION, at: 1_700_000_000_000, event: { name: 'qr_shown', seconds_since_take: 1 } };

  it('accepts a batch of up to the limit and rejects an empty or oversized one', () => {
    expect(ingestBatchSchema.safeParse({ events: [event] }).success).toBe(true);
    expect(ingestBatchSchema.safeParse({ events: [] }).success).toBe(false);
    expect(
      ingestBatchSchema.safeParse({ events: Array.from({ length: INGEST_MAX_EVENTS }, () => event) }).success,
    ).toBe(true);
    expect(
      ingestBatchSchema.safeParse({ events: Array.from({ length: INGEST_MAX_EVENTS + 1 }, () => event) }).success,
    ).toBe(false);
  });

  it('needs a client id on every event (that is what makes a retry idempotent)', () => {
    expect(ingestBatchSchema.safeParse({ events: [{ at: 1, event: {} }] }).success).toBe(false);
    expect(ingestBatchSchema.safeParse({ events: [{ id: 'not-a-uuid', at: 1, event: {} }] }).success).toBe(false);
  });
});

describe('resolveOccurredAt (ingestion bounds)', () => {
  const now = Date.UTC(2026, 9, 19, 12, 0, 0);

  it('keeps an event from a correct clock as it is', () => {
    expect(resolveOccurredAt({ at: now - 5_000, sentAt: now, now })).toEqual({ ms: now - 5_000, clamped: false });
  });

  it('corrects a clock that is minutes slow or fast, using what the device said the time was when it sent', () => {
    const slow = resolveOccurredAt({ at: now - 600_000 - 5_000, sentAt: now - 600_000, now });
    expect(slow.ms).toBe(now - 5_000);
    const fast = resolveOccurredAt({ at: now + 3_600_000 - 5_000, sentAt: now + 3_600_000, now });
    expect(fast.ms).toBe(now - 5_000);
  });

  it('corrects a clock that is years wrong', () => {
    const year2031 = Date.UTC(2031, 0, 1);
    expect(resolveOccurredAt({ at: year2031 - 90_000, sentAt: year2031, now }).ms).toBe(now - 90_000);
  });

  it('restores an event that waited offline for days', () => {
    const wait = 3 * 86_400_000;
    expect(resolveOccurredAt({ at: now - wait, sentAt: now, now }).ms).toBe(now - wait);
  });

  it('never dates an event in the future', () => {
    const r = resolveOccurredAt({ at: now + 86_400_000, sentAt: now, now });
    expect(r).toEqual({ ms: now, clamped: true });
  });

  it('never dates an event further back than the retention bound', () => {
    const r = resolveOccurredAt({ at: now - 400 * 86_400_000, sentAt: now, now });
    expect(r).toEqual({ ms: now - MAX_EVENT_AGE_MS, clamped: true });
  });

  it('only clamps when the device sent no clock reading', () => {
    expect(resolveOccurredAt({ at: now - 1_000, now }).ms).toBe(now - 1_000);
    expect(resolveOccurredAt({ at: now + 5_000, now }).ms).toBe(now);
  });

  it('survives a nonsense timestamp', () => {
    expect(resolveOccurredAt({ at: Number.NaN, sentAt: now, now }).ms).toBe(now);
    expect(resolveOccurredAt({ at: now - 1000, sentAt: Number.NaN, now }).ms).toBe(now - 1000);
  });
});

describe('parseScreenSize', () => {
  it('takes WIDTHxHEIGHT and nothing else', () => {
    expect(parseScreenSize('1920x1080')).toBe('1920x1080');
    expect(parseScreenSize('3840x2160')).toBe('3840x2160');
    expect(parseScreenSize('1920 x 1080')).toBeNull();
    expect(parseScreenSize('<script>')).toBeNull();
    expect(parseScreenSize(1920)).toBeNull();
  });
});

describe('parseDisplayLayout', () => {
  it('knows the four layouts and calls anything else unknown', () => {
    expect(parseDisplayLayout('spotlight')).toBe('spotlight');
    expect(parseDisplayLayout('counter')).toBe('counter');
    expect(parseDisplayLayout('carousel')).toBe('unknown');
    expect(parseDisplayLayout(undefined)).toBe('unknown');
  });
});
