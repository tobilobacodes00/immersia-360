/**
 * The render path ladder (`local` → `wasm` → `server`) and the contracts of the server rung.
 *
 * - A booth renders on its own device when it can (`local`), with a WASM H.264 encoder when the
 *   browser has none (`wasm`), and asks the render worker when neither works (`server`).
 * - The recipe is everything the worker needs to reproduce a local render, without the media: the
 *   same settings the booth hands its own renderer. Media the recipe refers to is either a library
 *   asset (by id; the server resolves it against the organization) or one of the three files the
 *   booth uploads for the job (the take's original, the drawn overlay, the drawn end card), whose
 *   storage keys the SERVER derives. A client never names an object key.
 * - Everything crossing a trust boundary is a zod schema here: the booth API, the worker API and
 *   the worker itself validate against the same definitions.
 */
import { z } from 'zod';
import type { RenderPath } from './analytics';
import { musicSchema } from './event';

export const RENDER_PATHS = ['local', 'wasm', 'server'] as const satisfies readonly RenderPath[];
export const renderPathSchema = z.enum(RENDER_PATHS);

// ---------------------------------------------------------------------------------------------
// Files the booth uploads for a server render

export const SERVER_FILE_ROLES = ['original', 'overlay', 'end_card'] as const;
export type ServerFileRole = (typeof SERVER_FILE_ROLES)[number];

/** Size and type limits of each file; the signed upload carries the exact length and type. */
export const SERVER_FILE_LIMITS: Record<ServerFileRole, { maxBytes: number; mimes: readonly string[] }> = {
  original: { maxBytes: 1.5 * 1024 ** 3, mimes: ['video/mp4', 'video/webm', 'video/quicktime'] },
  overlay: { maxBytes: 16 * 1024 ** 2, mimes: ['image/png'] },
  end_card: { maxBytes: 16 * 1024 ** 2, mimes: ['image/png'] },
};

const fileDeclaration = (role: ServerFileRole) =>
  z
    .object({
      bytes: z.number().int().positive().max(SERVER_FILE_LIMITS[role].maxBytes),
      mime: z.enum(SERVER_FILE_LIMITS[role].mimes as [string, ...string[]]),
    })
    .strict();

/** Ask for upload URLs for some of a take's server-render files. */
export const serverFilesRequestSchema = z.object({
  files: z
    .array(
      z.discriminatedUnion('role', [
        fileDeclaration('original').extend({ role: z.literal('original') }),
        fileDeclaration('overlay').extend({ role: z.literal('overlay') }),
        fileDeclaration('end_card').extend({ role: z.literal('end_card') }),
      ]),
    )
    .min(1)
    .max(SERVER_FILE_ROLES.length)
    .refine((files) => new Set(files.map((f) => f.role)).size === files.length, 'duplicate_role'),
});
export type ServerFilesRequest = z.infer<typeof serverFilesRequestSchema>;

export interface ServerFileTicket {
  role: ServerFileRole;
  url: string;
  method: 'PUT';
  headers: Record<string, string>;
}

export interface ServerFilesResult {
  /** Upload these (the exact bytes declared). */
  uploads: ServerFileTicket[];
  /** Already stored at the declared size: nothing to do. */
  stored: ServerFileRole[];
}

// ---------------------------------------------------------------------------------------------
// The recipe

const card = z
  .object({
    assetId: z.uuid(),
    kind: z.enum(['image', 'video']),
    /** A still's length, or a clip's cap (already limited to the clip's real length by the booth). */
    seconds: z.number().min(0.5).max(5),
  })
  .strict();

/** CAP-10: what replaces the background behind the guest. A picture or video is a library asset of type `background`. */
const backgroundRecipe = z.union([
  z.strictObject({ kind: z.literal('color'), color: z.string().regex(/^#[0-9a-fA-F]{6}$/) }),
  z.strictObject({ kind: z.literal('blur') }),
  z.strictObject({ kind: z.literal('image'), assetId: z.uuid() }),
  z.strictObject({ kind: z.literal('video'), assetId: z.uuid() }),
]);

const slowMotion = z
  .object({
    enabled: z.boolean(),
    startS: z.number().min(0).max(600),
    endS: z.number().min(0).max(600),
    speed: z.number().min(0.125).max(1),
  })
  .strict();

export const renderRecipeSchema = z
  .object({
    version: z.literal(2),
    output: z
      .object({
        width: z.number().int().min(2).max(4320),
        height: z.number().int().min(2).max(4320),
        fps: z.number().int().min(1).max(60),
        bitrate: z.number().int().min(100_000).max(100_000_000),
      })
      .strict(),
    /** The quality preset behind the bitrate (analytics only). */
    preset: z.enum(['small', 'balanced', 'original']),
    slowMotion,
    reverse: z.enum(['none', 'boomerang', 'reverse']),
    look: z
      .object({ id: z.string().min(1).max(60), intensity: z.number().min(0).max(1) })
      .strict()
      .nullable(),
    effects: z
      .array(
        z
          .object({
            id: z.string().min(1).max(60),
            intensity: z.number().min(0).max(1),
            colorMode: z.enum(['colour', 'white', 'silver', 'gold']).nullable(),
          })
          .strict(),
      )
      .max(8),
    /** Beat times on the output timeline, seconds (the booth analysed the song once for all its takes). */
    beats: z.array(z.number().min(0).max(3600)).max(4000),
    seed: z.number().int().min(0).max(1_000_000),
    music: musicSchema.nullable(),
    background: backgroundRecipe.nullable(),
    intro: card.nullable(),
    outro: card.nullable(),
    /** DL-4: the closing QR card (drawn by the booth and uploaded as `end_card`). */
    endCard: z
      .object({ seconds: z.number().min(0.5).max(5) })
      .strict()
      .nullable(),
    /** What the booth uploaded for this job (verified against storage before the job is queued). */
    files: z
      .object({
        original: fileDeclaration('original'),
        overlay: fileDeclaration('overlay').nullable(),
        endCard: fileDeclaration('end_card').nullable(),
      })
      .strict(),
    /** The extra outputs to make after the main video (DL-8). */
    derive: z.object({ poster: z.boolean(), small: z.boolean() }).strict(),
  })
  .strict()
  .refine((r) => (r.endCard === null) === (r.files.endCard === null), 'end_card_mismatch');
export type RenderRecipe = z.infer<typeof renderRecipeSchema>;

/** Library assets a recipe refers to (they must belong to the event's organization). */
export function recipeAssetIds(recipe: RenderRecipe): string[] {
  return [
    ...new Set(
      [
        recipe.music?.assetId,
        recipe.intro?.assetId,
        recipe.outro?.assetId,
        recipe.background && 'assetId' in recipe.background ? recipe.background.assetId : undefined,
      ].filter((x): x is string => !!x),
    ),
  ];
}

export const serverRenderRequestSchema = z.object({ sessionId: z.uuid(), recipe: renderRecipeSchema });
export type ServerRenderRequest = z.infer<typeof serverRenderRequestSchema>;

// ---------------------------------------------------------------------------------------------
// Jobs

export const RENDER_JOB_STATUSES = ['queued', 'running', 'done', 'failed'] as const;
export type RenderJobStatus = (typeof RENDER_JOB_STATUSES)[number];

/**
 * Stable codes for why a server render failed or was refused. They are stored, shown to operators
 * (studio.dashboard.serverRenders.errors.*, booth.renderErrors.*) and never carry user data.
 */
export const SERVER_RENDER_ERRORS = [
  /** The take can't be decoded anywhere (damaged, or a codec Chrome lacks). Never retried. */
  'undecodable',
  /** The worker's Chrome has no H.264 encoder and the WASM fallback failed too. */
  'unsupported_encoder',
  'encoder_stall',
  'gpu',
  /** The original (or another file) was gone from storage. Never retried. */
  'source_missing',
  'download_failed',
  'upload_failed',
  /** A render ran past its time limit. */
  'timeout',
  /** The worker went away mid-render (its lease ran out). */
  'lease_lost',
  /** The worker stopped while rendering (machine shutdown). */
  'shutdown',
  /** The recipe does not validate (a booth/worker version mismatch). Never retried. */
  'invalid_recipe',
  'failed',
] as const;
export type ServerRenderError = (typeof SERVER_RENDER_ERRORS)[number];
export const isServerRenderError = (v: string): v is ServerRenderError =>
  (SERVER_RENDER_ERRORS as readonly string[]).includes(v);

export interface ServerRenderJobView {
  id: string;
  status: RenderJobStatus;
  attempts: number;
  error: ServerRenderError | null;
}

/** Why the server refused a render request (the booth surfaces these). */
export type ServerRenderRefusal =
  | { error: 'render_rate_limited'; scope: 'event_hourly' | 'event_total' | 'org_daily'; retryAfterS: number }
  | { error: 'server_render_unavailable' }
  | { error: 'take_not_registered' | 'session_not_found' | 'files_incomplete' | 'asset_invalid' | 'invalid' };

// ---------------------------------------------------------------------------------------------
// Booth → server: what a render did (analytics and the device's remembered rung)

export const renderReportSchema = z.discriminatedUnion('outcome', [
  z
    .object({
      outcome: z.literal('completed'),
      path: renderPathSchema,
      renderMs: z.number().int().min(0).max(3_600_000),
      preset: z.enum(['small', 'balanced', 'original']),
      effectsCount: z.number().int().min(0).max(8),
    })
    .strict(),
  z
    .object({
      outcome: z.literal('failed'),
      path: renderPathSchema,
      errorCode: z.string().min(1).max(60),
      browser: z.string().min(1).max(60),
    })
    .strict(),
]);
export type RenderReport = z.infer<typeof renderReportSchema>;

/** What a booth sends after a render: how it went, and the rung that worked (to remember for the device). */
export const renderReportRequestSchema = z
  .object({
    report: renderReportSchema,
    remember: renderPathSchema.optional(),
    eventId: z.uuid().optional(),
  })
  .strict();
export type RenderReportRequest = z.infer<typeof renderReportRequestSchema>;

// ---------------------------------------------------------------------------------------------
// Worker ↔ server (authenticated by RENDER_WORKER_SECRET)

export const workerClaimRequestSchema = z.object({ workerId: z.string().min(1).max(80) }).strict();

/** Short-lived download URLs for everything a job reads. Absent files are `null`. */
export interface WorkerJobUrls {
  original: string;
  overlay: string | null;
  endCard: string | null;
  intro: string | null;
  outro: string | null;
  music: string | null;
  background: string | null;
}

export interface WorkerClaim {
  job: null | {
    id: string;
    /** Proves a later call comes from the worker that holds the claim (a stale worker can't finish a job twice). */
    claimToken: string;
    /** Including this try. */
    attempts: number;
    maxAttempts: number;
    /** The claim lasts this long unless extended by a heartbeat. */
    leaseMs: number;
    recipe: RenderRecipe;
    urls: WorkerJobUrls;
  };
}

export const workerTokenSchema = z.object({ claimToken: z.string().min(16).max(80) }).strict();

export const WORKER_OUTPUT_KINDS = ['mp4', 'small_mp4', 'poster'] as const;
export type WorkerOutputKind = (typeof WORKER_OUTPUT_KINDS)[number];

const WORKER_OUTPUT_MIME: Record<WorkerOutputKind, 'video/mp4' | 'image/jpeg'> = {
  mp4: 'video/mp4',
  small_mp4: 'video/mp4',
  poster: 'image/jpeg',
};
export const workerOutputMime = (kind: WorkerOutputKind) => WORKER_OUTPUT_MIME[kind];

export const workerOutputsRequestSchema = workerTokenSchema.extend({
  outputs: z
    .array(
      z
        .object({
          kind: z.enum(WORKER_OUTPUT_KINDS),
          bytes: z
            .number()
            .int()
            .positive()
            .max(2 * 1024 ** 3),
          width: z.number().int().positive().max(8192),
          height: z.number().int().positive().max(8192),
          durationMs: z
            .number()
            .int()
            .min(0)
            .max(10 * 60_000),
        })
        .strict(),
    )
    .min(1)
    .max(WORKER_OUTPUT_KINDS.length)
    .refine((o) => new Set(o.map((x) => x.kind)).size === o.length, 'duplicate_kind'),
});
export type WorkerOutputsRequest = z.infer<typeof workerOutputsRequestSchema>;

export interface WorkerOutputTicket {
  kind: WorkerOutputKind;
  outputId: string;
  url: string;
  method: 'PUT';
  headers: Record<string, string>;
}

export const workerCompleteRequestSchema = workerTokenSchema.extend({
  renderMs: z
    .number()
    .int()
    .min(0)
    .max(24 * 3_600_000),
});

export const workerFailRequestSchema = workerTokenSchema.extend({
  code: z.enum(SERVER_RENDER_ERRORS),
});
