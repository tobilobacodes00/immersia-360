import { z } from 'zod';
import type { BoothMode, EventTheme } from '@immersia/shared';

/**
 * The highlight reel's choices (LIV-14), kept free of the database and storage so they can be tested:
 * which of the gallery's items make the cut, which file of a session to use, and how much of a booth
 * video is the booth's own intro, outro and QR card rather than the guest.
 */

export const REEL_LENGTHS_S = [30, 60, 90] as const;
export type ReelLengthS = (typeof REEL_LENGTHS_S)[number];

/** 720p builds from the light copy of each video (a third of the download); 1080p from the full one. */
export const REEL_QUALITIES = ['720p', '1080p'] as const;
export type ReelQuality = (typeof REEL_QUALITIES)[number];

export const REEL_MAX_BYTES = 400 * 1024 * 1024;
export const REEL_POSTER_MAX_BYTES = 4 * 1024 * 1024;
export const REEL_MAX_SESSIONS = 80;
/** A reel is at most 90 s; the margin covers the closing card's rounding. */
export const REEL_MAX_DURATION_MS = 100_000;

export const highlightPlanSchema = z.object({
  lengthS: z.union([z.literal(30), z.literal(60), z.literal(90)]),
  quality: z.enum(REEL_QUALITIES),
});
export type HighlightPlanInput = z.infer<typeof highlightPlanSchema>;

export const highlightUploadSchema = z.object({
  bytes: z.number().int().positive().max(REEL_MAX_BYTES),
  width: z.number().int().min(2).max(4320),
  height: z.number().int().min(2).max(4320),
  durationMs: z.number().int().min(1000).max(REEL_MAX_DURATION_MS),
  sessionIds: z.array(z.uuid()).min(1).max(REEL_MAX_SESSIONS),
  /** The JPEG shown before the video loads; null when the browser could not make one. */
  posterBytes: z.number().int().positive().max(REEL_POSTER_MAX_BYTES).nullable(),
});
export type HighlightUploadInput = z.infer<typeof highlightUploadSchema>;

// -----------------------------------------------------------------------------------------------
// Ranking

/** One public gallery session, with what it has earned. */
export interface HighlightCandidate {
  id: string;
  /** ms since the epoch. */
  capturedAt: number;
  booth: BoothMode;
  downloads: number;
  /** Opens of its share page that came through the Live Display's QR. */
  displayScans: number;
  /** Opens of its share page, however the guest got there. */
  views: number;
}

export interface RankedHighlight {
  id: string;
  /** 1 for the best pick, falling towards 0: better clips stay on screen a little longer. */
  weight: number;
  score: number;
}

/** A download is a guest keeping the file; a scan of the display's QR is a guest wanting it; a view is a look. */
export const ENGAGEMENT_WEIGHTS = { download: 3, displayScan: 2, view: 1 } as const;

export const engagement = (c: Pick<HighlightCandidate, 'downloads' | 'displayScans' | 'views'>) =>
  c.downloads * ENGAGEMENT_WEIGHTS.download + c.displayScans * ENGAGEMENT_WEIGHTS.displayScan + c.views;

/** How hard the picks are spread across booths and across the night (in units of a perfect engagement score). */
const BOOTH_SPREAD = 0.2;
const TIME_SPREAD = 1;
/** Of the items captured within one average spacing of each other, at most this many make the reel. */
const MAX_PER_WINDOW = 2;

/**
 * The `count` best items for a reel, best first.
 *
 * Quality is what guests did with an item: downloads, scans of the display's QR and opens of its page (log-scaled, so
 * one viral clip does not drown everything else). When nothing has earned anything yet, the newest items lead.
 * Then each pick is chosen to add variety. An item from a booth that is already well represented is discounted; so
 * is one captured close to an item already chosen (the same group of friends, a few minutes apart), and no stretch
 * of the night, one average spacing between picks wide, gets more than two. The reel then covers both booths and the
 * whole event instead of one busy quarter of an hour. Guests are not identified anywhere, so time is the only handle
 * on "the same people".
 */
export function selectHighlights(candidates: HighlightCandidate[], count: number): RankedHighlight[] {
  const take = Math.min(Math.max(0, Math.floor(count)), candidates.length);
  if (take === 0) return [];
  const scores = candidates.map(engagement);
  const best = Math.max(...scores);
  const first = Math.min(...candidates.map((c) => c.capturedAt));
  const span = Math.max(1, Math.max(...candidates.map((c) => c.capturedAt)) - first);
  const recency = (c: HighlightCandidate) => (c.capturedAt - first) / span;
  const base = candidates.map((c, i) =>
    best > 0 ? Math.log1p(scores[i]!) / Math.log1p(best) + 0.05 * recency(c) : 0.5 * recency(c),
  );
  // The average spacing between picks, if they were spread evenly over the event.
  const spacing = Math.max(1, span / take);

  const remaining = new Set(candidates.keys());
  const picked: number[] = [];
  const perBooth = new Map<BoothMode, number>();
  /** Higher value wins; a tie goes to the newer capture, then the lower id, so the answer never depends on input order. */
  const beats = (i: number, value: number, than: number, thanValue: number) => {
    if (than < 0 || value > thanValue + 1e-12) return true;
    if (value < thanValue - 1e-12) return false;
    const a = candidates[i]!;
    const b = candidates[than]!;
    return a.capturedAt > b.capturedAt || (a.capturedAt === b.capturedAt && a.id < b.id);
  };
  while (picked.length < take) {
    // The best item, and the best one that does not make a stretch of the night too full (if every one does, that one).
    let open = -1;
    let openValue = -Infinity;
    let any = -1;
    let anyValue = -Infinity;
    for (const i of remaining) {
      const c = candidates[i]!;
      let crowding = 0;
      let near = 0;
      for (const p of picked) {
        const apart = Math.abs(c.capturedAt - candidates[p]!.capturedAt) / spacing;
        crowding = Math.max(crowding, Math.exp(-(apart * apart)));
        if (apart < 0.5) near++;
      }
      const boothShare = picked.length ? (perBooth.get(c.booth) ?? 0) / picked.length : 0;
      const value = base[i]! - BOOTH_SPREAD * boothShare - TIME_SPREAD * crowding;
      if (beats(i, value, any, anyValue)) {
        any = i;
        anyValue = value;
      }
      if (near < MAX_PER_WINDOW && beats(i, value, open, openValue)) {
        open = i;
        openValue = value;
      }
    }
    const chosen = open >= 0 ? open : any;
    remaining.delete(chosen);
    picked.push(chosen);
    const booth = candidates[chosen]!.booth;
    perBooth.set(booth, (perBooth.get(booth) ?? 0) + 1);
  }
  return picked.map((i, rank) => ({
    id: candidates[i]!.id,
    weight: 1 - rank / take,
    score: scores[i]!,
  }));
}

/** How many items to hand the browser for a reel of this length: what it needs, and spares for files that fail. */
export const candidatesFor = (lengthS: ReelLengthS) => Math.min(48, Math.max(12, Math.ceil(lengthS / 2.2) + 6));

// -----------------------------------------------------------------------------------------------
// Which file, and how much of it

export interface ReelOutputRow {
  id: string;
  kind: string;
  key: string | null;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  bytes: number | null;
}

export interface ReelMedia {
  kind: 'video' | 'still';
  output: ReelOutputRow;
  booth: BoothMode;
}

const usable = (o: ReelOutputRow | undefined): o is ReelOutputRow => Boolean(o?.key && o.width && o.height);

/**
 * The file a session contributes. A photo session is its strip, shown as a still (its boomerang or short video
 * when it has no strip); a 360 session is its video, the light copy when the reel is built at 720p. A GIF is not
 * a video the browser can decode frame by frame, so a session with only that is left out.
 */
export function pickReelMedia(outputs: ReelOutputRow[], quality: ReelQuality): ReelMedia | null {
  const of = (kind: string) => {
    const o = outputs.find((x) => x.kind === kind);
    return usable(o) ? o : undefined;
  };
  const photo = outputs.some((o) => o.kind === 'strip' || o.kind === 'gif');
  if (photo) {
    const strip = of('strip');
    if (strip) return { kind: 'still', output: strip, booth: 'photo' };
    const motion = of('boomerang') ?? of('short_video');
    return motion ? { kind: 'video', output: motion, booth: 'photo' } : null;
  }
  const video = quality === '720p' ? (of('small_mp4') ?? of('mp4')) : (of('mp4') ?? of('small_mp4'));
  return video ? { kind: 'video', output: video, booth: 'video360' } : null;
}

/** The booth's QR end card (DL-4) lasts this long (the same as `END_CARD_SECONDS` in the booth). */
export const BOOTH_END_CARD_S = 2;
/** A little more than the cards themselves, so a frame of one never flashes in the reel. */
export const CARD_SAFETY_S = 0.25;

export interface CardAsset {
  mime: string;
  durationMs: number | null;
}

/**
 * How much of a 360 video, at the start and at the end, is the booth's own intro, outro and QR card (VID-5, DL-4)
 * and so not what a reel should show. A still card lasts `cardSeconds`; a clip lasts its own length up to that. A
 * card whose asset is gone was never drawn.
 */
export function boothCardSeconds(
  video: { introAssetId: string | null; outroAssetId: string | null; cardSeconds: number },
  assets: ReadonlyMap<string, CardAsset>,
  endCard: boolean,
): { headS: number; tailS: number } {
  const card = (id: string | null) => {
    const a = id ? assets.get(id) : undefined;
    if (!a) return 0;
    if (a.mime.startsWith('image/')) return video.cardSeconds;
    return Math.min(video.cardSeconds, (a.durationMs ?? video.cardSeconds * 1000) / 1000);
  };
  const head = card(video.introAssetId);
  const tail = card(video.outroAssetId) + (endCard ? BOOTH_END_CARD_S : 0);
  return {
    headS: head > 0 ? head + CARD_SAFETY_S : 0,
    tailS: tail > 0 ? tail + CARD_SAFETY_S : 0,
  };
}

// -----------------------------------------------------------------------------------------------
// What the studio is told

export interface HighlightItem {
  sessionId: string;
  kind: 'video' | 'still';
  /** A signed link, good for two hours. */
  url: string;
  bytes: number | null;
  /** Video: its length according to the database; the browser measures the file itself. */
  durationS: number | null;
  /** Video: seconds of the booth's own cards to skip at the start and at the end. */
  headS: number;
  tailS: number;
  /** 1 = best. */
  weight: number;
  capturedAt: number;
  booth: BoothMode;
}

export interface HighlightSummary {
  id: string;
  uploadedAt: string;
  durationS: number;
  width: number;
  height: number;
  bytes: number;
  clips: number;
  /** Of those clips, how many are no longer in the public gallery (hidden or opted out since). */
  withheld: number;
  /** A signed link to play it in the studio. */
  url: string;
}

export interface HighlightPlan {
  event: { name: string; date: string; theme: EventTheme; galleryUrl: string; aspect: '9:16' | '1:1' | '16:9' };
  /** Best first. */
  items: HighlightItem[];
  /** Public items in the gallery, whether or not they can be used. */
  available: number;
  music: { url: string; settings: { trimStartMs: number; trimEndMs: number | null; volume: number } } | null;
}

/** The reel as the client gallery shows it. */
export interface GalleryHighlight {
  url: string;
  downloadUrl: string;
  poster: string | null;
  width: number;
  height: number;
  durationS: number;
}
