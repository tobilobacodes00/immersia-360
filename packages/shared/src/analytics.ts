/**
 * First-party analytics events (PRD "Tracked events"). One zod schema per event name, in one
 * catalogue: the clients that emit, the ingestion endpoint that receives and the server that stores
 * all validate against it, so a property can't drift between them. Adding an event means adding it
 * here first (and to EVENT_SOURCES, which says who may emit it).
 *
 * Nothing in an event identifies a guest: no IP address, no user agent (a browser family at most),
 * no free text. Strings are short labels or machine codes, and every number is bounded.
 */
import { z } from 'zod';
import { DISPLAY_LAYOUTS } from './live';
import { DOWNLOAD_ROUTES } from './routes';
import { OUTPUT_KINDS } from './session';

export const CAPTURE_TRIGGERS = ['tap', 'timer', 'motion', 'remote', 'keyboard'] as const;
export type CaptureTrigger = (typeof CAPTURE_TRIGGERS)[number];
export const RENDER_PATHS = ['local', 'wasm', 'server'] as const;
export type RenderPath = (typeof RENDER_PATHS)[number];
export const UPLOAD_TARGETS = ['hosted', 'drive', 'dropbox'] as const;
export type UploadTarget = (typeof UPLOAD_TARGETS)[number];

// ---------------------------------------------------------------------------------------------
// Property types

/** A short human label ("Chrome", "1080p"). Trimmed, never empty, bounded. */
const label = (max = 40) => z.string().trim().min(1).max(max);
/** A machine code ("encoder_stall", "u3-9c1f"): no spaces, so free text can't ride along. */
const code = z
  .string()
  .trim()
  .min(1)
  .max(60)
  .regex(/^[A-Za-z0-9_.:\-]+$/);
const seconds = z.number().min(0).max(86_400);
const millis = z.number().min(0).max(3_600_000);
const bytes = z
  .number()
  .int()
  .min(0)
  .max(2 ** 40);
const fps = z.number().min(0).max(960);
const mode = z.enum(['video360', 'photo']);
const route = z.enum([...DOWNLOAD_ROUTES, 'direct']);
const layout = z.enum(DISPLAY_LAYOUTS);
/** A browser family, as the server reads it from a user agent (the user agent itself is never stored). */
export const BROWSER_FAMILIES = ['chrome', 'safari', 'firefox', 'edge', 'samsung', 'other'] as const;
export type BrowserFamily = (typeof BROWSER_FAMILIES)[number];
const browserFamily = z.enum(BROWSER_FAMILIES);

// ---------------------------------------------------------------------------------------------
// The events

export const analyticsEventSchema = z.discriminatedUnion('name', [
  // activation
  z.object({ name: z.literal('event_created'), mode, from_duplicate: z.boolean() }),
  // device readiness
  z.object({ name: z.literal('setup_check_completed'), render_speed_ms: millis, camera_fps: fps, browser: label() }),
  // usage
  z.object({
    name: z.literal('take_recorded'),
    mode,
    duration_s: seconds,
    fps,
    resolution: label(20),
    trigger: z.enum(CAPTURE_TRIGGERS),
  }),
  // capture-to-QR time. `seconds_since_take` is how long after the take ended the files were
  // rendered (queue wait included): the figure behind "how long did a guest wait for their file".
  z.object({
    name: z.literal('render_completed'),
    render_ms: millis,
    path: z.enum(RENDER_PATHS),
    preset: label(60),
    effects_count: z.number().int().min(0).max(32),
    seconds_since_take: seconds.optional(),
    mode: mode.optional(),
  }),
  // crash-free events
  z.object({ name: z.literal('render_failed'), error_code: code, path: z.enum(RENDER_PATHS), browser: label() }),
  z.object({ name: z.literal('qr_shown'), seconds_since_take: seconds, mode: mode.optional() }),
  // download success. `session_id` (the guest session, never a person) lets views and downloads be
  // matched per session; `browser` is a family, not a user agent.
  z.object({
    name: z.literal('share_page_viewed'),
    output_kind: z.enum([...OUTPUT_KINDS, 'session']),
    route,
    session_id: z.uuid().optional(),
    browser: browserFamily.optional(),
  }),
  /** SHR-5, DL-7: the event gallery, by how guests reached it (event QR, display, NFC…). */
  z.object({ name: z.literal('gallery_viewed'), route }),
  z.object({
    name: z.literal('file_downloaded'),
    output_kind: z.enum(OUTPUT_KINDS),
    bytes,
    route: route.optional(),
    session_id: z.uuid().optional(),
    browser: browserFamily.optional(),
  }),
  z.object({
    name: z.literal('print_sent'),
    size: label(20),
    copies: z.number().int().min(1).max(99),
    double_strip: z.boolean(),
  }),
  // reliability
  z.object({
    name: z.literal('upload_completed'),
    target: z.enum(UPLOAD_TARGETS),
    bytes,
    retries: z.number().int().min(0).max(1000),
  }),
  // devices per operator
  z.object({ name: z.literal('device_registered'), platform: label(), browser: label() }),
  // Live Display
  z.object({ name: z.literal('display_paired'), layout, screen_size: z.string().regex(/^(\d{3,5}x\d{3,5}|unknown)$/) }),
  z.object({ name: z.literal('item_displayed'), seconds_on_screen: seconds, layout: layout.optional() }),
  z.object({ name: z.literal('display_qr_scanned'), layout: z.enum([...DISPLAY_LAYOUTS, 'unknown']) }),
  // crash reports and booth session markers (events completed without a crash). A crash report
  // carries the error's class name and a hash of where it happened: never a message or a stack.
  z.object({
    name: z.literal('booth_crashed'),
    error_name: z
      .string()
      .min(1)
      .max(40)
      .regex(/^[A-Za-z0-9_$.]+$/),
    location: z.string().regex(/^[0-9a-f]{8}$/),
    kind: z.enum(['error', 'unhandledrejection']),
    session_id: z.uuid().optional(),
  }),
  z.object({ name: z.literal('booth_session_started'), session_id: z.uuid(), mode, app_version: label().optional() }),
  z.object({
    name: z.literal('booth_session_ended'),
    session_id: z.uuid(),
    duration_s: seconds,
    takes: z.number().int().min(0).max(10_000),
  }),
]);

export type AnalyticsEvent = z.infer<typeof analyticsEventSchema>;
export type AnalyticsEventName = AnalyticsEvent['name'];

// ---------------------------------------------------------------------------------------------
// Who may emit what

/** `server` events are recorded by our own code; the rest arrive over POST /api/t. */
export type AnalyticsSource = 'server' | 'device' | 'display' | 'studio';
export type ClientSource = Exclude<AnalyticsSource, 'server'>;

/**
 * An event is accepted only from a source that has a reason to know it. In particular a booth can
 * not report page views or downloads: those feed the guest download-success metric and come from
 * the server's own view of the request.
 */
export const EVENT_SOURCES = {
  event_created: ['server'],
  setup_check_completed: ['device', 'studio'],
  take_recorded: ['device'],
  render_completed: ['device'],
  render_failed: ['device'],
  qr_shown: ['device'],
  share_page_viewed: ['server'],
  gallery_viewed: ['server'],
  file_downloaded: ['server'],
  print_sent: ['device'],
  upload_completed: ['server', 'device'],
  device_registered: ['server'],
  display_paired: ['server'],
  item_displayed: ['display'],
  display_qr_scanned: ['server'],
  booth_crashed: ['device'],
  booth_session_started: ['device'],
  booth_session_ended: ['device'],
} as const satisfies Record<AnalyticsEventName, readonly AnalyticsSource[]>;

export function canEmit(source: AnalyticsSource, name: AnalyticsEventName): boolean {
  return (EVENT_SOURCES[name] as readonly AnalyticsSource[]).includes(source);
}

type NamesFrom<S extends AnalyticsSource> = {
  [N in AnalyticsEventName]: S extends (typeof EVENT_SOURCES)[N][number] ? N : never;
}[AnalyticsEventName];

/** The events a given source may emit, as types (what `emitEvent('device', …)` accepts). */
export type EventFrom<S extends AnalyticsSource> = Extract<AnalyticsEvent, { name: NamesFrom<S> }>;

// ---------------------------------------------------------------------------------------------
// The client → server envelope (POST /api/t)

export const INGEST_MAX_EVENTS = 50;
export const INGEST_MAX_BYTES = 64 * 1024;

/**
 * One buffered event as the device sends it. `id` makes a retried batch idempotent; `at` is the
 * device clock when it happened, corrected on arrival (see resolveOccurredAt). The event itself is
 * validated per event, so one bad event never costs the rest of the batch.
 */
export const ingestEventSchema = z.object({
  id: z.uuid(),
  at: z.number(),
  eventId: z.uuid().nullish(),
  event: z.unknown(),
});
export type IngestEvent = z.infer<typeof ingestEventSchema>;

export const ingestBatchSchema = z.object({
  /** The device clock when the batch was sent: the server measures the clock's error from it. */
  sentAt: z.number().optional(),
  events: z.array(ingestEventSchema).min(1).max(INGEST_MAX_EVENTS),
});
export type IngestBatch = z.infer<typeof ingestBatchSchema>;

/** Events older than this are clamped to it: partitions and windows are not rewritten by an old buffer. */
export const MAX_EVENT_AGE_MS = 35 * 86_400_000;

/**
 * When an event really happened, in server time. Booth clocks drift (and are sometimes wrong by
 * years), and events can wait offline for days. The device says what its clock read when it sent the
 * batch (`sentAt`), so the server knows the clock's error and applies it to every event in the batch;
 * the result is then held between "35 days ago" and "now". Without `sentAt` the event's own time is
 * only clamped.
 */
export function resolveOccurredAt(input: { at: number; sentAt?: number | undefined; now: number }): {
  ms: number;
  clamped: boolean;
} {
  const { at, sentAt, now } = input;
  const skew = sentAt !== undefined && Number.isFinite(sentAt) ? now - sentAt : 0;
  const corrected = Number.isFinite(at) ? at + skew : now;
  const ms = Math.min(now, Math.max(now - MAX_EVENT_AGE_MS, corrected));
  return { ms: Math.round(ms), clamped: ms !== Math.round(corrected) };
}

/** The layout a Live Display QR was shown in (`?dl=`), or `unknown` when a link carries none. */
export function parseDisplayLayout(value: string | null | undefined): (typeof DISPLAY_LAYOUTS)[number] | 'unknown' {
  return (DISPLAY_LAYOUTS as readonly string[]).includes(value ?? '')
    ? (value as (typeof DISPLAY_LAYOUTS)[number])
    : 'unknown';
}

/** A screen size such as "1920x1080" from `screen.width`/`screen.height`, or null when it is not one. */
export function parseScreenSize(value: unknown): string | null {
  return typeof value === 'string' && /^\d{3,5}x\d{3,5}$/.test(value) ? value : null;
}
