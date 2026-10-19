import { describe, expect, it } from 'vitest';
import { MAX_ATTEMPTS, backoffMs, copyErrorKey, copyToCloud, decideFailure, type CopySource } from './copy-core';
import {
  Permanent,
  QuotaExceeded,
  ReauthRequired,
  Transient,
  type CloudFile,
  type CloudProvider,
  type UploadBody,
} from './types';

/** An in-memory "cloud folder": what a Drive/Dropbox folder does for the queue, nothing more. */
function fakeCloud() {
  const files = new Map<string, { file: CloudFile; bytes: number }>();
  const log = { uploads: 0, lookups: 0 };
  let crashAfterStoring = false;
  const provider: CloudProvider = {
    id: 'drive',
    authorizeUrl: () => '',
    exchangeCode: async () => ({ refreshToken: '', accountEmail: null }),
    accessToken: async () => ({ token: 't', expiresAt: new Date() }),
    ensureFolder: async (_t, name) => ({ id: name, name }),
    findExisting: async (_t, folder, filename) => {
      log.lookups++;
      return files.get(`${folder}/${filename}`)?.file ?? null;
    },
    upload: async (_t, folder, filename, _mime, size, body: UploadBody) => {
      log.uploads++;
      let bytes = 0;
      for await (const part of body as AsyncIterable<Uint8Array>) bytes += part.length;
      expect(bytes).toBe(size);
      const file = { id: `file-${files.size + 1}`, url: `https://cloud.example/${files.size + 1}` };
      files.set(`${folder}/${filename}`, { file, bytes });
      // The provider finished; our side then dies before it can write that down.
      if (crashAfterStoring) throw new Transient('the response was lost');
      return file;
    },
    revoke: async () => undefined,
    folderUrl: (id) => id,
  };
  return {
    provider,
    files,
    log,
    crashNextUploadAfterStoring: () => {
      crashAfterStoring = true;
    },
    recover: () => {
      crashAfterStoring = false;
    },
  };
}

const source = (size: number): { open: () => Promise<CopySource>; opened: () => number } => {
  let opened = 0;
  return {
    open: async () => {
      opened++;
      return {
        size,
        body: (async function* () {
          yield new Uint8Array(size);
        })(),
      };
    },
    opened: () => opened,
  };
};

const req = { token: 't', folderId: 'Gala 2026-10-19', filename: '0001_Gala-K7QX9M-mp4.mp4', mime: 'video/mp4' };

describe('copyToCloud (idempotent by name)', () => {
  it('uploads a file that is not there yet', async () => {
    const cloud = fakeCloud();
    const src = source(10);
    const out = await copyToCloud(cloud.provider, req, src.open);
    expect(out.reused).toBe(false);
    expect(cloud.log.uploads).toBe(1);
    expect(cloud.files.size).toBe(1);
  });

  it('a retry after a crash between the upload and the database write finds the file and does not upload again', async () => {
    const cloud = fakeCloud();
    cloud.crashNextUploadAfterStoring();
    const first = source(10);
    await expect(copyToCloud(cloud.provider, req, first.open)).rejects.toBeInstanceOf(Transient);
    expect(cloud.log.uploads).toBe(1);
    expect(cloud.files.size).toBe(1); // it really is in the cloud

    cloud.recover();
    const second = source(10);
    const out = await copyToCloud(cloud.provider, req, second.open);
    expect(out.reused).toBe(true);
    expect(out.file.id).toBe('file-1');
    expect(cloud.log.uploads).toBe(1); // still one upload ever
    expect(cloud.files.size).toBe(1); // still one file
    expect(second.opened()).toBe(0); // and the hosted copy was not even read
  });

  it('copying the same output twice in a row (a duplicate claim) uploads once', async () => {
    const cloud = fakeCloud();
    await copyToCloud(cloud.provider, req, source(10).open);
    const again = await copyToCloud(cloud.provider, req, source(10).open);
    expect(again.reused).toBe(true);
    expect(cloud.log.uploads).toBe(1);
  });

  it('different outputs have different names and are all copied', async () => {
    const cloud = fakeCloud();
    for (const code of ['K7QX9M', 'PLM234', 'ZZ9988']) {
      await copyToCloud(cloud.provider, { ...req, filename: `Gala-${code}-mp4.mp4` }, source(10).open);
    }
    expect(cloud.log.uploads).toBe(3);
    expect(cloud.files.size).toBe(3);
  });

  it('closes a stream source that was not fully consumed', async () => {
    const cloud = fakeCloud();
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array(4));
      },
      cancel() {
        cancelled = true;
      },
    });
    const failing: CloudProvider = {
      ...cloud.provider,
      upload: async () => {
        throw new Transient('connection reset');
      },
    };
    await expect(copyToCloud(failing, req, async () => ({ size: 100, body: stream }))).rejects.toBeInstanceOf(
      Transient,
    );
    expect(cancelled).toBe(true);
  });
});

describe('decideFailure', () => {
  const now = new Date('2026-10-19T12:00:00Z');

  it('revoked access pauses the row and asks for a reconnect (nothing is lost, nothing is counted)', () => {
    expect(decideFailure(new ReauthRequired(), 1, now)).toEqual({ kind: 'reauth', code: 'reauth_required' });
    expect(decideFailure(new ReauthRequired(), MAX_ATTEMPTS + 3, now).kind).toBe('reauth');
  });

  it('a full cloud fails the row with a clear code', () => {
    expect(decideFailure(new QuotaExceeded(), 1, now)).toEqual({ kind: 'fail', code: 'quota_exceeded' });
  });

  it('permanent errors keep their code', () => {
    expect(decideFailure(new Permanent('folder_missing'), 1, now)).toEqual({ kind: 'fail', code: 'folder_missing' });
    expect(decideFailure(new Permanent('source_gone'), 1, now)).toEqual({ kind: 'fail', code: 'source_gone' });
  });

  it('transient errors back off exponentially', () => {
    const at = (n: number) => (decideFailure(new Transient('x'), n, now) as { at: Date }).at.getTime() - now.getTime();
    expect(at(1)).toBe(30_000);
    expect(at(2)).toBe(60_000);
    expect(at(3)).toBe(120_000);
    expect(at(MAX_ATTEMPTS - 1)).toBe(30_000 * 2 ** (MAX_ATTEMPTS - 2));
  });

  it("honours the provider's Retry-After when it asks for longer than the backoff", () => {
    const d = decideFailure(new Transient('rate limited', 15 * 60_000), 1, now);
    expect(d).toEqual({ kind: 'retry', code: 'transient', at: new Date(now.getTime() + 15 * 60_000) });
    // …but never earlier than our own backoff.
    const short = decideFailure(new Transient('rate limited', 1000), 3, now) as { at: Date };
    expect(short.at.getTime() - now.getTime()).toBe(120_000);
  });

  it('gives up after MAX_ATTEMPTS', () => {
    expect(decideFailure(new Transient('x'), MAX_ATTEMPTS, now)).toEqual({ kind: 'fail', code: 'transient' });
  });

  it('retries unexpected errors too (a database or storage blip), then fails them', () => {
    expect(decideFailure(new Error('connection terminated'), 1, now).kind).toBe('retry');
    expect(decideFailure(new Error('boom'), MAX_ATTEMPTS, now)).toEqual({ kind: 'fail', code: 'unknown' });
  });

  it('backoff is capped at six hours', () => {
    expect(backoffMs(30)).toBe(6 * 3600_000);
  });
});

describe('copyErrorKey', () => {
  it('maps stored codes to wording keys, with a catch-all', () => {
    expect(copyErrorKey(null)).toBeNull();
    expect(copyErrorKey('quota_exceeded')).toBe('quota_exceeded');
    expect(copyErrorKey('forbidden')).toBe('other');
    expect(copyErrorKey('http_418')).toBe('other');
  });
});
