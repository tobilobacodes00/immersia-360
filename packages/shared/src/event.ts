/**
 * Event configuration (EVT-1, screen 4 "Event setup", screen 5 "Branding"). One zod schema per JSON
 * column: the operator UI, the API, the booth device and the database all validate against these.
 * Ranges are the PRD's own (CAP-5 spin length, VID-1 slow-motion speed, SHR-8 expiry, …).
 */
import { z } from 'zod';
import { DEFAULT_THEME } from './theme';

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const uuid = z.uuid();
/**
 * Refinement messages are stable codes, not prose: the UI translates them (studio.setup.issues.*).
 */
/** Seconds on a 0.5 s grid (CAP-5). */
const halfSecond = z.number().refine((n) => Number.isInteger(n * 2), 'half_second_grid');

export const RESOLUTIONS = ['720p', '1080p', '2160p'] as const;
export const ASPECTS = ['9:16', '1:1', '16:9'] as const;
export const QUALITY_PRESETS = ['small', 'balanced', 'original'] as const;
export const EXPIRY_DAYS = [7, 30, 90] as const;
export const PRINT_SIZES = ['2x6', '4x4', '4x6', '6x4', '5x7', 'story'] as const;

export const effectSchema = z.object({
  id: z.string().min(1),
  /** Colour mode for effects that have one, e.g. confetti colour/white/silver/gold (VID-7). */
  colorMode: z.string().optional(),
  intensity: z.number().min(0).max(1).default(1),
});

export const musicSchema = z
  .object({
    assetId: uuid,
    trimStartMs: z.number().int().min(0).default(0),
    trimEndMs: z.number().int().min(0).nullable().default(null),
    offsetMs: z.number().int().min(0).default(0),
    fadeInMs: z.number().int().min(0).max(10_000).default(500),
    fadeOutMs: z.number().int().min(0).max(10_000).default(1_000),
    volume: z.number().min(0).max(1).default(0.9),
  })
  .refine((m) => m.trimEndMs === null || m.trimEndMs > m.trimStartMs, 'trim_end_before_start');

export const slowMotionSchema = z
  .object({
    enabled: z.boolean().default(true),
    /** Segment on the take's timeline, in seconds from the start of the spin (VID-1). */
    startS: z.number().min(0).default(2),
    endS: z.number().min(0).default(6),
    /** 0.125× – 1× (VID-1). */
    speed: z.number().min(0.125).max(1).default(0.5),
  })
  .refine((s) => s.endS > s.startS, 'slow_motion_end_before_start');

export const video360Schema = z
  .object({
    resolution: z.enum(RESOLUTIONS).default('1080p'),
    fps: z.union([z.literal(30), z.literal(60)]).default(60),
    aspect: z.enum(ASPECTS).default('9:16'),
    spinSeconds: halfSecond.pipe(z.number().min(3).max(20)).default(8),
    slowMotion: slowMotionSchema.default({ enabled: true, startS: 2, endS: 6, speed: 0.5 }),
    /** VID-3: boomerang plays the segment forward then back; reverse appends it reversed. */
    reverse: z.enum(['none', 'boomerang', 'reverse']).default('none'),
    quality: z.enum(QUALITY_PRESETS).default('balanced'),
    filterId: z.string().nullable().default(null),
    effects: z.array(effectSchema).max(8).default([]),
    beatSync: z.boolean().default(false),
    overlayTemplateId: uuid.nullable().default(null),
    introAssetId: uuid.nullable().default(null),
    outroAssetId: uuid.nullable().default(null),
    /** Still-card length when the intro/outro is an image (VID-5: 1–5 s). */
    cardSeconds: z.number().min(1).max(5).default(2),
    music: musicSchema.nullable().default(null),
    countdownSeconds: z.number().int().min(0).max(10).default(3),
    /** CAP-15: no live sound in 360 mode unless the operator opts in. */
    microphone: z.boolean().default(false),
  })
  .refine((v) => !v.slowMotion.enabled || v.slowMotion.endS <= v.spinSeconds, 'slow_motion_outside_spin');

export const photoSchema = z.object({
  shots: z.number().int().min(1).max(4).default(3),
  countdownSeconds: z.number().int().min(0).max(10).default(3),
  secondsBetweenShots: z.number().min(0).max(10).default(2),
  retake: z.boolean().default(true),
  layoutTemplateId: uuid.nullable().default(null),
  printSize: z.enum(PRINT_SIZES).default('2x6'),
  filterId: z.string().nullable().default(null),
  /** PHO-2: extra outputs per session. */
  outputs: z
    .object({ gif: z.boolean(), boomerang: z.boolean(), shortVideo: z.boolean() })
    .default({ gif: true, boomerang: false, shortVideo: false }),
  /** PHO-7/PHO-8. */
  print: z
    .object({
      enabled: z.boolean(),
      autoPrint: z.boolean(),
      copies: z.number().int().min(1).max(10),
      maxGuestCopies: z.number().int().min(1).max(10),
      doubleStrip: z.boolean(),
    })
    .default({ enabled: false, autoPrint: false, copies: 1, maxGuestCopies: 2, doubleStrip: true }),
  confettiReveal: z.boolean().default(true),
});

export const triggerSchema = z.object({
  tap: z.boolean().default(true),
  keyboard: z.boolean().default(true),
  motion: z
    .object({
      enabled: z.boolean(),
      /** 0–1 share of the frame that must move horizontally (CAP-4). */
      threshold: z.number().min(0.01).max(1),
      cooldownS: z.number().min(0).max(60),
    })
    .default({ enabled: false, threshold: 0.12, cooldownS: 4 }),
});

export const outputSettingsSchema = z.object({
  video360: video360Schema.default(() => video360Schema.parse({})),
  photo: photoSchema.default(() => photoSchema.parse({})),
  triggers: triggerSchema.default(() => triggerSchema.parse({})),
  /** LIV-13: the event also runs the other booth (a 360 and a photo booth feeding one display). */
  secondBooth: z.boolean().default(false),
});

export type BoothMode = 'video360' | 'photo';

/** The booths an event runs: its main one first. */
export function eventBooths(mode: BoothMode, output: { secondBooth: boolean }): BoothMode[] {
  const other: BoothMode = mode === 'photo' ? 'video360' : 'photo';
  return output.secondBooth ? [mode, other] : [mode];
}

export const shareSettingsSchema = z.object({
  qr: z.boolean().default(true),
  email: z.boolean().default(true),
  sms: z.boolean().default(true),
  whatsapp: z.boolean().default(true),
  /** SHR-6: optional guest data capture before download. */
  guestForm: z
    .object({ enabled: z.boolean(), requireName: z.boolean(), consentText: z.string().max(500) })
    .default({ enabled: false, requireName: false, consentText: '' }),
  /** DL-3: corner QR on printed strips. */
  stripQr: z.boolean().default(true),
  /** DL-4: 2 s QR end card on videos. */
  endFrameQr: z.boolean().default(false),
  /** SHR-7: where files go. Hosted share pages are always created; cloud copies are extra. */
  cloud: z.enum(['none', 'drive', 'dropbox']).default('none'),
  smallerVersion: z.boolean().default(true),
  /** DL-12: how guests reach the operator, shown once the event's files have expired. */
  contact: z.string().trim().max(200).default(''),
});

export const attractSchema = z.object({
  headline: z.string().max(120).default('Strike a pose'),
  subline: z.string().max(200).default('{eventName}'),
  cta: z.string().max(60).default('Tap to start'),
  thanks: z.string().max(120).default('You looked amazing'),
  backgroundAssetId: uuid.nullable().default(null),
});

export const brandingSchema = z.object({
  theme: z
    .object({ accent: hex, background: hex, ink: hex, font: z.enum(['sans', 'serif']) })
    .default(() => ({ ...DEFAULT_THEME })),
  logoAssetId: uuid.nullable().default(null),
  attract: attractSchema.default(() => attractSchema.parse({})),
  hashtag: z.string().max(60).default(''),
  custom1: z.string().max(200).default(''),
  custom2: z.string().max(200).default(''),
  custom3: z.string().max(200).default(''),
  /** Shown on the "this event has ended" page (DL-12). */
  operatorContact: z.string().max(200).default(''),
});

export type OutputSettings = z.infer<typeof outputSettingsSchema>;
export type ShareSettings = z.infer<typeof shareSettingsSchema>;
export type BrandingSettings = z.infer<typeof brandingSchema>;
export type Video360Settings = z.infer<typeof video360Schema>;
export type PhotoSettings = z.infer<typeof photoSchema>;

export const defaultOutputSettings = (): OutputSettings => outputSettingsSchema.parse({});
export const defaultShareSettings = (): ShareSettings => shareSettingsSchema.parse({});
export const defaultBranding = (): BrandingSettings => brandingSchema.parse({});

/** EVT-1 create form. */
export const createEventSchema = z.object({
  name: z.string().trim().min(1).max(120),
  date: z.iso.date(),
  mode: z.enum(['video360', 'photo']),
  expiryDays: z.union([z.literal(7), z.literal(30), z.literal(90)]).default(30),
});
export type CreateEventInput = z.infer<typeof createEventSchema>;

/** What a booth device reports about itself (drives the render path, PRD "Device"). */
export const deviceCapabilitiesSchema = z.object({
  webcodecs: z.object({ h264Encode: z.boolean(), aacEncode: z.boolean(), hevcDecode: z.boolean() }),
  webgl2: z.boolean(),
  webgpu: z.boolean(),
  opfs: z.boolean(),
  maxCameraResolution: z.string().nullable(),
  maxCameraFps: z.number().nullable(),
  renderPath: z.enum(['local', 'wasm', 'server']),
  renderSpeedMs: z.number().nullable(),
  checkedAt: z.iso.datetime().nullable(),
});
export type DeviceCapabilities = z.infer<typeof deviceCapabilitiesSchema>;

export const displaySettingsSchema = z.object({
  dwellSeconds: z.number().min(3).max(15).default(8),
  videosMuted: z.boolean().default(true),
  backgroundMusicAssetId: uuid.nullable().default(null),
  qrSize: z.enum(['s', 'm', 'l']).default('m'),
  qrPosition: z.enum(['top-left', 'top-right', 'bottom-left', 'bottom-right']).default('bottom-right'),
  verticalFill: z.enum(['blur', 'columns']).default('blur'),
});
export type DisplaySettings = z.infer<typeof displaySettingsSchema>;
