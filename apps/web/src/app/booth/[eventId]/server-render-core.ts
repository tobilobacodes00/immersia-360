import type { QualityPreset } from '@immersia/render-engine';
import {
  renderRecipeSchema,
  type RenderRecipe,
  type ServerFileRole,
  type ServerFileTicket,
  type ServerFilesResult,
  type ServerRenderJobView,
  type Video360Settings,
} from '@immersia/shared';

/**
 * The booth's side of the `server` rung, free of the network and the device database so it can be
 * tested exactly: the recipe it sends, and what it makes of every answer the server can give.
 */

/** A card (intro or outro) as the recipe describes it. */
export interface CardPlan {
  assetId: string;
  kind: 'image' | 'video';
  seconds: number;
}

/** Everything about a render that is not media: what the booth hands its own renderer, minus the blobs. */
export interface RecipePlan {
  output: { width: number; height: number; fps: number; bitrate: number };
  preset: QualityPreset;
  slowMotion: RenderRecipe['slowMotion'];
  reverse: RenderRecipe['reverse'];
  look: RenderRecipe['look'];
  effects: RenderRecipe['effects'];
  beats: number[];
  seed: number;
  music: Video360Settings['music'];
  /** CAP-10: what goes behind the guest; a picture or video is a library asset. */
  background: RenderRecipe['background'];
  intro: CardPlan | null;
  outro: CardPlan | null;
  /** Seconds the QR end card stays on screen, or null for none. */
  endCardSeconds: number | null;
  /** DL-8: also make the lighter copy for messaging apps (the event's setting). */
  smallCopy: boolean;
}

export interface FileDeclarations {
  original: { bytes: number; mime: string };
  overlay: { bytes: number } | null;
  endCard: { bytes: number } | null;
}

/** The part of a library asset the recipe needs to know. */
export interface AssetInfo {
  mime: string;
  durationMs: number | null;
}

/**
 * An intro or outro as the recipe describes it, from the event's assets: a still of the card length, or a
 * clip no longer than the card (and no longer than the clip itself, as on the booth). Null when the asset
 * is not there or is not a picture or video.
 */
export function describeCard(
  assetId: string | null,
  assets: ReadonlyMap<string, AssetInfo>,
  cardSeconds: number,
): CardPlan | null {
  const a = assetId ? assets.get(assetId) : undefined;
  if (!assetId || !a) return null;
  if (a.mime.startsWith('image/')) return { assetId, kind: 'image', seconds: cardSeconds };
  if (!a.mime.startsWith('video/')) return null;
  const clipS = a.durationMs ? a.durationMs / 1000 : cardSeconds;
  // The recipe's floor (half a second) keeps a degenerate clip from invalidating the whole job.
  return { assetId, kind: 'video', seconds: Math.max(0.5, Math.min(cardSeconds, clipS)) };
}

/** The event's background (CAP-10) as the recipe describes it. A picture or video that is not in the library is left out. */
export function describeBackground(
  background: Video360Settings['background'],
  assets: ReadonlyMap<string, AssetInfo>,
): RenderRecipe['background'] {
  if (!background) return null;
  if ('color' in background) return { kind: 'color', color: background.color };
  if ('blur' in background) return { kind: 'blur' };
  const a = assets.get(background.assetId);
  if (!a) return null;
  return a.mime.startsWith('video/')
    ? { kind: 'video', assetId: background.assetId }
    : a.mime.startsWith('image/')
      ? { kind: 'image', assetId: background.assetId }
      : null;
}

/** The video types the server accepts for an original; anything else can not be rendered there. */
export function originalMime(mimeType: string): 'video/mp4' | 'video/webm' | 'video/quicktime' | null {
  const base = mimeType.split(';')[0]!.trim().toLowerCase();
  return base === 'video/mp4' || base === 'video/webm' || base === 'video/quicktime' ? base : null;
}

/**
 * The recipe for a server render. With `stripAssets`, the library assets (music, intro, outro) are
 * left out: the booth's own renderer carries on without a file it can not read, and so does this.
 * Validated here against the shared schema: a booth never sends a recipe the server would refuse.
 */
export function buildRecipe(
  plan: RecipePlan,
  files: FileDeclarations,
  options: { stripAssets?: boolean } = {},
): RenderRecipe {
  const strip = options.stripAssets === true;
  const mime = originalMime(files.original.mime);
  if (!mime) throw new RangeError(`The server can not render a ${files.original.mime || 'file'} recording`);
  return renderRecipeSchema.parse({
    version: 2,
    output: plan.output,
    preset: plan.preset,
    slowMotion: plan.slowMotion,
    reverse: plan.reverse,
    look: plan.look,
    effects: plan.effects,
    beats: plan.beats,
    seed: plan.seed,
    music: strip ? null : plan.music,
    // A colour or a blur needs no file; only a picture or video can be the one the server can not use.
    background: strip && plan.background && 'assetId' in plan.background ? null : plan.background,
    intro: strip ? null : plan.intro,
    outro: strip ? null : plan.outro,
    endCard: files.endCard && plan.endCardSeconds !== null ? { seconds: plan.endCardSeconds } : null,
    files: {
      original: { bytes: files.original.bytes, mime },
      overlay: files.overlay ? { bytes: files.overlay.bytes, mime: 'image/png' } : null,
      endCard: files.endCard && plan.endCardSeconds !== null ? { bytes: files.endCard.bytes, mime: 'image/png' } : null,
    },
    derive: { poster: true, small: plan.smallCopy },
  });
}

// ---------------------------------------------------------------------------------------------
// Answers

/** An HTTP answer from the server, or a failure to get one (status 0). */
export class ServerApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly retryAfterS: number | null = null,
    /** The limit that was hit, for 429s. */
    readonly scope: string | null = null,
  ) {
    super(`${status} ${code}`);
    this.name = 'ServerApiError';
  }
}

/** What the booth shows about a take, as keys of `booth.renderErrors`. */
export type TakeServerError =
  | 'server_unavailable'
  | 'server_rate_limited'
  | 'server_limit'
  | 'server_upload'
  | 'server_failed'
  | 'undecodable'
  | 'unsupported_encoder'
  | 'encoder_stall'
  | 'gpu';

/** How long to wait between server polls while a job renders. */
export const POLL_MS = 8_000;

/** Server answers of the same kind in a row (about 40 minutes at the longest delay) before a take fails. */
export const MAX_ANSWERS = 24;

/** 5 s, 10 s, 20 s … capped at 2 min: a booth that is offline or a server that is busy is asked again, patiently. */
export const retryDelayMs = (attempts: number) => Math.min(5_000 * 2 ** Math.max(0, attempts - 1), 120_000);

/** Why a server job failed, as the operator at the booth reads it. */
export function jobFailure(code: string | null): TakeServerError {
  return code === 'undecodable' || code === 'unsupported_encoder' || code === 'encoder_stall' || code === 'gpu'
    ? code
    : 'server_failed';
}

export type Outcome =
  /** Try again later; `note` is shown meanwhile (null: nothing to say). */
  | { kind: 'retry'; inMs: number; note: TakeServerError | null }
  /** Try again at once, without the library assets (the server says one is not usable). */
  | { kind: 'strip_assets' }
  | { kind: 'fail'; error: TakeServerError };

/**
 * What to do after a failed call. `attempts` counts the failures so far; `stripped` says the recipe
 * already went without library assets. Network errors (status 0) and busy servers are retried
 * forever with a growing delay: the booth keeps working and the guest's QR already shows "on its way".
 */
export function outcomeOf(err: unknown, attempts: number, stripped: boolean): Outcome {
  if (!(err instanceof ServerApiError)) {
    // A recording the server can not take (type or size), or a recipe the booth could not build: retrying changes nothing.
    if ((err instanceof Error && err.name === 'ZodError') || err instanceof RangeError)
      return { kind: 'fail', error: 'server_upload' };
    // Anything else is a network error or a storage hiccup while uploading.
    return { kind: 'retry', inMs: retryDelayMs(attempts), note: null };
  }
  switch (err.code) {
    case 'render_rate_limited':
      // The hourly and daily limits clear by themselves; the event's total never does.
      if (err.scope === 'event_total') return { kind: 'fail', error: 'server_limit' };
      return { kind: 'retry', inMs: Math.max(60, err.retryAfterS ?? 60) * 1000, note: 'server_rate_limited' };
    case 'server_render_unavailable':
      return { kind: 'fail', error: 'server_unavailable' };
    case 'asset_invalid':
      return stripped ? { kind: 'fail', error: 'server_failed' } : { kind: 'strip_assets' };
    case 'invalid':
      return { kind: 'fail', error: 'server_failed' };
    default:
      // The server keeps answering with the same error (a storage that is not configured, say): give up
      // after a while rather than leave the take on the server forever. A booth that merely has no
      // connection never gets here (that is not an answer).
      if (attempts >= MAX_ANSWERS) return { kind: 'fail', error: 'server_failed' };
      // Not registered yet (the upload queue is on it), files still arriving, an overloaded or
      // restarting server, a revoked device (the upload queue tells the operator).
      return { kind: 'retry', inMs: retryDelayMs(attempts), note: null };
  }
}

/** The fields of a take the server rung keeps current. */
export interface ServerProgress {
  serverJobId?: string;
  serverCheckAt?: number;
  serverAttempts?: number;
  serverStripped?: boolean;
  error?: string;
}

export type StepResult =
  | { kind: 'wait'; patch: ServerProgress }
  | { kind: 'rendered'; patch: ServerProgress }
  | { kind: 'failed'; error: TakeServerError; patch: ServerProgress };

/** What a job's state means for the take. */
export function progressOf(job: ServerRenderJobView, now: number): StepResult {
  if (job.status === 'done') return { kind: 'rendered', patch: { serverJobId: job.id } };
  if (job.status === 'failed') return { kind: 'failed', error: jobFailure(job.error), patch: { serverJobId: job.id } };
  return {
    kind: 'wait',
    patch: { serverJobId: job.id, serverCheckAt: now + POLL_MS, serverAttempts: 0, error: undefined },
  };
}

/** How often a failed server render is looked at again, to notice an operator starting it again from the studio. */
export const FAILED_RECHECK_MS = 5 * 60_000;

export type RecheckResult = StepResult | { kind: 'idle'; patch: ServerProgress };

/**
 * A take whose server render failed is looked at now and then: the operator can start the job again from
 * the studio's event dashboard, and the take should follow it (rendered, or back to waiting) rather
 * than stay "failed" on the booth while the guest already has their video.
 */
export function recheckOf(job: ServerRenderJobView | null, now: number): RecheckResult {
  if (!job || job.status === 'failed') return { kind: 'idle', patch: { serverCheckAt: now + FAILED_RECHECK_MS } };
  return progressOf(job, now);
}

/** Takes the server rung still has an eye on: waiting for the worker, or failed there and worth a second look. */
export function watchesServer(take: {
  status: string;
  renderPath?: string;
  serverJobId?: string;
  serverCheckAt?: number;
}): boolean {
  if (take.status === 'server') return true;
  return (
    take.status === 'failed' &&
    take.renderPath === 'server' &&
    take.serverJobId !== undefined &&
    take.serverCheckAt !== undefined
  );
}

/** The result of a step that ended in `outcome`. */
export function resultOf(outcome: Outcome, attempts: number, now: number): StepResult {
  switch (outcome.kind) {
    case 'fail':
      return { kind: 'failed', error: outcome.error, patch: {} };
    case 'strip_assets':
      return { kind: 'wait', patch: { serverStripped: true, serverCheckAt: now, serverAttempts: 0, error: undefined } };
    case 'retry':
      return {
        kind: 'wait',
        patch: { serverCheckAt: now + outcome.inMs, serverAttempts: attempts + 1, error: outcome.note ?? undefined },
      };
  }
}

// ---------------------------------------------------------------------------------------------
// One step of a take on the server

/** The server calls a take's server render makes (implemented over fetch with the device token). */
export interface ServerRenderApi {
  requestFiles(
    takeId: string,
    files: { role: ServerFileRole; bytes: number; mime: string }[],
  ): Promise<ServerFilesResult>;
  /** PUT the bytes to a presigned URL. */
  put(ticket: ServerFileTicket, body: Blob): Promise<void>;
  requestRender(takeId: string, input: { sessionId: string; recipe: RenderRecipe }): Promise<ServerRenderJobView>;
  /** The take's latest job, or null when there is none. */
  job(takeId: string): Promise<ServerRenderJobView | null>;
}

/** What a submission needs, prepared fresh for every attempt (the bitmaps behind the PNGs are single use). */
export interface PreparedJob {
  plan: RecipePlan;
  original: Blob;
  /** The recording's MIME type as the device stored it. */
  originalMime: string;
  overlay: Blob | null;
  endCard: Blob | null;
}

export interface ServerStepDeps {
  api: ServerRenderApi;
  /** The take's guest session (it must be registered with the server before a job can name it). */
  sessionId(): Promise<string | null>;
  prepare(): Promise<PreparedJob>;
}

/** The part of a take a step reads. */
export interface ServerTake {
  id: string;
  serverJobId?: string;
  serverAttempts?: number;
  serverStripped?: boolean;
}

/**
 * One step of a take's life on the server: ask about its job, or, when there is none yet, upload its
 * files and queue one. Never throws: every outcome is a result the booth writes to the take.
 */
export async function serverStep(take: ServerTake, deps: ServerStepDeps, now: number): Promise<StepResult> {
  const attempts = take.serverAttempts ?? 0;
  const stripped = take.serverStripped === true;
  try {
    if (take.serverJobId) {
      const job = await deps.api.job(take.id);
      if (job) return progressOf(job, now);
      // The server has no job for it (it was cleared): submit again below.
    }
    const sessionId = await deps.sessionId();
    // No guest session yet: the booth's own upload queue is about to register it.
    if (!sessionId) return { kind: 'wait', patch: { serverCheckAt: now + 5_000 } };
    const job = await submit(take, sessionId, await deps.prepare(), deps.api, stripped);
    return progressOf(job, now);
  } catch (err) {
    return resultOf(outcomeOf(err, attempts, stripped), attempts, now);
  }
}

async function submit(
  take: ServerTake,
  sessionId: string,
  prepared: PreparedJob,
  api: ServerRenderApi,
  stripped: boolean,
): Promise<ServerRenderJobView> {
  const recipe = buildRecipe(
    prepared.plan,
    {
      original: { bytes: prepared.original.size, mime: prepared.originalMime },
      overlay: prepared.overlay ? { bytes: prepared.overlay.size } : null,
      endCard: prepared.endCard ? { bytes: prepared.endCard.size } : null,
    },
    { stripAssets: stripped },
  );
  const blobs: Record<ServerFileRole, Blob | null> = {
    original: prepared.original,
    overlay: prepared.overlay,
    end_card: prepared.endCard,
  };
  const declared: { role: ServerFileRole; bytes: number; mime: string }[] = [
    { role: 'original', bytes: recipe.files.original.bytes, mime: recipe.files.original.mime },
    ...(recipe.files.overlay ? [{ role: 'overlay' as const, ...recipe.files.overlay }] : []),
    ...(recipe.files.endCard ? [{ role: 'end_card' as const, ...recipe.files.endCard }] : []),
  ];
  // Only what is not in storage yet goes up: a booth that lost its connection part-way carries on from there.
  const { uploads } = await api.requestFiles(take.id, declared);
  for (const ticket of uploads) await api.put(ticket, blobs[ticket.role]!);
  return api.requestRender(take.id, { sessionId, recipe });
}
