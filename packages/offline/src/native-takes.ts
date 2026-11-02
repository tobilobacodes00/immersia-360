import type { BoothDB, LocalTake } from './db';
import type { TakeStore } from './take-store';

/**
 * Takes recorded by the companion app's native camera (CAP-14) are movie files the app writes before the
 * web layer copies them into the take store. A crash (or a reload) between the two leaves the file behind;
 * this brings it home, so no clip is ever lost. The native side is passed in as a structural interface: this
 * package knows nothing of Capacitor.
 */
export interface NativeRecordings {
  listRecordings(): Promise<{ recordings: { id: string; path: string; bytes: number; modifiedMs: number }[] }>;
  deleteRecording(options: { id: string }): Promise<void>;
}

export interface NativeRecoveryResult {
  /** Files copied into the take store again (the first copy was cut short). */
  recovered: number;
  /** Files whose take was already complete: only the leftover native copy was deleted. */
  discarded: number;
  /** Files that could not be brought home; they stay where they are, to be tried again. */
  failed: number;
}

/** A take in one of these states has no usable bytes of its own: the native file is all there is of it. */
const STATUSES_WITH_NO_DATA: LocalTake['status'][] = ['recording', 'failed'];

/**
 * For every movie the native camera still holds:
 *  - its take is complete in the store (same byte count): delete the native copy;
 *  - otherwise copy the whole file into the store again (`begin` starts the file over) and keep the take as an
 *    `interrupted`, renderable one, as `recoverInterrupted` does for takes cut short in the browser.
 * A file nothing in the database knows about is left alone: there is no event to put it in.
 *
 * Call it after `recoverInterrupted` (which has already turned a cut-short take into `interrupted` or `failed`).
 */
export async function recoverNativeTakes({
  db,
  store,
  native,
  readFile,
}: {
  db: BoothDB;
  store: TakeStore;
  native: NativeRecordings;
  /** The file's bytes in order, in blobs of any size (Capacitor's file URL, in the booth). */
  readFile: (path: string) => AsyncIterable<Blob>;
}): Promise<NativeRecoveryResult> {
  const result: NativeRecoveryResult = { recovered: 0, discarded: 0, failed: 0 };
  const { recordings } = await native.listRecordings();
  for (const recording of recordings) {
    const take = await db.takes.get(recording.id);
    if (!take) continue;
    const complete = take.bytes === recording.bytes && !STATUSES_WITH_NO_DATA.includes(take.status);
    if (complete) {
      await native.deleteRecording({ id: recording.id });
      result.discarded++;
      continue;
    }
    try {
      await store.begin(take.path);
      let bytes = 0;
      let chunks = 0;
      for await (const chunk of readFile(recording.path)) {
        await store.append(take.path, chunk);
        bytes += chunk.size;
        chunks++;
      }
      await store.finish(take.path);
      if (bytes !== recording.bytes) throw new Error(`read ${bytes} of ${recording.bytes} bytes`);
      const now = Date.now();
      await db.takes.update(take.id, {
        status: 'interrupted',
        bytes,
        chunks,
        // The take row was written when recording started, and the file last changed when it ended.
        durationMs: take.durationMs > 0 ? take.durationMs : Math.max(0, recording.modifiedMs - take.capturedAt),
        recoveredAt: now,
        updatedAt: now,
        // The failure the browser recorded for a take it found empty no longer applies.
        error: undefined,
      });
      await native.deleteRecording({ id: recording.id });
      result.recovered++;
    } catch (err) {
      console.warn('[native-takes] could not recover', recording.id, err);
      result.failed++;
    }
  }
  return result;
}
