/**
 * The light half of the highlight reel's client code (LIV-14): its error type, the upload and the file name. Kept apart
 * from `reel-build.ts`, which brings the whole render engine with it, so the dashboard loads that only when an
 * operator actually builds a reel.
 */

export type ReelErrorCode = 'nothing' | 'download' | 'unsupported' | 'cancelled' | 'failed';

export class ReelError extends Error {
  constructor(
    readonly code: ReelErrorCode,
    message?: string,
  ) {
    super(message ?? code);
    this.name = 'ReelError';
  }
}

export interface UploadTarget {
  url: string;
  method: 'PUT';
  headers: Record<string, string>;
}

/** PUT a file straight to storage, reporting how much has gone. */
export function putFile(
  file: Blob,
  target: UploadTarget,
  onProgress?: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const onAbort = () => xhr.abort();
    const done = () => signal?.removeEventListener('abort', onAbort);
    xhr.open(target.method, target.url);
    for (const [name, value] of Object.entries(target.headers)) xhr.setRequestHeader(name, value);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && e.total > 0) onProgress?.(e.loaded / e.total);
    };
    xhr.onload = () => {
      done();
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new ReelError('failed', `upload ${xhr.status}`));
    };
    xhr.onerror = xhr.ontimeout = () => {
      done();
      reject(new ReelError('failed', 'upload'));
    };
    xhr.onabort = () => {
      done();
      reject(new ReelError('cancelled'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    xhr.send(file);
  });
}

/** "Gala-60s-highlights.mp4": a name that is safe on any file system. */
export function reelFilename(eventName: string, durationS: number): string {
  const name =
    eventName
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^A-Za-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40) || 'event';
  return `${name}-${Math.round(durationS)}s-highlights.mp4`;
}
