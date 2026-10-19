import { sanitizeName } from './cloud/util';

/** File extension by MIME type, for the outputs a booth makes. */
export const EXT: Record<string, string> = {
  'video/mp4': 'mp4',
  'image/gif': 'gif',
  'image/jpeg': 'jpg',
  'image/png': 'png',
};

/** Filesystem-safe event name for filenames. */
export const slug = (s: string) =>
  s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'immersia';

export const DEFAULT_CLOUD_FOLDER = 'Immersia 360';

/** The operator's per-event folder inside their chosen folder: "Gala 360 2026-10-19". */
export const eventFolderName = (eventName: string, eventDate: string) =>
  sanitizeName(`${eventName.trim()} ${eventDate}`);

/**
 * The name a file gets in the operator's cloud. Like the download name (EVT-5 prefix + event + kind)
 * but with the session's short code too: in a cloud folder every guest's file lands side by side,
 * so names must be unique per file — and stable, because the name is how a retry recognises a file
 * that is already there. When a session has several outputs of one kind (one per take), a slice of
 * the output id tells them apart.
 */
export function cloudFilename(f: {
  prefix: string;
  eventName: string;
  shortCode: string;
  kind: string;
  mime: string;
  outputId: string;
  sameKind: number;
}): string {
  const tail = f.sameKind > 1 ? `-${f.outputId.replace(/-/g, '').slice(-6)}` : '';
  return `${f.prefix}${slug(f.eventName)}-${f.shortCode}-${f.kind.replace('_', '-')}${tail}.${EXT[f.mime] ?? 'bin'}`;
}
