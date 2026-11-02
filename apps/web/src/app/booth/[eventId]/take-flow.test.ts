import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NativeTakeRecorder, readNativeFile, type HighSpeedPlugin, type TakeCapture } from '@immersia/capture';
import {
  BoothDB,
  createIdbTakeStore,
  recoverNativeTakes,
  takesForEvent,
  type NativeRecordings,
  type TakeStore,
} from '@immersia/offline';
import { abandonTake, chunkWriter, finishTake, openTake } from './take-flow';

let db: BoothDB;
let store: TakeStore;
let n = 0;

beforeEach(async () => {
  db = new BoothDB(`take-flow-${++n}`);
  await db.open();
  store = createIdbTakeStore(db);
});

const TAKE = 'take-1';
const PATH = `takes/evt-1/${TAKE}.mov`;
const NATIVE_PATH = `file:///data/${TAKE}.hfr`;
/** The movie the native camera wrote, as it reaches the web layer: three slices. */
const SLICES = [
  [1, 2, 3, 4],
  [5, 6, 7, 8],
  [9, 10],
];
const FILE = SLICES.flat();

const row = {
  id: TAKE,
  eventId: 'evt-1',
  deviceId: 'dev-1',
  path: PATH,
  mimeType: 'video/quicktime',
  trigger: 'tap' as const,
  width: 1920,
  height: 1080,
  // A native take: 240 frames a second, which the render's slow motion uses in full (CAP-13).
  fps: 240,
};

/** The native camera, mocked: what it was asked to start, stop and delete. */
function nativeCamera() {
  const deleted: string[] = [];
  const bridge = {
    startRecording: vi.fn(async (o: { id: string }) => ({ id: o.id })),
    stopRecording: vi.fn(async () => ({
      id: TAKE,
      path: NATIVE_PATH,
      mime: 'video/quicktime',
      bytes: FILE.length,
      durationMs: 8000,
      width: 1920,
      height: 1080,
      fps: 240,
      codec: 'h264' as const,
      interrupted: false,
    })),
    deleteRecording: vi.fn(async (o: { id: string }) => {
      deleted.push(o.id);
    }),
  };
  return { bridge: bridge as unknown as HighSpeedPlugin, mocks: bridge, deleted };
}

/** Capacitor's file URL, mocked: the file as a streamed body. */
const readFile = (path: string) => {
  expect(path).toBe(NATIVE_PATH);
  const fetchImpl = (async () =>
    new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          for (const slice of SLICES) controller.enqueue(Uint8Array.from(slice));
          controller.close();
        },
      }),
    )) as typeof fetch;
  return readNativeFile('x', { sliceBytes: 4, fetchImpl });
};

const stored = async () => Array.from(new Uint8Array(await (await store.read(PATH, 'video/quicktime')).arrayBuffer()));

describe('a native take on its way to the take store (CAP-14)', () => {
  it('lands in the same store and take table as a browser take, ready for the render queue', async () => {
    const cam = nativeCamera();
    const flow = { db, store };
    await openTake(flow, row);
    expect(await db.takes.get(TAKE)).toMatchObject({ status: 'recording', fps: 240, mimeType: 'video/quicktime' });

    // Typed as the booth sees it: `onChunk` reads the recorder's clock, so `rec` refers to itself.
    const rec: TakeCapture = new NativeTakeRecorder(cam, {
      takeId: TAKE,
      onChunk: chunkWriter(flow, { id: TAKE, path: PATH }, () => rec.elapsedMs),
      readFile,
    });
    await rec.start();
    expect(cam.mocks.startRecording).toHaveBeenCalledWith({ id: TAKE });
    expect(await finishTake(flow, { id: TAKE }, rec)).toEqual({ ok: true });

    expect(await stored()).toEqual(FILE);
    expect(await db.takes.get(TAKE)).toMatchObject({
      status: 'recorded',
      bytes: FILE.length,
      chunks: 3,
      durationMs: 8000,
      fps: 240,
      width: 1920,
      height: 1080,
    });
    // The render queue's view of the event: a renderable take like any other.
    expect((await takesForEvent(db, 'evt-1')).map((t) => [t.id, t.status])).toEqual([[TAKE, 'recorded']]);
    // The native copy is let go once the bytes are in the store.
    expect(cam.deleted).toEqual([TAKE]);
  });

  it('does not keep a half-copied native take, and the next start brings the whole file home', async () => {
    const cam = nativeCamera();
    const flow = { db, store };
    await openTake(flow, row);
    // The store takes the first slice, then fails (a full disk).
    const write = chunkWriter(flow, { id: TAKE, path: PATH }, () => 0);
    let slices = 0;
    const rec = new NativeTakeRecorder(cam, {
      takeId: TAKE,
      onChunk: async (chunk) => {
        if (++slices === 2) throw new Error('disk full');
        await write(chunk);
      },
      readFile,
    });
    await rec.start();

    const closed = await finishTake(flow, { id: TAKE }, rec);
    expect(closed).toMatchObject({ ok: false });
    expect(await db.takes.get(TAKE)).toMatchObject({ status: 'failed' });
    // Nothing is deleted from the camera: it is the only whole copy.
    expect(cam.deleted).toEqual([]);

    const native: NativeRecordings = {
      listRecordings: async () => ({
        recordings: [{ id: TAKE, path: NATIVE_PATH, bytes: FILE.length, modifiedMs: 9000 }],
      }),
      deleteRecording: cam.bridge.deleteRecording.bind(cam.bridge),
    };
    const recovered = await recoverNativeTakes({ db, store, native, readFile });
    expect(recovered).toEqual({ recovered: 1, discarded: 0, failed: 0 });
    expect(await stored()).toEqual(FILE);
    expect(await db.takes.get(TAKE)).toMatchObject({ status: 'interrupted', bytes: FILE.length });
    expect(cam.deleted).toEqual([TAKE]);
  });

  it('takes a native take back out when the camera will not start recording', async () => {
    const flow = { db, store };
    await openTake(flow, row);
    await store.append(PATH, new Blob([Uint8Array.from([1])]));
    await abandonTake(flow, { id: TAKE, path: PATH }, new Error('almost out of storage'));
    expect((await db.takes.get(TAKE))?.status).toBe('failed');
    expect((await store.read(PATH, 'video/quicktime')).size).toBe(0);
  });
});

describe('a browser take that fails to close (unchanged behaviour)', () => {
  /** A recorder that wrote `chunks` chunks and then fails to finish. */
  async function failingBrowserTake(chunks: number) {
    const flow = { db, store };
    await openTake(flow, { ...row, mimeType: 'video/webm', fps: 60, path: 'takes/evt-1/w.webm', id: 'w' });
    const write = chunkWriter(flow, { id: 'w', path: 'takes/evt-1/w.webm' }, () => 1500);
    for (let i = 0; i < chunks; i++) await write(new Blob([Uint8Array.from([i])]));
    const rec: TakeCapture = {
      elapsedMs: 1500,
      start: () => undefined,
      stop: async () => {
        throw new Error('write failed');
      },
    };
    return finishTake(flow, { id: 'w' }, rec);
  }

  it('keeps what it recorded up to the failure', async () => {
    expect(await failingBrowserTake(2)).toMatchObject({ ok: false });
    expect(await db.takes.get('w')).toMatchObject({ status: 'recorded', chunks: 2, durationMs: 1500 });
  });

  it('fails a take that recorded nothing', async () => {
    expect(await failingBrowserTake(0)).toMatchObject({ ok: false });
    expect((await db.takes.get('w'))?.status).toBe('failed');
  });
});

describe('chunkWriter', () => {
  it('appends in order and notes the progress after each chunk', async () => {
    const flow = { db, store };
    await openTake(flow, row);
    const write = chunkWriter(flow, { id: TAKE, path: PATH }, () => 1234);
    await write(new Blob([Uint8Array.from([1, 2])]));
    await write(new Blob([Uint8Array.from([3])]));
    expect(await stored()).toEqual([1, 2, 3]);
    expect(await db.takes.get(TAKE)).toMatchObject({ bytes: 3, chunks: 2, durationMs: 1234 });
  });
});
