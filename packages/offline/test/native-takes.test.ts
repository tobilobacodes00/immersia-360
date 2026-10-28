import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BoothDB } from '../src/db';
import { recoverNativeTakes, type NativeRecordings } from '../src/native-takes';
import { createIdbTakeStore, type TakeStore } from '../src/take-store';
import { beginTake, completeTake, noteChunk, recoverInterrupted } from '../src/takes';

let db: BoothDB;
let store: TakeStore;
let n = 0;

beforeEach(async () => {
  db = new BoothDB(`native-${++n}`);
  await db.open();
  store = createIdbTakeStore(db);
});

const base = {
  eventId: 'evt-1',
  deviceId: 'dev-1',
  mimeType: 'video/quicktime',
  trigger: 'tap' as const,
  width: 1920,
  height: 1080,
  fps: 240,
};

const BYTES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

/** The native camera still holding `files` (id to bytes); what it is asked to delete is tracked. */
function nativeCamera(files: Record<string, number[]>) {
  const deleted: string[] = [];
  const api: NativeRecordings = {
    listRecordings: async () => ({
      recordings: Object.entries(files).map(([id, bytes]) => ({
        id,
        path: `file:///data/${id}.hfr`,
        bytes: bytes.length,
        modifiedMs: 5_000,
      })),
    }),
    deleteRecording: async ({ id }) => {
      deleted.push(id);
    },
  };
  /** The file's bytes in slices of 4, as the booth reads it through Capacitor's file URL. */
  const readFile = (path: string) => {
    const id = /\/([^/]+)\.hfr$/.exec(path)?.[1] ?? '';
    const bytes = files[id] ?? [];
    return (async function* () {
      for (let at = 0; at < bytes.length; at += 4) yield new Blob([Uint8Array.from(bytes.slice(at, at + 4))]);
    })();
  };
  return { api, readFile, deleted };
}

const stored = async (path: string) =>
  Array.from(new Uint8Array(await (await store.read(path, 'video/quicktime')).arrayBuffer()));

describe('recoverNativeTakes (a crash between the camera and the take store)', () => {
  it('brings home a take whose copy never started, and keeps it renderable', async () => {
    await beginTake(db, { ...base, id: 't1', path: 'takes/evt-1/t1.mov' });
    // The browser found it empty after the crash.
    await recoverInterrupted(db);
    expect((await db.takes.get('t1'))?.status).toBe('failed');

    const cam = nativeCamera({ t1: BYTES });
    const result = await recoverNativeTakes({ db, store, native: cam.api, readFile: cam.readFile });

    expect(result).toEqual({ recovered: 1, discarded: 0, failed: 0 });
    expect(await stored('takes/evt-1/t1.mov')).toEqual(BYTES);
    expect(await db.takes.get('t1')).toMatchObject({ status: 'interrupted', bytes: 10, chunks: 3 });
    expect((await db.takes.get('t1'))?.error).toBeUndefined();
    expect((await db.takes.get('t1'))?.recoveredAt).toBeTypeOf('number');
    // Only now is the native copy let go.
    expect(cam.deleted).toEqual(['t1']);
  });

  it('starts a half-copied take over instead of trusting its partial bytes', async () => {
    await beginTake(db, { ...base, id: 't2', path: 'takes/evt-1/t2.mov' });
    await store.begin('takes/evt-1/t2.mov');
    await store.append('takes/evt-1/t2.mov', new Blob([Uint8Array.from([1, 2, 3, 4])]));
    await noteChunk(db, 't2', 4, 100);
    await recoverInterrupted(db);
    expect((await db.takes.get('t2'))?.status).toBe('interrupted');

    const cam = nativeCamera({ t2: BYTES });
    const result = await recoverNativeTakes({ db, store, native: cam.api, readFile: cam.readFile });

    expect(result.recovered).toBe(1);
    expect(await stored('takes/evt-1/t2.mov')).toEqual(BYTES);
    expect((await db.takes.get('t2'))?.bytes).toBe(10);
  });

  it('only deletes the leftover native copy of a take that arrived whole', async () => {
    await beginTake(db, { ...base, id: 't3', path: 'takes/evt-1/t3.mov' });
    await noteChunk(db, 't3', 10, 8000);
    await completeTake(db, 't3', 8000);

    const read = vi.fn();
    const cam = nativeCamera({ t3: BYTES });
    const result = await recoverNativeTakes({ db, store, native: cam.api, readFile: read });

    expect(result).toEqual({ recovered: 0, discarded: 1, failed: 0 });
    expect(read).not.toHaveBeenCalled();
    expect(cam.deleted).toEqual(['t3']);
    expect((await db.takes.get('t3'))?.status).toBe('recorded');
  });

  it('keeps the native file when it cannot be copied, to try again next time', async () => {
    await beginTake(db, { ...base, id: 't4', path: 'takes/evt-1/t4.mov' });
    await recoverInterrupted(db);
    const cam = nativeCamera({ t4: BYTES });
    const result = await recoverNativeTakes({
      db,
      store,
      native: cam.api,
      readFile: () =>
        (async function* () {
          yield new Blob([Uint8Array.from([1, 2, 3, 4])]);
          throw new Error('file went away');
        })(),
    });
    expect(result).toEqual({ recovered: 0, discarded: 0, failed: 1 });
    expect(cam.deleted).toEqual([]);
    expect((await db.takes.get('t4'))?.status).toBe('failed');
  });

  it('keeps the native file when what it read is not what the camera wrote', async () => {
    await beginTake(db, { ...base, id: 't5', path: 'takes/evt-1/t5.mov' });
    await recoverInterrupted(db);
    const cam = nativeCamera({ t5: BYTES });
    const result = await recoverNativeTakes({
      db,
      store,
      native: cam.api,
      readFile: () =>
        (async function* () {
          yield new Blob([Uint8Array.from([1, 2, 3, 4])]);
        })(),
    });
    expect(result.failed).toBe(1);
    expect(cam.deleted).toEqual([]);
  });

  it('leaves a file no take in the database owns', async () => {
    const cam = nativeCamera({ stranger: BYTES });
    const result = await recoverNativeTakes({ db, store, native: cam.api, readFile: cam.readFile });
    expect(result).toEqual({ recovered: 0, discarded: 0, failed: 0 });
    expect(cam.deleted).toEqual([]);
  });

  it('does nothing when the camera holds nothing', async () => {
    const cam = nativeCamera({});
    expect(await recoverNativeTakes({ db, store, native: cam.api, readFile: cam.readFile })).toEqual({
      recovered: 0,
      discarded: 0,
      failed: 0,
    });
  });
});
