import {
  ASSET_RULES,
  SNIFF_BYTES,
  assetMaxBytes,
  assetMaxDurationMs,
  assetMediaKind,
  canonicalMime,
  sniffMime,
  type AssetType,
} from '@immersia/shared';
import { completeAssetUploadAction, createAssetUploadAction, deleteAssetAction } from '@/app/studio/assets/actions';
import type { AssetView } from '@/server/assets';

export type AssetUploadErrorCode = 'wrong_type' | 'too_big' | 'too_long' | 'unreadable' | 'quota' | 'failed';

/**
 * Why an upload was refused. Cancelling rejects with a standard `AbortError` DOMException instead,
 * so callers can tell "the user stopped it" from "it failed".
 */
export class AssetUploadError extends Error {
  readonly code: AssetUploadErrorCode;
  /** For `too_big` (bytes) and `too_long` (milliseconds): the limit that applies to this file. */
  readonly limit?: number;
  constructor(code: AssetUploadErrorCode, options?: ErrorOptions & { limit?: number }) {
    super(code, options);
    this.name = 'AssetUploadError';
    this.code = code;
    this.limit = options?.limit;
  }
}

export const isAbort = (err: unknown) => err instanceof DOMException && err.name === 'AbortError';

const abortError = () => new DOMException('Upload cancelled', 'AbortError');

/** A browser that can't read a file's header in this long is not going to. */
const PROBE_TIMEOUT_MS = 20_000;

interface Measured {
  width?: number;
  height?: number;
  durationMs?: number;
}

/** Duration (and size, for video) from the media element's metadata, without decoding the file. */
function probeMedia(
  file: Blob,
  tag: 'video' | 'audio',
): Promise<{ durationMs: number; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const el = document.createElement(tag);
    let settled = false;
    const finish = (settle: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      el.removeAttribute('src');
      el.load();
      URL.revokeObjectURL(url);
      settle();
    };
    const timer = setTimeout(() => finish(() => reject(new AssetUploadError('unreadable'))), PROBE_TIMEOUT_MS);
    el.preload = 'metadata';
    el.muted = true;
    el.onloadedmetadata = () =>
      finish(() =>
        resolve({
          // Infinity is what some recorders' files report: the length can't be checked, so it can't be accepted.
          durationMs: Number.isFinite(el.duration) ? Math.round(el.duration * 1000) : Number.NaN,
          width: el instanceof HTMLVideoElement ? el.videoWidth : 0,
          height: el instanceof HTMLVideoElement ? el.videoHeight : 0,
        }),
      );
    el.onerror = () => finish(() => reject(new AssetUploadError('unreadable')));
    el.src = url;
  });
}

/** Some audio streams (raw AAC, odd WAVs) have no length in their header: decoding finds it. */
async function decodedDurationMs(file: Blob): Promise<number> {
  const ctx = new OfflineAudioContext(1, 1, 44_100);
  const buffer = await ctx.decodeAudioData(await file.arrayBuffer());
  return Math.round(buffer.duration * 1000);
}

async function measure(file: File, mime: string): Promise<Measured> {
  const kind = assetMediaKind(mime);
  try {
    if (kind === 'image') {
      const bitmap = await createImageBitmap(file);
      const { width, height } = bitmap;
      bitmap.close();
      return { width, height };
    }
    if (kind === 'video') {
      const { durationMs, width, height } = await probeMedia(file, 'video');
      if (!Number.isFinite(durationMs) || !width || !height) throw new AssetUploadError('unreadable');
      return { width, height, durationMs };
    }
    if (kind === 'audio') {
      let durationMs: number | undefined;
      try {
        durationMs = (await probeMedia(file, 'audio')).durationMs;
      } catch {
        // Fall through to decoding: the element may refuse a file the audio engine can play.
      }
      if (durationMs === undefined || !Number.isFinite(durationMs)) durationMs = await decodedDurationMs(file);
      return { durationMs };
    }
    // A font the browser can't parse would fall back to a default face in every render.
    await new FontFace('probe', await file.arrayBuffer()).load();
    return {};
  } catch (err) {
    if (err instanceof AssetUploadError) throw err;
    throw new AssetUploadError('unreadable', { cause: err });
  }
}

function put(
  file: File,
  ticket: { url: string; method: 'PUT'; headers: Record<string, string> },
  onProgress?: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const onAbort = () => xhr.abort();
    const cleanup = () => signal?.removeEventListener('abort', onAbort);
    xhr.open(ticket.method, ticket.url);
    for (const [name, value] of Object.entries(ticket.headers)) xhr.setRequestHeader(name, value);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && e.total > 0) onProgress?.(e.loaded / e.total);
    };
    xhr.onload = () => {
      cleanup();
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress?.(1);
        resolve();
      } else reject(new AssetUploadError('failed'));
    };
    const onFail = () => {
      cleanup();
      reject(new AssetUploadError('failed'));
    };
    xhr.onerror = onFail;
    xhr.ontimeout = onFail;
    xhr.onabort = () => {
      cleanup();
      reject(abortError());
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    xhr.send(file);
  });
}

const SERVER_CODES: readonly AssetUploadErrorCode[] = ['wrong_type', 'too_big', 'too_long', 'quota'];

/** Turn the codes a server action answered with into an error, carrying the limit that was hit. */
function refusal(issues: string[] | undefined, type: AssetType, mime: string): AssetUploadError {
  const code = SERVER_CODES.find((c) => issues?.includes(c)) ?? 'failed';
  return new AssetUploadError(code, { limit: limitFor(code, type, mime) });
}

function limitFor(code: AssetUploadErrorCode, type: AssetType, mime: string): number | undefined {
  if (code === 'too_big') return assetMaxBytes(type, mime);
  if (code === 'too_long') return assetMaxDurationMs(type, mime) ?? undefined;
  return undefined;
}

/** "Gold frame.png" → "Gold frame": the library shows names, not filenames. */
const displayName = (filename: string) =>
  (filename.replace(/\.[^./\\]+$/, '').trim() || filename.trim() || 'Untitled').slice(0, 120);

/**
 * Upload a file to the library: check it here first (so a wrong file fails in a moment, not after
 * 200 MB), then reserve it on the server, PUT it straight to storage, and have the server verify
 * the stored bytes. Rejects with `AssetUploadError`, or an `AbortError` if `signal` fires.
 */
export async function uploadAsset(
  file: File,
  type: AssetType,
  onProgress?: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<AssetView> {
  signal?.throwIfAborted();
  let head: Uint8Array;
  try {
    head = new Uint8Array(await file.slice(0, SNIFF_BYTES).arrayBuffer());
  } catch (err) {
    throw new AssetUploadError('unreadable', { cause: err });
  }
  if (file.size === 0) throw new AssetUploadError('unreadable');
  // The type comes from the bytes, never from the file name or the browser's guess.
  const mime = canonicalMime(type, sniffMime(head));
  if (!mime || !ASSET_RULES[type].mimes.includes(mime)) throw new AssetUploadError('wrong_type');
  if (file.size > assetMaxBytes(type, mime)) throw refusal(['too_big'], type, mime);

  const measured = await measure(file, mime);
  signal?.throwIfAborted();
  const maxMs = assetMaxDurationMs(type, mime);
  if (maxMs && (measured.durationMs ?? 0) > maxMs) throw refusal(['too_long'], type, mime);

  const created = await createAssetUploadAction({
    type,
    name: displayName(file.name),
    mime,
    bytes: file.size,
    ...measured,
  });
  if (!created.ok) throw refusal(created.issues, type, mime);
  const { id, upload } = created.data;

  try {
    signal?.throwIfAborted();
    await put(file, upload, onProgress, signal);
    const done = await completeAssetUploadAction(id);
    if (!done.ok) throw refusal(done.issues, type, mime);
    return done.data;
  } catch (err) {
    // Give the space back now rather than when the sweep finds the abandoned upload.
    deleteAssetAction(id).catch(() => {});
    throw err;
  }
}
