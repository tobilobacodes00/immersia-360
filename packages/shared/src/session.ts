/**
 * Guest sessions (DL-1): one capture session = one link (and one short code) bundling every output
 * the guest made. The booth mints the session and link ids offline and registers them when online.
 */
import { z } from 'zod';
import { SHORT_CODE_ALPHABET, SHORT_CODE_LENGTH, isLinkId } from './ids';

export const OUTPUT_KINDS = ['mp4', 'small_mp4', 'gif', 'strip', 'short_video', 'boomerang', 'poster'] as const;
export type OutputKind = (typeof OUTPUT_KINDS)[number];

/** Upload order per session: what a guest needs first goes first (poster → small → full). */
export const UPLOAD_PRIORITY: Record<OutputKind, number> = {
  poster: 0,
  small_mp4: 1,
  gif: 2,
  strip: 2,
  boomerang: 3,
  short_video: 3,
  mp4: 4,
};

/** Largest single guest file we accept (a 20 s 4K Original render is well under this). */
export const MAX_OUTPUT_BYTES = 2 * 1024 ** 3;

const linkId = z.string().refine(isLinkId, 'invalid_link_id');
const shortCode = z.string().regex(new RegExp(`^[${SHORT_CODE_ALPHABET}]{${SHORT_CODE_LENGTH}}$`));

export const outputMetaSchema = z.object({
  id: z.uuid(),
  takeId: z.uuid().nullable(),
  kind: z.enum(OUTPUT_KINDS),
  mime: z.enum(['video/mp4', 'image/gif', 'image/jpeg', 'image/png']),
  bytes: z.number().int().positive().max(MAX_OUTPUT_BYTES),
  width: z.number().int().positive().max(8192),
  height: z.number().int().positive().max(8192),
  durationMs: z
    .number()
    .int()
    .min(0)
    .max(10 * 60_000),
});

/** The raw recording an output was rendered from (the raw file itself stays on the device). */
export const takeMetaSchema = z.object({
  id: z.uuid(),
  capturedAt: z.iso.datetime(),
  durationMs: z
    .number()
    .int()
    .min(0)
    .max(10 * 60_000),
  fps: z.number().int().min(1).max(960),
  width: z.number().int().positive().max(8192),
  height: z.number().int().positive().max(8192),
  trigger: z.enum(['tap', 'timer', 'motion', 'remote', 'keyboard', 'import']),
});

export const registerSessionSchema = z
  .object({
    id: z.uuid(),
    eventId: z.uuid(),
    linkId,
    /** Null when the device's code pool ran dry offline: the server assigns one. */
    shortCode: shortCode.nullable(),
    capturedAt: z.iso.datetime(),
    optedOutOfDisplay: z.boolean(),
    takes: z.array(takeMetaSchema).max(8),
    outputs: z.array(outputMetaSchema).max(16),
  })
  .refine((s) => s.outputs.every((o) => o.takeId === null || s.takes.some((t) => t.id === o.takeId)), {
    message: 'output_take_missing',
    path: ['outputs'],
  });

export type TakeMeta = z.infer<typeof takeMetaSchema>;

export type RegisterSessionInput = z.infer<typeof registerSessionSchema>;
export type OutputMeta = z.infer<typeof outputMetaSchema>;

export const reserveCodesSchema = z.object({
  eventId: z.uuid(),
  count: z.number().int().min(1).max(300),
});

/** A presigned single-part upload for one output (the exact size and type are signed). */
export interface UploadTicket {
  /** The server's id for the output. Matched on the device by (kind, takeId): a re-rendered take
   *  gets a new local id, but the session keeps one output per kind and take. */
  outputId: string;
  kind: OutputKind;
  takeId: string | null;
  url: string;
  method: 'PUT';
  headers: Record<string, string>;
}

export interface RegisterSessionResult {
  /** The code the session ended up with (the device's, or one the server assigned). */
  shortCode: string;
  filenamePrefix: string;
  /** Outputs not stored yet. */
  uploads: UploadTicket[];
}
