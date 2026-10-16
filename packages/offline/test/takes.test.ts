import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { BoothDB } from '../src/db';
import { createIdbTakeStore } from '../src/take-store';
import { beginTake, completeTake, importTake, noteChunk, recoverInterrupted, takesForEvent } from '../src/takes';

let db: BoothDB;
let n = 0;

beforeEach(async () => {
  db = new BoothDB(`test-${++n}`);
  await db.open();
});

const base = {
  eventId: 'evt-1',
  deviceId: 'dev-1',
  mimeType: 'video/mp4',
  trigger: 'tap' as const,
  width: 1920,
  height: 1080,
  fps: 60,
};

describe('take lifecycle', () => {
  it('records progress per chunk and completes', async () => {
    await beginTake(db, { ...base, id: 't1', path: 'takes/evt-1/t1.mp4' });
    await noteChunk(db, 't1', 1000, 1000);
    await noteChunk(db, 't1', 1500, 2000);
    await completeTake(db, 't1', 2100);
    const t = await db.takes.get('t1');
    expect(t).toMatchObject({ status: 'recorded', bytes: 2500, chunks: 2, durationMs: 2100 });
  });

  it('recovers a take cut short by a crash, and fails an empty one', async () => {
    await beginTake(db, { ...base, id: 'with-data', path: 'a' });
    await noteChunk(db, 'with-data', 500, 1000);
    await beginTake(db, { ...base, id: 'empty', path: 'b' });
    const recovered = await recoverInterrupted(db);
    expect(recovered.map((t) => t.id)).toEqual(['with-data']);
    expect((await db.takes.get('with-data'))?.status).toBe('interrupted');
    expect((await db.takes.get('with-data'))?.recoveredAt).toBeTypeOf('number');
    expect((await db.takes.get('empty'))?.status).toBe('failed');
  });

  it('leaves finished takes alone on recovery', async () => {
    await beginTake(db, { ...base, id: 'done', path: 'c' });
    await noteChunk(db, 'done', 10, 10);
    await completeTake(db, 'done', 10);
    expect(await recoverInterrupted(db)).toEqual([]);
    expect((await db.takes.get('done'))?.status).toBe('recorded');
  });

  it('imports a file as a take (CAP-12) and lists newest first', async () => {
    await beginTake(db, { ...base, id: 'old', path: 'x' });
    await new Promise((r) => setTimeout(r, 5));
    await importTake(db, { ...base, id: 'imp', path: 'y', bytes: 42, durationMs: 3000 });
    const list = await takesForEvent(db, 'evt-1');
    expect(list.map((t) => t.id)).toEqual(['imp', 'old']);
    expect(list[0]).toMatchObject({ status: 'imported', trigger: 'import' });
  });
});

describe('IndexedDB take store (OPFS fallback)', () => {
  it('reassembles chunks in order', async () => {
    const store = createIdbTakeStore(db);
    await store.begin('takes/t.webm');
    for (const part of ['a', 'b', 'c']) await store.append('takes/t.webm', new Blob([part]));
    await store.finish('takes/t.webm');
    const blob = await store.read('takes/t.webm', 'video/webm');
    expect(blob.type).toBe('video/webm');
    expect(await blob.text()).toBe('abc');
  });

  it('continues numbering after a reload mid-take', async () => {
    const first = createIdbTakeStore(db);
    await first.begin('p');
    await first.append('p', new Blob(['1']));
    // A fresh store instance (page reload) appends after what is already there.
    const second = createIdbTakeStore(db);
    await second.append('p', new Blob(['2']));
    expect(await (await second.read('p', 'video/mp4')).text()).toBe('12');
  });

  it('begin() truncates and remove() deletes', async () => {
    const store = createIdbTakeStore(db);
    await store.begin('q');
    await store.append('q', new Blob(['old']));
    await store.begin('q');
    await store.append('q', new Blob(['new']));
    expect(await (await store.read('q', 'video/mp4')).text()).toBe('new');
    await store.remove('q');
    expect((await store.read('q', 'video/mp4')).size).toBe(0);
  });
});
