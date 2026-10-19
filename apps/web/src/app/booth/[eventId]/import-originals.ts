import { extensionFor } from '@immersia/capture';
import { importTake, mintSession, type BoothDB, type TakeStore } from '@immersia/offline';
import { uuidv7 } from '@immersia/shared';

/** Stream in 8 MB slices: a 4K import never has to fit in memory at once. */
const SLICE = 8 * 1024 * 1024;

export interface ImportResult {
  imported: number;
  /** Not a video file. */
  skipped: number;
  /** A video this device could not store (full disk, a read error). */
  failed: number;
}

/**
 * CAP-12/13: add video files from disk as takes (including 120/240 fps clips shot on a phone), each
 * with its guest session, so the render queue picks them up. Shared by the settings drawer, drag and
 * drop, and the event gallery: one import path.
 */
export async function importVideoFiles({
  db,
  store,
  eventId,
  deviceId,
  files,
  waitForIdle,
}: {
  db: BoothDB;
  store: TakeStore;
  eventId: string;
  deviceId: string | null;
  files: Iterable<File>;
  /** Resolves when the booth is free to take disk time (not mid-capture); asked before every slice. */
  waitForIdle?: () => Promise<void>;
}): Promise<ImportResult> {
  const result: ImportResult = { imported: 0, skipped: 0, failed: 0 };
  for (const file of files) {
    await waitForIdle?.();
    if (!file.type.startsWith('video/')) {
      result.skipped++;
      continue;
    }
    const id = uuidv7();
    const ext = /\.([a-z0-9]{1,5})$/i.exec(file.name)?.[1]?.toLowerCase() ?? extensionFor(file.type);
    const path = `takes/${eventId}/${id}.${ext}`;
    let recorded = false;
    try {
      const meta = await videoMetadata(file);
      await store.begin(path);
      for (let at = 0; at < file.size; at += SLICE) {
        // The recorder shares the storage worker: a take in progress goes first.
        await waitForIdle?.();
        await store.append(path, file.slice(at, at + SLICE));
      }
      await store.finish(path);
      await importTake(db, {
        id,
        eventId,
        deviceId,
        path,
        mimeType: file.type,
        bytes: file.size,
        durationMs: meta.durationMs,
        width: meta.width,
        height: meta.height,
        fps: 0,
      });
      recorded = true;
      await mintSession(db, { eventId, takeIds: [id], capturedAt: Date.now() });
      result.imported++;
    } catch (err) {
      console.warn('[import]', file.name, err);
      // A half-written file with no take pointing at it would only take up space.
      if (!recorded) await store.remove(path).catch(() => undefined);
      result.failed++;
    }
  }
  return result;
}

function videoMetadata(file: File): Promise<{ durationMs: number; width: number; height: number }> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.muted = true;
    const done = (meta: { durationMs: number; width: number; height: number }) => {
      URL.revokeObjectURL(url);
      resolve(meta);
    };
    v.onloadedmetadata = () =>
      done({
        durationMs: Number.isFinite(v.duration) ? Math.round(v.duration * 1000) : 0,
        width: v.videoWidth,
        height: v.videoHeight,
      });
    v.onerror = () => done({ durationMs: 0, width: 0, height: 0 });
    v.src = url;
  });
}
