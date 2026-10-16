import { boothDb, type BoothDB } from './db';

/**
 * Durable storage for raw takes (NFR Reliability: "every raw take is written to on-device storage
 * before any processing"). Two backends behind one API:
 *   - 'opfs': a worker appends each chunk with a sync access handle and flushes before acking.
 *   - 'idb':  each chunk is its own IndexedDB record (when OPFS sync handles are unavailable).
 * Either way, a chunk the recorder was told is saved survives a crash, reload or power cut.
 */
export interface TakeStore {
  readonly backend: 'opfs' | 'idb';
  begin(path: string): Promise<void>;
  append(path: string, chunk: Blob): Promise<void>;
  finish(path: string): Promise<void>;
  read(path: string, mimeType: string): Promise<Blob>;
  remove(path: string): Promise<void>;
}

type WorkerReply = { id: number; ok: true; result: unknown } | { id: number; ok: false; error: string };

class OpfsTakeStore implements TakeStore {
  readonly backend = 'opfs' as const;
  private seq = 0;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

  constructor(private worker: Worker) {
    worker.onmessage = (e: MessageEvent<WorkerReply>) => {
      const p = this.pending.get(e.data.id);
      if (!p) return;
      this.pending.delete(e.data.id);
      if (e.data.ok) p.resolve(e.data.result);
      else p.reject(new Error(e.data.error));
    };
    worker.onerror = (e) => {
      for (const p of this.pending.values()) p.reject(new Error(e.message || 'OPFS worker crashed'));
      this.pending.clear();
    };
  }

  call(msg: Record<string, unknown>, transfer: Transferable[] = []): Promise<unknown> {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ ...msg, id }, transfer);
    });
  }

  async begin(path: string) {
    await this.call({ op: 'open', path });
  }

  async append(path: string, chunk: Blob) {
    const data = await chunk.arrayBuffer();
    await this.call({ op: 'append', path, data }, [data]);
  }

  async finish(path: string) {
    await this.call({ op: 'close', path });
  }

  async read(path: string, mimeType: string): Promise<Blob> {
    const parts = path.split('/').filter(Boolean);
    const name = parts.pop()!;
    let dir = await navigator.storage.getDirectory();
    for (const p of parts) dir = await dir.getDirectoryHandle(p);
    const file = await (await dir.getFileHandle(name)).getFile();
    // Re-type: OPFS files have no MIME type of their own.
    return file.type === mimeType ? file : new Blob([file], { type: mimeType });
  }

  async remove(path: string) {
    await this.call({ op: 'remove', path });
  }
}

class IdbTakeStore implements TakeStore {
  readonly backend = 'idb' as const;
  private next = new Map<string, number>();

  constructor(private db: BoothDB) {}

  async begin(path: string) {
    await this.db.chunks.where('path').equals(path).delete();
    this.next.set(path, 0);
  }

  async append(path: string, chunk: Blob) {
    const index = this.next.get(path) ?? (await this.db.chunks.where('path').equals(path).count());
    await this.db.chunks.put({ key: `${path}#${index}`, path, index, data: chunk });
    this.next.set(path, index + 1);
  }

  async finish(path: string) {
    this.next.delete(path);
  }

  async read(path: string, mimeType: string): Promise<Blob> {
    const rows = await this.db.chunks.where('path').equals(path).toArray();
    rows.sort((a, b) => a.index - b.index);
    return new Blob(
      rows.map((r) => r.data),
      { type: mimeType },
    );
  }

  async remove(path: string) {
    await this.db.chunks.where('path').equals(path).delete();
    this.next.delete(path);
  }
}

let store: Promise<TakeStore> | undefined;

/**
 * The take store for this browser. Probes OPFS sync access in the worker once; falls back to
 * IndexedDB when it's missing or broken (Firefox private windows, old Safari, blocked storage).
 */
export function takeStore(createWorker: () => Worker): Promise<TakeStore> {
  store ??= (async () => {
    if (
      typeof navigator !== 'undefined' &&
      typeof navigator.storage?.getDirectory === 'function' &&
      typeof Worker !== 'undefined'
    ) {
      try {
        const opfs = new OpfsTakeStore(createWorker());
        await Promise.race([
          opfs.call({ op: 'probe' }),
          new Promise((_, reject) => setTimeout(() => reject(new Error('OPFS probe timed out')), 4000)),
        ]);
        return opfs;
      } catch (err) {
        console.warn('[take-store] OPFS unavailable, using IndexedDB', err);
      }
    }
    return new IdbTakeStore(boothDb());
  })();
  return store;
}

/** For tests and diagnostics. */
export function createIdbTakeStore(db: BoothDB): TakeStore {
  return new IdbTakeStore(db);
}
