import { NativeTakeRecorder, type TakeCapture } from '@immersia/capture';
import {
  beginTake,
  completeTake,
  failTake,
  noteChunk,
  type BoothDB,
  type CaptureTrigger,
  type TakeStore,
} from '@immersia/offline';

/**
 * A take's journey into the take store, whoever records it: a browser MediaRecorder streams chunks as it
 * goes, and the companion's native camera (CAP-14) hands over its finished movie when it stops. Both end the
 * same way, as a take row with its bytes in the store, so the render queue takes them without knowing which.
 */
export interface TakeFlow {
  db: BoothDB;
  store: TakeStore;
}

/** Register the take (before the first byte, so a crash leaves a record) and open its file in the store. */
export async function openTake(
  { db, store }: TakeFlow,
  take: {
    id: string;
    eventId: string;
    deviceId: string;
    path: string;
    mimeType: string;
    trigger: CaptureTrigger;
    width: number;
    height: number;
    /** The rate the camera really records at: 120 or 240 for the native camera. */
    fps: number;
  },
): Promise<void> {
  await beginTake(db, take);
  await store.begin(take.path);
}

/** The recorder's `onChunk`: append the bytes, then note the progress, so a recovered take knows what it has. */
export function chunkWriter(
  { db, store }: TakeFlow,
  take: { id: string; path: string },
  elapsedMs: () => number,
): (chunk: Blob) => Promise<void> {
  return async (chunk) => {
    await store.append(take.path, chunk);
    await noteChunk(db, take.id, chunk.size, elapsedMs());
  };
}

/** A recorder that would not start: take the take back out, as if it had never begun. */
export async function abandonTake({ db, store }: TakeFlow, take: { id: string; path: string }, error: unknown) {
  await store.remove(take.path).catch(() => undefined);
  await failTake(db, take.id, String(error));
}

/**
 * Stop the recorder and close the take. Everything the browser recorded up to a failure is kept as a take of
 * its own, flagged to the operator by the caller; a native take that did not arrive whole is not kept half,
 * because the camera's original is still on the device and the next start copies it in again
 * (`recoverNativeTakes`), so it is marked failed until then.
 */
export async function finishTake(
  { db, store }: TakeFlow,
  take: { id: string },
  rec: TakeCapture,
): Promise<{ ok: true } | { ok: false; error: unknown }> {
  const row = await db.takes.get(take.id);
  try {
    const result = await rec.stop();
    if (row) await store.finish(row.path);
    await completeTake(db, take.id, result.durationMs);
    return { ok: true };
  } catch (error) {
    if (!(rec instanceof NativeTakeRecorder) && row && row.chunks > 0) {
      await completeTake(db, take.id, row.durationMs);
    } else {
      await failTake(db, take.id, String(error));
      // Let go of the half-written file: the recovery starts it over.
      if (row && rec instanceof NativeTakeRecorder) await store.finish(row.path).catch(() => undefined);
    }
    return { ok: false, error };
  }
}
