import { outputSize, videoBitrate } from '@immersia/render-engine';
import { sessionForTake, boothDb, type LocalTake, type TakeStore } from '@immersia/offline';
import type { RenderReportRequest, Video360Settings } from '@immersia/shared';
import { cardSecondsOf, planTiming, seedOf } from './render-plan';
import {
  ServerApiError,
  type PreparedJob,
  type RecipePlan,
  type ServerRenderApi,
  type ServerStepDeps,
} from './server-render-core';
import type { RenderAssets } from './use-render-queue';

/** The booth's calls for the server rung, authenticated with the device token. */
export function createServerRenderApi(token: string): ServerRenderApi {
  const headers = { 'content-type': 'application/json', authorization: `Device ${token}` };

  async function call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const res = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const json = (await res.json().catch(() => ({}))) as T & { error?: string; scope?: string; retryAfterS?: number };
    if (res.ok) return json;
    const retryAfter = Number(res.headers.get('retry-after'));
    throw new ServerApiError(
      res.status,
      json.error ?? `http_${res.status}`,
      json.retryAfterS ?? (Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : null),
      json.scope ?? null,
    );
  }

  return {
    requestFiles: (takeId, files) => call('POST', `/api/booth/takes/${takeId}/files`, { files }),

    async put(ticket, body) {
      const res = await fetch(ticket.url, { method: ticket.method, headers: ticket.headers, body });
      // 403 is an expired or mismatched signature: the next attempt asks for fresh tickets.
      if (!res.ok) throw new ServerApiError(res.status, `storage_${res.status}`);
    },

    requestRender: async (takeId, input) =>
      (
        await call<{ job: Awaited<ReturnType<ServerRenderApi['requestRender']>> }>(
          'POST',
          `/api/booth/takes/${takeId}/render`,
          input,
        )
      ).job,

    job: async (takeId) =>
      (await call<{ job: Awaited<ReturnType<ServerRenderApi['job']>> }>('GET', `/api/booth/takes/${takeId}/render`))
        .job,
  };
}

/**
 * Tell the server how a render went (first-party analytics, and the rung that worked for the device's
 * record). Best effort: it never stands between a guest and their video, so a failure here is dropped.
 */
export function reportRender(token: string | null, body: RenderReportRequest): void {
  if (!token || !navigator.onLine) return;
  void fetch('/api/booth/render-report', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Device ${token}` },
    body: JSON.stringify(body),
    keepalive: true,
  }).catch(() => undefined);
}

/** An ImageBitmap as a PNG file (the overlay and the end card the server's worker lays over the video). */
async function pngOf(image: ImageBitmap): Promise<Blob> {
  try {
    const canvas = new OffscreenCanvas(image.width, image.height);
    canvas.getContext('2d')!.drawImage(image, 0, 0);
    return await canvas.convertToBlob({ type: 'image/png' });
  } finally {
    image.close();
  }
}

/** The things a server job is made of, from the same event settings and files the booth's own render uses. */
export function serverStepDeps(input: {
  take: LocalTake;
  api: ServerRenderApi;
  video: Video360Settings;
  store: TakeStore;
  assets: RenderAssets | undefined;
  smallerVersion: boolean;
}): ServerStepDeps {
  const { take, api, video, store, assets } = input;
  return {
    api,
    async sessionId() {
      return (await sessionForTake(boothDb(), take.id))?.id ?? null;
    },
    async prepare(): Promise<PreparedJob> {
      const original = await store.read(take.path, take.mimeType);
      const size = outputSize(video.resolution, video.aspect);
      const output = {
        ...size,
        fps: video.fps,
        bitrate: videoBitrate(video.quality, size.width, size.height, video.fps),
      };
      // The files the recipe needs the booth to draw: a missing or unreadable one renders without it, as on the booth.
      const [overlayImage, endImage, music] = await Promise.all([
        assets?.overlay?.().catch(() => null) ?? null,
        assets?.endCard?.(take).catch(() => null) ?? null,
        assets?.music?.().catch(() => null) ?? null,
      ]);
      const described = assets?.describe?.() ?? { intro: null, outro: null, background: null };
      const endSeconds = endImage ? cardSecondsOf(endImage) : 0;
      // The bitmaps are single use: they become files first (and are closed), whatever comes after.
      const [overlay, endCard] = await Promise.all([
        overlayImage ? pngOf(overlayImage) : null,
        endImage ? pngOf(endImage.image) : null,
      ]);
      const timing = await planTiming({
        video,
        take: original,
        music,
        output,
        cards: { intro: described.intro?.seconds ?? 0, outro: described.outro?.seconds ?? 0, end: endSeconds },
      });
      const plan: RecipePlan = {
        output,
        preset: video.quality,
        slowMotion: timing.slowMotion,
        reverse: video.reverse,
        look: video.filterId ? { id: video.filterId, intensity: 1 } : null,
        effects: video.effects.map((e) => ({ id: e.id, intensity: e.intensity, colorMode: e.colorMode ?? null })),
        beats: timing.beats,
        seed: seedOf(take.id),
        music: video.music,
        background: described.background,
        intro: described.intro,
        outro: described.outro,
        endCardSeconds: endCard ? endSeconds : null,
        smallCopy: input.smallerVersion,
      };
      return { plan, original, originalMime: take.mimeType, overlay, endCard };
    },
  };
}
