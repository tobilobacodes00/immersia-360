import { uuidv7 } from '@immersia/shared';
import type { BoothDB, LocalOutput } from './db';
import type { TakeStore } from './take-store';

const SLICE = 8 * 1024 * 1024;

export const extensionForMime = (mime: string) =>
  mime.includes('mp4')
    ? 'mp4'
    : mime.includes('gif')
      ? 'gif'
      : mime.includes('jpeg')
        ? 'jpg'
        : mime.includes('png')
          ? 'png'
          : 'webm';

/**
 * Persist a rendered output on the device before anything else happens with it (upload, QR): the
 * guest's file must survive a reload or a dead network exactly like the raw take does.
 */
export async function putOutput(
  db: BoothDB,
  store: TakeStore,
  o: Omit<LocalOutput, 'id' | 'path' | 'mime' | 'bytes' | 'createdAt'> & { blob: Blob },
): Promise<string> {
  const id = uuidv7();
  const mime = o.blob.type || 'video/mp4';
  const path = `outputs/${o.eventId}/${id}.${extensionForMime(mime)}`;
  await store.begin(path);
  for (let at = 0; at < o.blob.size; at += SLICE) await store.append(path, o.blob.slice(at, at + SLICE));
  await store.finish(path);
  const { blob: _blob, ...rest } = o;
  await db.outputs.put({ ...rest, id, path, mime, bytes: o.blob.size, createdAt: Date.now() });
  return id;
}

export function outputsForTake(db: BoothDB, takeId: string) {
  return db.outputs.where('takeId').equals(takeId).toArray();
}

export async function readOutput(db: BoothDB, store: TakeStore, id: string): Promise<Blob | null> {
  const o = await db.outputs.get(id);
  return o ? store.read(o.path, o.mime) : null;
}

/** Delete a take and everything rendered from it (render queue "delete"). */
export async function deleteTakeAndOutputs(db: BoothDB, store: TakeStore, takeId: string) {
  const take = await db.takes.get(takeId);
  const outputs = await outputsForTake(db, takeId);
  for (const o of outputs) await store.remove(o.path).catch(() => undefined);
  if (take) await store.remove(take.path).catch(() => undefined);
  await db.transaction('rw', db.takes, db.outputs, async () => {
    await db.outputs.where('takeId').equals(takeId).delete();
    await db.takes.delete(takeId);
  });
}
