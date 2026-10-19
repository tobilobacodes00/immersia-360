import type { LocalOutput, LocalSession, OutputKind } from '@immersia/offline';

/**
 * The operator's event gallery (screen 15), as pure data: what the device holds for the event,
 * grouped, filtered and named. The component reads blobs and draws; every decision lives here so it
 * can be tested without a browser.
 */

/** What the gallery lists: every output except posters, which belong to their video. */
export type GalleryKind = Exclude<OutputKind, 'poster'>;
export type GalleryFilter = 'all' | 'videos' | 'strips' | 'motion';
/** `failed` = the server refused the session; the operator should look (the upload pill says so too). */
export type UploadState = 'local' | 'uploading' | 'uploaded' | 'failed';

export const GALLERY_FILTERS: readonly GalleryFilter[] = ['all', 'videos', 'strips', 'motion'];

const FILTER_OF: Record<GalleryKind, Exclude<GalleryFilter, 'all'>> = {
  mp4: 'videos',
  small_mp4: 'videos',
  strip: 'strips',
  gif: 'motion',
  boomerang: 'motion',
  short_video: 'motion',
};

/** Folder per kind inside the export, in the order they are written. */
export const ZIP_FOLDER: Record<GalleryKind, string> = {
  mp4: 'videos',
  small_mp4: 'videos-small',
  strip: 'strips',
  gif: 'gifs',
  boomerang: 'boomerangs',
  short_video: 'short-videos',
};
const KIND_ORDER = Object.keys(ZIP_FOLDER) as GalleryKind[];

/** Above this a Blob download (no File System Access API) risks running the tab out of memory. */
export const MEMORY_EXPORT_WARN_BYTES = 1.5 * 1024 ** 3;

export interface GalleryItem {
  /** The output's id on this device. */
  id: string;
  kind: GalleryKind;
  mime: string;
  /** Where the bytes are in the take store. */
  path: string;
  bytes: number;
  width: number;
  height: number;
  durationMs: number;
  createdAt: number;
  sessionId: string | null;
  linkId: string | null;
  shortCode: string | null;
  /** EVT-5 prefix ("0007_"); empty until the session is registered, or when the event has none. */
  filenamePrefix: string;
  upload: UploadState;
  /** The still of this item's take, when it has one (the 360 booth makes one per video). */
  poster: { path: string; mime: string } | null;
}

export const isGalleryKind = (kind: OutputKind): kind is GalleryKind => kind !== 'poster';
export const filterOf = (kind: GalleryKind) => FILTER_OF[kind];
export const isVideoMime = (mime: string) => mime.startsWith('video/');

export function uploadState(
  output: Pick<LocalOutput, 'uploadedAt' | 'serverId'>,
  session: Pick<LocalSession, 'state'> | undefined,
): UploadState {
  if (output.uploadedAt) return 'uploaded';
  if (session?.state === 'failed') return 'failed';
  if (session?.state === 'registered' || output.serverId) return 'uploading';
  return 'local';
}

/**
 * Everything this device made for the event, newest first. Posters are folded into the videos of
 * their take; a re-rendered output replaces the one before it (the server keeps one per kind and
 * take or session, so the gallery does too).
 */
export function buildGalleryItems(outputs: readonly LocalOutput[], sessions: readonly LocalSession[]): GalleryItem[] {
  const sessionById = new Map(sessions.map((s) => [s.id, s]));
  const sessionByTake = new Map<string, LocalSession>();
  for (const s of sessions) for (const takeId of s.takeIds) sessionByTake.set(takeId, s);

  const posterOfTake = new Map<string, LocalOutput>();
  for (const o of outputs) {
    if (o.kind !== 'poster' || !o.takeId) continue;
    const kept = posterOfTake.get(o.takeId);
    if (!kept || o.createdAt > kept.createdAt) posterOfTake.set(o.takeId, o);
  }

  const newestFirst = [...outputs].sort((a, b) => b.createdAt - a.createdAt || (a.id < b.id ? 1 : -1));
  const seen = new Set<string>();
  const items: GalleryItem[] = [];
  for (const o of newestFirst) {
    if (!isGalleryKind(o.kind)) continue;
    const owner = o.takeId ?? o.sessionId ?? o.id;
    const key = `${owner}:${o.kind}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const session = (o.sessionId ? sessionById.get(o.sessionId) : undefined) ?? sessionByTake.get(o.takeId ?? '');
    const poster = (o.kind === 'mp4' || o.kind === 'small_mp4') && o.takeId ? posterOfTake.get(o.takeId) : undefined;
    items.push({
      id: o.id,
      kind: o.kind,
      mime: o.mime,
      path: o.path,
      bytes: o.bytes,
      width: o.width,
      height: o.height,
      durationMs: o.durationMs,
      createdAt: o.createdAt,
      sessionId: session?.id ?? o.sessionId ?? null,
      linkId: session?.linkId ?? null,
      shortCode: session?.shortCode ?? null,
      filenamePrefix: session?.filenamePrefix ?? '',
      upload: uploadState(o, session),
      poster: poster ? { path: poster.path, mime: poster.mime } : null,
    });
  }
  return items;
}

export function applyFilter(items: readonly GalleryItem[], filter: GalleryFilter): GalleryItem[] {
  return filter === 'all' ? [...items] : items.filter((i) => filterOf(i.kind) === filter);
}

export function countByFilter(items: readonly GalleryItem[]): Record<GalleryFilter, number> {
  const counts: Record<GalleryFilter, number> = { all: items.length, videos: 0, strips: 0, motion: 0 };
  for (const i of items) counts[filterOf(i.kind)]++;
  return counts;
}

/** Control characters and the ones no common file system accepts in a name. */
const safeName = (s: string) =>
  Array.from(s, (ch) => (ch.charCodeAt(0) < 32 || '\\/:*?"<>|'.includes(ch) ? '-' : ch)).join('');

const EXT_OF_MIME: Record<string, string> = {
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'image/gif': 'gif',
  'image/jpeg': 'jpg',
  'image/png': 'png',
};

export function extensionOf(item: Pick<GalleryItem, 'path' | 'mime'>): string {
  return /\.([a-z0-9]{1,5})$/i.exec(item.path)?.[1]?.toLowerCase() ?? EXT_OF_MIME[item.mime] ?? 'bin';
}

/**
 * The name a file is saved under: the event's filename prefix when the server has assigned one
 * (EVT-5), then the kind and the guest's short code, e.g. `0007_small-mp4-K7M2QX.mp4`. A session
 * with no code yet (a dry pool, still offline) falls back to the tail of the output's id.
 */
export function outputFilename(
  item: Pick<GalleryItem, 'id' | 'kind' | 'shortCode' | 'filenamePrefix' | 'path' | 'mime'>,
): string {
  const code = item.shortCode ?? item.id.replace(/-/g, '').slice(-8).toUpperCase();
  return safeName(`${item.filenamePrefix}${item.kind.replace('_', '-')}-${code}.${extensionOf(item)}`);
}

/** Filesystem-safe event name (same rule as the guest downloads). */
export function eventSlug(name: string): string {
  const slug = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40)
    .replace(/-$/, '');
  return slug || 'immersia';
}

/** The operator's local calendar day, YYYY-MM-DD. */
export function localDateStamp(date: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

export const zipFilename = (eventName: string, date: Date) => `${eventSlug(eventName)}-${localDateStamp(date)}.zip`;

/** One file of the export, planned before any bytes are read. */
export interface ZipEntryPlan {
  /** The output's id. */
  id: string;
  /** Path inside the ZIP: `<folder>/<filename>`. */
  path: string;
  /** Where to read the bytes from. */
  source: { path: string; mime: string };
  bytes: number;
  lastModified: number;
}

/**
 * The files of an export in folders by kind, oldest first within each. Names are unique even if
 * two outputs would be called the same (compared case-insensitively: macOS and Windows would
 * otherwise merge them on extraction).
 */
export function zipEntries(items: readonly GalleryItem[]): ZipEntryPlan[] {
  const ordered = [...items].sort(
    (a, b) =>
      KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1),
  );
  const taken = new Set<string>();
  return ordered.map((item) => ({
    id: item.id,
    path: uniquePath(`${ZIP_FOLDER[item.kind]}/${outputFilename(item)}`, taken),
    source: { path: item.path, mime: item.mime },
    bytes: item.bytes,
    lastModified: item.createdAt,
  }));
}

function uniquePath(path: string, taken: Set<string>): string {
  const dot = path.lastIndexOf('.');
  const hasExt = dot > path.lastIndexOf('/');
  const stem = hasExt ? path.slice(0, dot) : path;
  const ext = hasExt ? path.slice(dot) : '';
  let candidate = path;
  for (let n = 2; taken.has(candidate.toLowerCase()); n++) candidate = `${stem}-${n}${ext}`;
  taken.add(candidate.toLowerCase());
  return candidate;
}

export const totalBytes = (entries: readonly Pick<ZipEntryPlan, 'bytes'>[]) =>
  entries.reduce((sum, e) => sum + e.bytes, 0);

/** A Blob download holds the whole archive in memory: warn before it gets big. */
export const needsMemoryWarning = (bytes: number) => bytes > MEMORY_EXPORT_WARN_BYTES;

/**
 * What a grid card draws: a video's poster when it has one (a small JPEG, cheap to decode), else
 * the file itself. Videos without a poster (boomerangs, short videos) load their first frame only.
 */
export function thumbSource(item: Pick<GalleryItem, 'path' | 'mime' | 'poster'>): {
  path: string;
  mime: string;
  element: 'img' | 'video';
} {
  if (!isVideoMime(item.mime)) return { path: item.path, mime: item.mime, element: 'img' };
  if (item.poster) return { ...item.poster, element: 'img' };
  return { path: item.path, mime: item.mime, element: 'video' };
}

/** A capture time as the operator reads it: the clock today, the date and clock on another day. */
export function formatWhen(ms: number, locale: string, now: number = Date.now()): string {
  const date = new Date(ms);
  const today = new Date(now).toDateString() === date.toDateString();
  const style: Intl.DateTimeFormatOptions = today ? { timeStyle: 'short' } : { dateStyle: 'short', timeStyle: 'short' };
  return new Intl.DateTimeFormat(locale, style).format(date);
}
