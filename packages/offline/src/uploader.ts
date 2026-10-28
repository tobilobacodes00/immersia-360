import {
  UPLOAD_PRIORITY,
  UPLOAD_REFUSAL_CODES,
  isUploadRefusalCode,
  type OutputKind,
  type RegisterSessionInput,
  type RegisterSessionResult,
  type UploadTicket,
} from '@immersia/shared';
import type { BoothDB, LocalOutput, LocalSession, LocalTake } from './db';
import type { TakeStore } from './take-store';

/** The server calls the queue makes; implemented over fetch with the device token in the app. */
export interface BoothApi {
  registerSession(input: RegisterSessionInput): Promise<RegisterSessionResult>;
  /** PUT the bytes to a presigned URL. */
  put(ticket: UploadTicket, body: Blob): Promise<void>;
  complete(outputId: string): Promise<'ok' | 'incomplete' | 'not_found'>;
  /** SHR-2: email the session link (the session must be registered). */
  sendEmail(sessionId: string, to: string): Promise<void>;
  /** LIV-8: take the session off every display (the session must be registered). */
  optOutOfDisplay(sessionId: string): Promise<void>;
}

/**
 * A failed call. `retryable` errors (network, 5xx, 429) back off and try again; the rest (the event
 * is gone, a conflict) park the session for the operator. `deviceRevoked` stops the whole queue.
 */
export class BoothApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly retryable: boolean,
  ) {
    super(`${status} ${code}`);
    this.name = 'BoothApiError';
  }
  get deviceRevoked() {
    return this.status === 401;
  }
}

/** The server's answer (HTTP 410) when a guest deleted the session being uploaded. */
export const SESSION_ERASED = UPLOAD_REFUSAL_CODES.erased;
/** The server's answer (HTTP 410) when the platform took the session being uploaded down. */
export const SESSION_REMOVED = UPLOAD_REFUSAL_CODES.removed;

/** Presigned uploads last an hour; refresh well before. */
const TICKET_TTL_MS = 45 * 60_000;

/** Every output of a session: rendered from its takes, or made for the session itself. */
export async function sessionOutputs(db: BoothDB, session: LocalSession): Promise<LocalOutput[]> {
  const [byTake, bySession] = await Promise.all([
    session.takeIds.length ? db.outputs.where('takeId').anyOf(session.takeIds).toArray() : [],
    db.outputs.where('sessionId').equals(session.id).toArray(),
  ]);
  const seen = new Set(byTake.map((o) => o.id));
  return [...byTake, ...bySession.filter((o) => !seen.has(o.id))];
}

const RENDER_SETTLED: LocalTake['status'][] = ['rendered', 'failed'];

/** Exponential backoff with jitter: 2 s, 4 s, 8 s … capped at 5 minutes. */
export function backoffMs(attempts: number, random = Math.random): number {
  const base = Math.min(300_000, 2000 * 2 ** Math.max(0, attempts - 1));
  return Math.round(base * (0.75 + random() * 0.5));
}

export type UploadStep =
  | { kind: 'idle' }
  /** `retries`: how many attempts failed in a row before this one got through. */
  | { kind: 'uploaded'; sessionId: string; outputId: string; bytes: number; retries: number }
  | { kind: 'registered'; sessionId: string }
  | { kind: 'emailed'; sessionId: string }
  | { kind: 'opted_out'; sessionId: string }
  | { kind: 'done'; sessionId: string }
  | { kind: 'retry'; sessionId: string; error: string; inMs: number }
  | { kind: 'failed'; sessionId: string; error: string }
  | { kind: 'revoked' };

/**
 * The booth's upload queue (outbox pattern, after Immersia Booth's outbox): sessions live in the
 * device database, and each call to `runOnce` moves the most urgent one forward by one step —
 * register it, or upload one output — so the caller can stop between steps (offline, closing).
 *
 * Idempotent end to end: every id is minted on the device, registration can be repeated, and an
 * output only counts as uploaded once the server has checked the stored object's size.
 */
export class UploadQueue {
  constructor(
    private readonly db: BoothDB,
    private readonly store: TakeStore,
    private readonly api: BoothApi,
    private readonly now: () => number = Date.now,
  ) {}

  /** The next session with work due, oldest first. */
  private async nextDue(): Promise<LocalSession | undefined> {
    const now = this.now();
    const open = await this.db.sessions
      .where('state')
      .anyOf('local', 'registered')
      .filter((s) => s.nextAttemptAt <= now)
      .toArray();
    open.sort((a, b) => a.capturedAt - b.capturedAt);
    return open[0];
  }

  /** When the next session becomes due (for the caller's timer), or null when nothing is waiting. */
  async nextWakeAt(): Promise<number | null> {
    const open = await this.db.sessions.where('state').anyOf('local', 'registered').toArray();
    return open.length ? Math.min(...open.map((s) => s.nextAttemptAt)) : null;
  }

  async runOnce(): Promise<UploadStep> {
    const session = await this.nextDue();
    if (!session) return { kind: 'idle' };
    try {
      return await this.advance(session);
    } catch (err) {
      return this.fail(session, err);
    }
  }

  private async advance(session: LocalSession): Promise<UploadStep> {
    const takes = (await this.db.takes.bulkGet(session.takeIds)).filter((t): t is LocalTake => Boolean(t));
    const outputs = await sessionOutputs(this.db, session);

    // (Re-)register whenever the server hasn't seen the session or one of its outputs yet.
    if (session.state === 'local' || outputs.some((o) => !o.serverId)) {
      const result = await this.api.registerSession(toRegistration(session, takes, outputs));
      await this.db.transaction('rw', this.db.sessions, this.db.outputs, async () => {
        for (const ticket of result.uploads) {
          const local = outputs.find((o) => o.kind === ticket.kind && o.takeId === ticket.takeId);
          if (local) await this.db.outputs.update(local.id, { serverId: ticket.outputId });
        }
        // Outputs the server already has (registered and uploaded on an earlier attempt).
        for (const o of outputs)
          if (!o.serverId && !result.uploads.some((t) => t.kind === o.kind && t.takeId === o.takeId))
            await this.db.outputs.update(o.id, { serverId: o.id, uploadedAt: o.uploadedAt ?? this.now() });
        await this.db.sessions.update(session.id, {
          state: 'registered',
          shortCode: result.shortCode,
          filenamePrefix: result.filenamePrefix,
          attempts: 0,
          lastError: undefined,
          updatedAt: this.now(),
        });
      });
      this.tickets.set(session.id, { at: this.now(), uploads: result.uploads });
      return { kind: 'registered', sessionId: session.id };
    }

    // LIV-8 first of all: a guest who asked not to be on screen must come off it as soon as possible.
    if (session.displayOptOutPending) {
      await this.api.optOutOfDisplay(session.id);
      await this.db.sessions.update(session.id, {
        displayOptOutPending: false,
        attempts: 0,
        lastError: undefined,
        updatedAt: this.now(),
      });
      return { kind: 'opted_out', sessionId: session.id };
    }

    // SHR-2 emails go before uploads: the link works before the files arrive.
    const email = session.pendingEmails?.[0];
    if (email) {
      await this.api.sendEmail(session.id, email);
      await this.db.sessions.update(session.id, {
        pendingEmails: session.pendingEmails!.slice(1),
        attempts: 0,
        lastError: undefined,
        updatedAt: this.now(),
      });
      return { kind: 'emailed', sessionId: session.id };
    }

    // Upload the most urgent pending output: poster → small → … → full (what a guest needs first).
    const pending = outputs
      .filter((o) => !o.uploadedAt)
      .sort((a, b) => UPLOAD_PRIORITY[a.kind as OutputKind] - UPLOAD_PRIORITY[b.kind as OutputKind]);
    const next = pending[0];
    if (next) {
      const held = this.tickets.get(session.id);
      const fresh = held && this.now() - held.at < TICKET_TTL_MS ? held.uploads : null;
      const ticket = fresh?.find((t) => t.outputId === next.serverId);
      if (!ticket) {
        // No ticket in memory (a reload) or close to expiry (presigned for an hour): register again.
        return this.advance({ ...session, state: 'local' });
      }
      const body = await this.store.read(next.path, next.mime).catch(() => {
        // The file is gone from this device (storage cleared): nothing to retry.
        throw new BoothApiError(0, 'output_missing_locally', false);
      });
      await this.api.put(ticket, body);
      const confirmed = await this.api.complete(ticket.outputId);
      if (confirmed !== 'ok') throw new BoothApiError(409, `upload_${confirmed}`, true);
      await this.db.outputs.update(next.id, { uploadedAt: this.now() });
      await this.db.sessions.update(session.id, { attempts: 0, lastError: undefined, updatedAt: this.now() });
      return {
        kind: 'uploaded',
        sessionId: session.id,
        outputId: next.id,
        bytes: next.bytes,
        retries: session.attempts,
      };
    }

    // Nothing to upload. Done once every take has finished rendering; until then, check back later
    // (a new output makes it due again through the caller's wake-up).
    if (takes.every((t) => RENDER_SETTLED.includes(t.status))) {
      await this.db.sessions.update(session.id, { state: 'done', updatedAt: this.now() });
      this.tickets.delete(session.id);
      return { kind: 'done', sessionId: session.id };
    }
    await this.db.sessions.update(session.id, { nextAttemptAt: this.now() + 30_000, updatedAt: this.now() });
    return { kind: 'idle' };
  }

  /** Upload tickets from the last registration, per session (memory only: they expire anyway). */
  private tickets = new Map<string, { at: number; uploads: UploadTicket[] }>();

  /** A session-level output (photo strip, GIF) was added: look at the session now. */
  async nudgeSession(sessionId: string): Promise<void> {
    const session = await this.db.sessions.get(sessionId);
    if (session) await this.reopen(session);
  }

  /** A take of this session finished rendering: look at it now rather than at its next check. */
  async nudge(takeId: string): Promise<void> {
    const session = await this.db.sessions.where('takeIds').equals(takeId).first();
    if (session) await this.reopen(session);
  }

  private async reopen(session: LocalSession): Promise<void> {
    if (session.state === 'failed') return;
    // A later output (the messaging copy) reopens a finished session; a session in backoff waits.
    if (session.state === 'done')
      await this.db.sessions.update(session.id, { state: 'registered', nextAttemptAt: 0, updatedAt: this.now() });
    else if (session.attempts === 0)
      await this.db.sessions.update(session.id, { nextAttemptAt: this.now(), updatedAt: this.now() });
  }

  private async fail(session: LocalSession, err: unknown): Promise<UploadStep> {
    // Whatever went wrong, the next attempt starts from a fresh registration (idempotent).
    this.tickets.delete(session.id);
    const apiErr = err instanceof BoothApiError ? err : null;
    if (apiErr?.deviceRevoked) return { kind: 'revoked' };
    // The server will never take this session again: the guest deleted it (privacy) or the platform
    // took it down (reports). There is nothing left to upload and nothing for the operator to fix:
    // settle it quietly, and drop the address of any email still waiting (its link would lead to a
    // "deleted" or "removed" page).
    if (apiErr && isUploadRefusalCode(apiErr.code)) {
      await this.db.sessions.update(session.id, {
        state: 'done',
        lastError: undefined,
        pendingEmails: [],
        displayOptOutPending: false,
        updatedAt: this.now(),
      });
      return { kind: 'done', sessionId: session.id };
    }
    const message = apiErr ? apiErr.code : err instanceof Error ? err.message : String(err);
    const retryable = apiErr ? apiErr.retryable : true; // network errors and storage hiccups retry
    if (!retryable) {
      await this.db.sessions.update(session.id, { state: 'failed', lastError: message, updatedAt: this.now() });
      return { kind: 'failed', sessionId: session.id, error: message };
    }
    const attempts = session.attempts + 1;
    const inMs = backoffMs(attempts);
    await this.db.sessions.update(session.id, {
      attempts,
      nextAttemptAt: this.now() + inMs,
      lastError: message,
      updatedAt: this.now(),
    });
    return { kind: 'retry', sessionId: session.id, error: message, inMs };
  }
}

/** The registration payload for a session, from what the device has. */
export function toRegistration(
  session: LocalSession,
  takes: LocalTake[],
  outputs: LocalOutput[],
): RegisterSessionInput {
  return {
    id: session.id,
    eventId: session.eventId,
    linkId: session.linkId,
    shortCode: session.shortCode,
    capturedAt: new Date(session.capturedAt).toISOString(),
    optedOutOfDisplay: session.optedOutOfDisplay,
    takes: takes.map((t) => ({
      id: t.id,
      capturedAt: new Date(t.capturedAt).toISOString(),
      durationMs: Math.round(t.durationMs),
      fps: Math.max(1, Math.round(t.fps)),
      width: t.width,
      height: t.height,
      trigger: t.trigger,
    })),
    outputs: outputs.map((o) => ({
      id: o.serverId ?? o.id,
      takeId: o.takeId,
      kind: o.kind,
      mime: o.mime as RegisterSessionInput['outputs'][number]['mime'],
      bytes: o.bytes,
      width: o.width,
      height: o.height,
      durationMs: Math.round(o.durationMs),
    })),
  };
}
