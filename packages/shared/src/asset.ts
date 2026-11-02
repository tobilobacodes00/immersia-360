/**
 * Asset library (screen 8): what an operator may upload, and how we know a file is what it says.
 *
 * The rules live here, not in the UI or the server, because three places need the same answer: the
 * browser (fail fast, before a 200 MB upload), the server action (the real check) and the editor's
 * asset picker (which types a slot accepts). There is no SVG anywhere: an uploaded SVG is script
 * when served from the bucket.
 */
import { z } from 'zod';

export const ASSET_TYPES = ['overlay', 'layout', 'intro', 'outro', 'audio', 'font', 'logo', 'background'] as const;
export type AssetType = (typeof ASSET_TYPES)[number];

/** Per-file limits are decimal megabytes so the "25 MB" the UI shows is the limit that applies. */
const MB = 1_000_000;

/** One organization may hold this much in its library (pending and ready uploads both count). */
export const ASSET_QUOTA_BYTES = 5 * 1024 ** 3;

/** Bytes read from the start of a file to identify it. */
export const SNIFF_BYTES = 32;

const IMAGES = ['image/png', 'image/jpeg', 'image/webp'] as const;
const VIDEOS = ['video/mp4', 'video/quicktime', 'video/webm'] as const;

export interface AssetRule {
  mimes: readonly string[];
  /** Limit for every accepted type, except video where `maxVideoBytes` is set. */
  maxBytes: number;
  maxVideoBytes?: number;
  /** Longest accepted video or audio. Enforced from the duration the browser measured. */
  maxDurationMs?: number;
}

export const ASSET_RULES: Record<AssetType, AssetRule> = {
  overlay: { mimes: ['image/png', 'image/webp'], maxBytes: 25 * MB },
  layout: { mimes: IMAGES, maxBytes: 25 * MB },
  intro: { mimes: [...VIDEOS, ...IMAGES], maxBytes: 25 * MB, maxVideoBytes: 200 * MB, maxDurationMs: 30_000 },
  outro: { mimes: [...VIDEOS, ...IMAGES], maxBytes: 25 * MB, maxVideoBytes: 200 * MB, maxDurationMs: 30_000 },
  audio: { mimes: ['audio/mpeg', 'audio/mp4', 'audio/aac', 'audio/wav'], maxBytes: 50 * MB, maxDurationMs: 900_000 },
  font: { mimes: ['font/woff2', 'font/woff', 'font/ttf', 'font/otf'], maxBytes: 10 * MB },
  logo: { mimes: IMAGES, maxBytes: 10 * MB },
  background: { mimes: [...IMAGES, 'video/mp4', 'video/webm'], maxBytes: 25 * MB, maxVideoBytes: 200 * MB },
};

export type AssetMediaKind = 'image' | 'video' | 'audio' | 'font';

export function assetMediaKind(mime: string): AssetMediaKind | null {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.startsWith('font/')) return 'font';
  return null;
}

/** The size limit for this type of asset in this format (videos are allowed more than images). */
export function assetMaxBytes(type: AssetType, mime: string): number {
  const rule = ASSET_RULES[type];
  return assetMediaKind(mime) === 'video' && rule.maxVideoBytes ? rule.maxVideoBytes : rule.maxBytes;
}

/** The duration limit that applies to this file, if it is video or audio and the type has one. */
export function assetMaxDurationMs(type: AssetType, mime: string): number | null {
  const kind = assetMediaKind(mime);
  return (kind === 'video' || kind === 'audio') && ASSET_RULES[type].maxDurationMs
    ? ASSET_RULES[type].maxDurationMs
    : null;
}

/** Content types browsers and tools report for the same format. */
const MIME_ALIASES: Record<string, string> = {
  'audio/x-wav': 'audio/wav',
  'audio/wave': 'audio/wav',
  'audio/vnd.wave': 'audio/wav',
  'audio/x-m4a': 'audio/mp4',
  'audio/mp3': 'audio/mpeg',
  'audio/x-aac': 'audio/aac',
  'image/jpg': 'image/jpeg',
};

export function normaliseMime(mime: string): string {
  const base = (mime.split(';')[0] ?? '').trim().toLowerCase();
  return MIME_ALIASES[base] ?? base;
}

function startsWith(head: Uint8Array, at: number, ...values: (number | string)[]): boolean {
  if (head.length < at + values.length) return false;
  return values.every((v, i) => head[at + i] === (typeof v === 'string' ? v.charCodeAt(0) : v));
}
const ascii = (head: Uint8Array, at: number, text: string) => startsWith(head, at, ...text.split(''));

/**
 * Identify a file from its first bytes, ignoring its name and whatever type the client claimed.
 * Returns null for anything we don't accept anywhere (including SVG, which is text).
 */
export function sniffMime(head: Uint8Array): string | null {
  if (startsWith(head, 0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'image/png';
  if (startsWith(head, 0, 0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (ascii(head, 0, 'RIFF')) {
    if (ascii(head, 8, 'WEBP')) return 'image/webp';
    if (ascii(head, 8, 'WAVE')) return 'audio/wav';
    return null;
  }
  if (ascii(head, 4, 'ftyp')) {
    if (ascii(head, 8, 'qt  ')) return 'video/quicktime';
    if (ascii(head, 8, 'M4A ')) return 'audio/mp4';
    return 'video/mp4';
  }
  if (startsWith(head, 0, 0x1a, 0x45, 0xdf, 0xa3)) return 'video/webm';
  if (ascii(head, 0, 'wOF2')) return 'font/woff2';
  if (ascii(head, 0, 'wOFF')) return 'font/woff';
  if (startsWith(head, 0, 0x00, 0x01, 0x00, 0x00) || ascii(head, 0, 'true')) return 'font/ttf';
  if (ascii(head, 0, 'OTTO')) return 'font/otf';
  if (ascii(head, 0, 'ID3')) return 'audio/mpeg';
  if (head.length >= 3 && head[0] === 0xff && (head[1]! & 0xe0) === 0xe0) {
    const b1 = head[1]!;
    const layer = (b1 >> 1) & 3;
    // ADTS (raw AAC) is the same 12-bit sync with the layer bits forced to 00.
    if (layer === 0) return (b1 & 0xf0) === 0xf0 ? 'audio/aac' : null;
    const version = (b1 >> 3) & 3;
    const b2 = head[2]!;
    // Reserved version, bitrate "bad" and sample-rate "reserved" values are not an MP3 frame.
    if (version === 1 || b2 >> 4 === 0xf || ((b2 >> 2) & 3) === 3) return null;
    return 'audio/mpeg';
  }
  return null;
}

/**
 * The content type to store and sign for an upload, from what its bytes say. An MP4 container is
 * audio or video depending on its tracks, which the brand can't tell: an audio asset takes it as
 * audio. Null when the bytes aren't a format we know.
 */
export function canonicalMime(type: AssetType, sniffed: string | null): string | null {
  if (type === 'audio' && sniffed === 'video/mp4') return 'audio/mp4';
  return sniffed;
}

/** Issue messages are stable codes, not prose: wrong_type, too_big, too_long (the UI translates them). */
export const assetUploadSchema = z
  .object({
    type: z.enum(ASSET_TYPES, 'invalid_asset_type'),
    name: z.string('invalid_name').trim().min(1, 'invalid_name').max(120, 'invalid_name'),
    mime: z.string('wrong_type').max(100, 'wrong_type').transform(normaliseMime),
    bytes: z.number('invalid_size').int('invalid_size').positive('invalid_size'),
    width: z.number().int().positive().optional(),
    height: z.number().int().positive().optional(),
    durationMs: z.number().int().min(0).optional(),
  })
  .superRefine((v, ctx) => {
    const mime = normaliseMime(v.mime);
    const rule = ASSET_RULES[v.type];
    if (!rule.mimes.includes(mime)) {
      ctx.addIssue({ code: 'custom', message: 'wrong_type', path: ['mime'] });
      return;
    }
    if (v.bytes > assetMaxBytes(v.type, mime)) ctx.addIssue({ code: 'custom', message: 'too_big', path: ['bytes'] });
    const maxMs = assetMaxDurationMs(v.type, mime);
    if (!maxMs) return;
    // A length limit is only a limit if the length is declared: the browser always measures it, so
    // an upload without one didn't come from our UI.
    if (v.durationMs === undefined || v.durationMs > maxMs)
      ctx.addIssue({ code: 'custom', message: 'too_long', path: ['durationMs'] });
  });

export type AssetUploadInput = z.input<typeof assetUploadSchema>;
export type AssetUploadValues = z.output<typeof assetUploadSchema>;
