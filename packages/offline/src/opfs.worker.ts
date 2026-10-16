/// <reference lib="webworker" />
/**
 * OPFS writer. Sync access handles (worker-only) give durable, in-place appends on Chrome, Safari
 * 15.2+ and Firefox 111+: each append is written at the end of the file and flushed before we
 * acknowledge it, so an acknowledged chunk survives a crash or reload.
 */

// A module, not a script: keeps these names out of the global scope.
export {};

declare const self: DedicatedWorkerGlobalScope;

type WorkerRequest =
  | { id: number; op: 'probe' }
  | { id: number; op: 'open'; path: string }
  | { id: number; op: 'append'; path: string; data: ArrayBuffer }
  | { id: number; op: 'close'; path: string }
  | { id: number; op: 'remove'; path: string };

const handles = new Map<string, FileSystemSyncAccessHandle>();

async function fileHandle(path: string, create: boolean): Promise<FileSystemFileHandle> {
  const parts = path.split('/').filter(Boolean);
  const name = parts.pop();
  if (!name) throw new Error(`bad path: ${path}`);
  let dir = await navigator.storage.getDirectory();
  for (const p of parts) dir = await dir.getDirectoryHandle(p, { create });
  return dir.getFileHandle(name, { create });
}

async function handleFor(path: string): Promise<FileSystemSyncAccessHandle> {
  let h = handles.get(path);
  if (!h) {
    const fh = await fileHandle(path, true);
    h = await fh.createSyncAccessHandle();
    handles.set(path, h);
  }
  return h;
}

async function run(req: WorkerRequest): Promise<unknown> {
  switch (req.op) {
    case 'probe': {
      // Prove the full path works here (some browsers expose OPFS but not sync handles).
      const h = await handleFor('.probe');
      h.write(new Uint8Array([1]), { at: 0 });
      h.flush();
      h.close();
      handles.delete('.probe');
      const root = await navigator.storage.getDirectory();
      await root.removeEntry('.probe');
      return true;
    }
    case 'open': {
      const h = await handleFor(req.path);
      h.truncate(0);
      h.flush();
      return 0;
    }
    case 'append': {
      const h = await handleFor(req.path);
      const at = h.getSize();
      const written = h.write(new Uint8Array(req.data), { at });
      if (written !== req.data.byteLength) throw new Error(`short write: ${written}/${req.data.byteLength}`);
      h.flush();
      return at + written;
    }
    case 'close': {
      const h = handles.get(req.path);
      if (h) {
        h.flush();
        h.close();
        handles.delete(req.path);
      }
      return true;
    }
    case 'remove': {
      handles.get(req.path)?.close();
      handles.delete(req.path);
      const parts = req.path.split('/').filter(Boolean);
      const name = parts.pop()!;
      let dir = await navigator.storage.getDirectory();
      for (const p of parts) dir = await dir.getDirectoryHandle(p);
      await dir.removeEntry(name);
      return true;
    }
  }
}

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const req = e.data;
  try {
    self.postMessage({ id: req.id, ok: true, result: await run(req) });
  } catch (err) {
    self.postMessage({
      id: req.id,
      ok: false,
      error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
    });
  }
};
