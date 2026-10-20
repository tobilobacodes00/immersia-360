import 'server-only';
import {
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from './env';

/**
 * Object storage for guest files (S3 API: Cloudflare R2 in production, MinIO in CI, any S3 for
 * self-hosters). Uploads and downloads are presigned against the S3 endpoint — R2 can't presign
 * on custom domains — and every URL is short-lived.
 */
interface StorageConfig {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
}

function config(): StorageConfig | null {
  const e = env();
  if (!e.S3_ENDPOINT || !e.S3_BUCKET || !e.S3_ACCESS_KEY_ID || !e.S3_SECRET_ACCESS_KEY) return null;
  return {
    endpoint: e.S3_ENDPOINT,
    region: e.S3_REGION,
    bucket: e.S3_BUCKET,
    accessKeyId: e.S3_ACCESS_KEY_ID,
    secretAccessKey: e.S3_SECRET_ACCESS_KEY,
    forcePathStyle: e.S3_FORCE_PATH_STYLE === '1',
  };
}

export class StorageUnavailableError extends Error {
  constructor() {
    super('Object storage is not configured (S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY)');
    this.name = 'StorageUnavailableError';
  }
}

let client: { s3: S3Client; bucket: string } | null = null;

function storage() {
  if (client) return client;
  const c = config();
  if (!c) throw new StorageUnavailableError();
  client = {
    bucket: c.bucket,
    s3: new S3Client({
      endpoint: c.endpoint,
      region: c.region,
      forcePathStyle: c.forcePathStyle,
      credentials: { accessKeyId: c.accessKeyId, secretAccessKey: c.secretAccessKey },
      // R2 rejects the SDK's default flexible checksums on presigned PUTs.
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    }),
  };
  return client;
}

export const storageConfigured = () => config() !== null;

/** A presigned single-part PUT. The exact length and type are signed, so the booth can't upload more. */
export async function presignUpload(key: string, contentType: string, bytes: number, expiresIn = 3600) {
  const { s3, bucket } = storage();
  const url = await getSignedUrl(
    s3,
    new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: contentType, ContentLength: bytes }),
    { expiresIn, signableHeaders: new Set(['content-type', 'content-length']) },
  );
  return { url, method: 'PUT' as const, headers: { 'content-type': contentType } };
}

/** A short-lived download URL that saves under a friendly filename. */
export async function presignDownload(key: string, filename: string, expiresIn = 300) {
  const { s3, bucket } = storage();
  const safe = filename.replace(/[^\w.\- ]+/g, '_');
  return getSignedUrl(
    s3,
    new GetObjectCommand({
      Bucket: bucket,
      Key: key,
      ResponseContentDisposition: `attachment; filename="${safe}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    }),
    { expiresIn },
  );
}

/** Inline (playable) URL for previews on the share page. */
export async function presignView(key: string, expiresIn = 3600) {
  const { s3, bucket } = storage();
  return getSignedUrl(s3, new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn });
}

export async function objectSize(key: string): Promise<number | null> {
  const { s3, bucket } = storage();
  try {
    const head = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return head.ContentLength ?? null;
  } catch {
    return null;
  }
}

/** The first `n` bytes of an object (a ranged GET), or null when it doesn't exist or is empty. */
export async function objectHead(key: string, n: number): Promise<Uint8Array | null> {
  const { s3, bucket } = storage();
  try {
    const res = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key, Range: `bytes=0-${n - 1}` }));
    return (await res.Body?.transformToByteArray()) ?? null;
  } catch {
    return null;
  }
}

/**
 * A streaming GET, for server-to-server copies to the operator's own cloud: the body is read as
 * the destination takes it, never buffered whole. Rejects when the object is gone (see isMissingObject).
 */
export async function objectStream(key: string): Promise<{ body: ReadableStream<Uint8Array>; size: number }> {
  const { s3, bucket } = storage();
  const res = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  if (!res.Body || res.ContentLength === undefined) throw new Error('The stored object has no body');
  return { body: res.Body.transformToWebStream(), size: res.ContentLength };
}

/** True for the S3 "no such key" error (an expired or deleted file). */
export const isMissingObject = (err: unknown): boolean =>
  typeof err === 'object' &&
  err !== null &&
  ((err as { name?: unknown }).name === 'NoSuchKey' ||
    (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404);

/**
 * Delete in batches of 1000 (the S3 limit). Returns how many keys were removed. Deleting a key that
 * is already gone succeeds, so the call is safe to repeat; a key the store refuses to delete makes
 * it throw (after the rest went through), so callers that remove the database row only after the
 * object never leave a file behind without a row to retry from.
 */
export async function deleteObjects(keys: string[]): Promise<number> {
  const { s3, bucket } = storage();
  let removed = 0;
  let refused = 0;
  for (let i = 0; i < keys.length; i += 1000) {
    const batch = keys.slice(i, i + 1000);
    const res = await s3.send(
      new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true } }),
    );
    const errors = res.Errors ?? [];
    refused += errors.length;
    removed += batch.length - errors.length;
  }
  if (refused > 0) throw new Error(`${refused} object(s) could not be deleted`);
  return removed;
}

/**
 * The first page (at most 1000) of keys under a prefix. Used to empty a deleted organization: list,
 * delete, list again until nothing is left. That needs no continuation token and resumes from any
 * point after a crash.
 */
export async function listKeys(prefix: string, max = 1000): Promise<string[]> {
  const { s3, bucket } = storage();
  const res = await s3.send(
    new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, MaxKeys: Math.min(1000, Math.max(1, max)) }),
  );
  return (res.Contents ?? []).flatMap((o) => (o.Key ? [o.Key] : []));
}

/** Object key layout: one prefix per event, so an event's files are easy to export or purge. */
export const objectKey = (organizationId: string, eventId: string, outputId: string, ext: string) =>
  `o/${organizationId}/e/${eventId}/${outputId}.${ext}`;

/** Library assets belong to the organization, not an event, so events can share them. */
export const assetObjectKey = (organizationId: string, assetId: string) => `o/${organizationId}/a/${assetId}`;

/** Every object of an organization (events and library) lives under this prefix. */
export const organizationPrefix = (organizationId: string) => `o/${organizationId}/`;
