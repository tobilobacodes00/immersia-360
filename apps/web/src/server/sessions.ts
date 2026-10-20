import 'server-only';
import { after } from 'next/server';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { db, schema, type Transaction } from '@immersia/db';
import {
  filenamePrefix,
  newShortCode,
  sessionUrl,
  type RegisterSessionInput,
  type RegisterSessionResult,
} from '@immersia/shared';
import type { Locale } from '@immersia/i18n';
import type { DeviceRow } from './devices';
import { enqueueCloudCopies, processCloudCopies } from './cloud/copy';
import { sendGuestLinkEmail } from './email';
import { appOrigin } from './env';
import { uploadGate } from './erasure-core';
import { refreshSessionItem } from './live';
import { allow } from './rate-limit';
import { objectKey, objectSize, presignUpload } from './storage';

const { event, captureSession, output, shortCodeReservation, take } = schema;

/** A device holds at most this many unused codes per event. */
export const CODE_POOL_MAX = 300;

/**
 * DL-2: reserve short codes for a device to hand out offline. The code is the primary key, so a
 * collision is just a failed insert that we retry with a fresh code — no check-then-insert race.
 */
export async function reserveCodes(device: DeviceRow, eventId: string, wanted: number): Promise<string[] | null> {
  const [ev] = await db()
    .select({ id: event.id })
    .from(event)
    .where(and(eq(event.id, eventId), eq(event.organizationId, device.organizationId)))
    .limit(1);
  if (!ev) return null;
  const [{ held } = { held: 0 }] = await db()
    .select({ held: sql<number>`count(*)`.mapWith(Number) })
    .from(shortCodeReservation)
    .where(
      and(
        eq(shortCodeReservation.deviceId, device.id),
        eq(shortCodeReservation.eventId, eventId),
        isNull(shortCodeReservation.usedAt),
      ),
    );
  const count = Math.max(0, Math.min(wanted, CODE_POOL_MAX - held));
  const codes: string[] = [];
  for (let attempts = 0; codes.length < count && attempts < count * 3 + 10; attempts++) {
    const batch = Array.from({ length: count - codes.length }, newShortCode);
    const inserted = await db()
      .insert(shortCodeReservation)
      .values(batch.map((code) => ({ code, eventId, deviceId: device.id })))
      .onConflictDoNothing()
      .returning({ code: shortCodeReservation.code });
    codes.push(...inserted.map((r) => r.code));
  }
  return codes;
}

/** A fresh code for a session registered without one (its device's pool ran dry offline). */
async function assignCode(tx: Transaction, device: DeviceRow, eventId: string) {
  for (let i = 0; i < 20; i++) {
    const [row] = await tx
      .insert(shortCodeReservation)
      .values({ code: newShortCode(), eventId, deviceId: device.id, usedAt: new Date() })
      .onConflictDoNothing()
      .returning({ code: shortCodeReservation.code });
    if (row) return row.code;
  }
  throw new Error('could not allocate a short code');
}

const EXT: Record<string, string> = {
  'video/mp4': 'mp4',
  'image/gif': 'gif',
  'image/jpeg': 'jpg',
  'image/png': 'png',
};

/**
 * Register a capture session and its outputs (idempotent: every insert is keyed by an id the device
 * minted, so a retried request after a lost response changes nothing), then return upload URLs for
 * the outputs not yet stored.
 */
export async function registerSession(
  device: DeviceRow,
  input: RegisterSessionInput,
): Promise<RegisterSessionResult | { error: 'not_found' | 'conflict' | 'erased' }> {
  const result = await db().transaction(async (tx) => {
    const [ev] = await tx
      .select()
      .from(event)
      .where(and(eq(event.id, input.eventId), eq(event.organizationId, device.organizationId)))
      .limit(1);
    if (!ev) return { ok: false as const, error: 'not_found' as const };

    const [existing] = await tx.select().from(captureSession).where(eq(captureSession.id, input.id)).limit(1);
    let session = existing;
    if (existing && (existing.linkId !== input.linkId || existing.eventId !== input.eventId))
      return { ok: false as const, error: 'conflict' as const };
    // The guest deleted this session (privacy): a booth that still holds it must not bring it back.
    if (existing && uploadGate(existing) === 'erased') return { ok: false as const, error: 'erased' as const };
    if (!existing) {
      let code = input.shortCode;
      if (code) {
        // Only a code this device reserved for this event, and not yet used, is accepted.
        const claimed = await tx
          .update(shortCodeReservation)
          .set({ usedAt: new Date() })
          .where(
            and(
              eq(shortCodeReservation.code, code),
              eq(shortCodeReservation.deviceId, device.id),
              eq(shortCodeReservation.eventId, input.eventId),
              isNull(shortCodeReservation.usedAt),
            ),
          )
          .returning({ code: shortCodeReservation.code });
        if (!claimed.length) code = null;
      }
      code ??= await assignCode(tx, device, input.eventId);
      let prefix = '';
      if (ev.filenamePrefixEnabled) {
        const [seq] = await tx
          .update(event)
          .set({ filenameSequence: sql`${event.filenameSequence} + 1` })
          .where(eq(event.id, ev.id))
          .returning({ n: event.filenameSequence });
        prefix = filenamePrefix(true, (seq?.n ?? 2) - 1);
      }
      // Device clocks can be wrong: a capture time in the future is clamped, and retention counts
      // from when the server received the session, so a booth set to the wrong year can't publish
      // sessions that are already expired (or keep files longer than the event allows).
      const now = Date.now();
      const capturedAt = new Date(Math.min(Date.parse(input.capturedAt), now));
      [session] = await tx
        .insert(captureSession)
        .values({
          id: input.id,
          eventId: input.eventId,
          deviceId: device.id,
          linkId: input.linkId,
          shortCode: code,
          filenamePrefix: prefix,
          optedOutOfDisplay: input.optedOutOfDisplay,
          capturedAt,
          expiresAt: new Date(now + ev.expiryDays * 86_400_000),
        })
        .returning();
    }
    if (input.takes.length) {
      // Outputs reference takes (FK): register them first, idempotently, scoped to this event.
      await tx
        .insert(take)
        .values(
          input.takes.map((tk) => ({
            id: tk.id,
            eventId: input.eventId,
            deviceId: device.id,
            capturedAt: new Date(tk.capturedAt),
            durationMs: tk.durationMs,
            fps: tk.fps,
            width: tk.width,
            height: tk.height,
            trigger: tk.trigger,
          })),
        )
        .onConflictDoNothing();
      const owned = await tx
        .select({ id: take.id })
        .from(take)
        .where(
          and(
            inArray(
              take.id,
              input.takes.map((tk) => tk.id),
            ),
            eq(take.eventId, input.eventId),
          ),
        );
      // A take id already used by another event is a client bug or a forgery: refuse the session.
      if (owned.length !== input.takes.length) return { ok: false as const, error: 'conflict' as const };
    }
    if (input.outputs.length) {
      await tx
        .insert(output)
        .values(
          input.outputs.map((o) => ({
            id: o.id,
            sessionId: input.id,
            takeId: o.takeId,
            kind: o.kind,
            mime: o.mime,
            bytes: o.bytes,
            width: o.width,
            height: o.height,
            durationMs: o.durationMs,
            objectKey: objectKey(device.organizationId, input.eventId, o.id, EXT[o.mime] ?? 'bin'),
          })),
        )
        .onConflictDoNothing();
    }
    const pending = await tx
      .select({
        id: output.id,
        kind: output.kind,
        takeId: output.takeId,
        key: output.objectKey,
        mime: output.mime,
        bytes: output.bytes,
      })
      .from(output)
      .where(and(eq(output.sessionId, input.id), isNull(output.uploadedAt)));
    return { ok: true as const, session: session!, pending };
  });
  if (!result.ok) return { error: result.error };
  const uploads = await Promise.all(
    result.pending.map(async (p) => ({
      outputId: p.id,
      kind: p.kind,
      takeId: p.takeId,
      ...(await presignUpload(p.key!, p.mime, p.bytes ?? 0)),
    })),
  );
  return { shortCode: result.session.shortCode, filenamePrefix: result.session.filenamePrefix, uploads };
}

/**
 * Mark an output uploaded once the object really exists at the expected size. Refused for an erased
 * session (the guest deleted it): the file just uploaded is removed again by the erasure sweep.
 */
export async function completeUpload(
  device: DeviceRow,
  outputId: string,
): Promise<'ok' | 'not_found' | 'incomplete' | 'erased'> {
  const [row] = await db()
    .select({
      id: output.id,
      key: output.objectKey,
      bytes: output.bytes,
      sessionId: output.sessionId,
      erasedAt: captureSession.erasedAt,
    })
    .from(output)
    .innerJoin(captureSession, eq(captureSession.id, output.sessionId))
    .innerJoin(event, eq(event.id, captureSession.eventId))
    .where(and(eq(output.id, outputId), eq(event.organizationId, device.organizationId)))
    .limit(1);
  if (!row?.key) return 'not_found';
  if (uploadGate(row) === 'erased') return 'erased';
  const size = await objectSize(row.key);
  if (size === null || (row.bytes !== null && size !== row.bytes)) return 'incomplete';
  await db().transaction(async (tx) => {
    await tx.update(output).set({ uploadedAt: new Date() }).where(eq(output.id, outputId));
    await tx
      .update(captureSession)
      .set({ status: 'live' })
      .where(and(eq(captureSession.id, row.sessionId), eq(captureSession.status, 'pending')));
  });
  // LIV-2: the session may be ready for the Live Display now. After the response, so the booth's
  // upload queue moves on at once.
  after(() => refreshSessionItem(row.sessionId, appOrigin()));
  // SHR-7: when the event copies to the operator's own cloud, queue this file and start copying. Also
  // after the response, and from the cron sweep as well, so a failure here only delays the copy.
  after(() =>
    enqueueCloudCopies(outputId)
      .then(() => processCloudCopies(5))
      .catch((err: unknown) => console.error('[cloud-copy] could not start', err instanceof Error ? err.name : err)),
  );
  return 'ok';
}

/**
 * SHR-2: email a guest their session link. The address is used for this send and not stored
 * (storing guest contacts needs the consent of the guest form, SHR-6).
 */
export async function emailSessionLink(
  device: DeviceRow,
  sessionId: string,
  to: string,
  locale: Locale,
): Promise<'sent' | 'not_found' | 'too_many' | 'erased'> {
  const [row] = await db()
    .select({
      linkId: captureSession.linkId,
      expiresAt: captureSession.expiresAt,
      erasedAt: captureSession.erasedAt,
      eventName: event.name,
    })
    .from(captureSession)
    .innerJoin(event, eq(event.id, captureSession.eventId))
    .where(and(eq(captureSession.id, sessionId), eq(event.organizationId, device.organizationId)))
    .limit(1);
  if (!row) return 'not_found';
  // No link to a page that says "deleted at your request".
  if (uploadGate(row) === 'erased') return 'erased';
  if (!(await allow('emailPerSession', sessionId)) || !(await allow('emailPerDevice', device.id))) return 'too_many';
  await sendGuestLinkEmail(to, sessionUrl(appOrigin(), row.linkId, 'message'), locale, {
    event: row.eventName,
    expiresAt: row.expiresAt,
  });
  return 'sent';
}
