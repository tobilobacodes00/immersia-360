import { downloadZip } from 'client-zip';
import type { ZipEntryPlan } from './gallery-model';

/** Progress is reported at most this often: a multi-GB export reads thousands of chunks a second. */
const PROGRESS_INTERVAL_MS = 120;

export interface ExportProgress {
  /** Bytes of the archive written so far (a stored ZIP is the files plus a little framing). */
  doneBytes: number;
  /** Bytes of the files to be written. */
  totalBytes: number;
  /** The file being added (1-based) and how many there are. */
  fileIndex: number;
  fileCount: number;
}

export interface ExportResult {
  /** `file`: streamed to a file the operator chose. `download`: built in memory, saved by the browser. */
  via: 'file' | 'download';
  /** Files that could not be read from this device and were left out. */
  missing: number;
}

/** The File System Access API's save dialog (Chromium), which TypeScript's DOM library leaves out. */
export type SaveFilePicker = (options: {
  suggestedName: string;
  types: { description: string; accept: Record<string, string[]> }[];
}) => Promise<{ createWritable(): Promise<WritableStream<Uint8Array>> }>;

/** The save dialog where the browser has one; Safari and Firefox fall back to a Blob download. */
export function saveFilePicker(): SaveFilePicker | null {
  const picker = (window as unknown as { showSaveFilePicker?: SaveFilePicker }).showSaveFilePicker;
  return typeof picker === 'function' ? picker.bind(window) : null;
}

/**
 * Ask where to save, and open that file for writing. Call it straight from the click: the dialog
 * needs the user's gesture, which does not survive a long await.
 */
export async function openSaveDestination(picker: SaveFilePicker, filename: string) {
  const handle = await picker({
    suggestedName: filename,
    types: [{ description: 'ZIP', accept: { 'application/zip': ['.zip'] } }],
  });
  return handle.createWritable();
}

/** The operator closed the save dialog, or the export was cancelled. */
export const isAbort = (err: unknown) => err instanceof DOMException && err.name === 'AbortError';

/** Hand a finished Blob to the browser's downloads. */
export function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.hidden = true;
  document.body.append(a);
  a.click();
  a.remove();
  // Long enough for the browser to have started reading it, even for a big file.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/**
 * Stream the planned files into a ZIP (client-zip: stored, no compression: photos and H.264 don't
 * shrink), reading one file at a time from the device so memory stays flat. With a `destination`
 * (a file the operator picked) the bytes go straight to disk and any size works; without one the
 * archive is collected in memory and saved as a download, which is why the caller warns first.
 *
 * Aborting stops reading and discards the partial file. A file that can't be read (storage was
 * cleared) is left out and counted, rather than losing a long export to one bad entry.
 */
export async function exportZip(opts: {
  entries: readonly ZipEntryPlan[];
  read: (entry: ZipEntryPlan) => Promise<Blob>;
  filename: string;
  destination: WritableStream<Uint8Array> | null;
  signal: AbortSignal;
  onProgress: (progress: ExportProgress) => void;
  /** Resolves when the next file may be read (the booth is not mid-capture); must also resolve on abort. */
  waitForIdle?: () => Promise<void>;
}): Promise<ExportResult> {
  const { entries, read, filename, destination, signal, onProgress, waitForIdle } = opts;
  const totalBytes = entries.reduce((sum, e) => sum + e.bytes, 0);
  let doneBytes = 0;
  let fileIndex = 0;
  let missing = 0;
  let reportedAt = 0;

  const report = (force = false) => {
    const now = performance.now();
    if (!force && now - reportedAt < PROGRESS_INTERVAL_MS) return;
    reportedAt = now;
    onProgress({ doneBytes: Math.min(doneBytes, totalBytes), totalBytes, fileIndex, fileCount: entries.length });
  };

  // The zipper pulls the next file only when it has finished the last, so only one is open at a time.
  async function* files() {
    for (const entry of entries) {
      await waitForIdle?.();
      signal.throwIfAborted();
      fileIndex++;
      let blob: Blob;
      try {
        blob = await read(entry);
      } catch (err) {
        console.warn('[gallery export] unreadable', entry.path, err);
        missing++;
        continue;
      }
      yield { name: entry.path, input: blob, lastModified: entry.lastModified };
    }
  }

  const zip = downloadZip(files()).body;
  if (!zip) {
    await destination?.abort().catch(() => undefined);
    throw new Error('zip_stream_unavailable');
  }
  const counted = zip.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        doneBytes += chunk.byteLength;
        controller.enqueue(chunk);
        report();
      },
    }),
    { signal },
  );

  report(true);
  if (destination) {
    await counted.pipeTo(destination, { signal });
    report(true);
    return { via: 'file', missing };
  }
  const archive = await new Response(counted).blob();
  signal.throwIfAborted();
  saveBlob(archive, filename);
  report(true);
  return { via: 'download', missing };
}
