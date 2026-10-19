'use client';

import { useEffect, useMemo } from 'react';
import type { Template } from '@immersia/layout';
import { outputSize } from '@immersia/render-engine';
import { eventTokens, overlayCanvasFor, type Video360Settings } from '@immersia/shared';
import type { AssetView } from '@/server/assets';
import { cachedAsset, fillAssets } from './event-assets';
import { loadCard, renderOverlay } from './media';
import type { RenderAssets } from './use-render-queue';

export interface EventMedia {
  name: string;
  date: string;
  branding: { hashtag: string; custom1: string; custom2: string; custom3: string };
  /** The event's overlay design (VID-4), or null for clean videos. */
  overlay: Template | null;
  /** Every file the media uses, with signed URLs that fill the device cache. */
  assets: AssetView[];
}

/**
 * The 360 booth's media for each render (VID-4, 5, 6): the overlay drawn at the output resolution,
 * the intro/outro cards and the music, all read from the device's offline cache. The overlay is
 * drawn once (and its fonts fetched) as soon as the files are on the device, while the booth is
 * still online, then copied for every job.
 */
export function useEventMedia(event: EventMedia, video: Video360Settings): RenderAssets {
  const { overlay: design, assets, name, date, branding } = event;
  const byId = useMemo(() => new Map(assets.map((a) => [a.id, a])), [assets]);
  const size = useMemo(() => outputSize(video.resolution, video.aspect), [video.resolution, video.aspect]);

  const media = useMemo<RenderAssets>(() => {
    const ready = () => fillAssets(assets);
    // A new design or output size starts a fresh drawing.
    let drawn: Promise<OffscreenCanvas | null> | null = null;
    const draw = async () => {
      await ready();
      return design
        ? renderOverlay(design, overlayCanvasFor(video.aspect), size, eventTokens({ name, date }, branding)).catch(
            () => null,
          )
        : null;
    };
    const music = video.music;
    const card = (id: string | null) => async () => {
      await ready();
      return loadCard(id ? (byId.get(id) ?? null) : null, video.cardSeconds);
    };
    return {
      overlay: design
        ? async () => {
            drawn ??= draw();
            const canvas = await drawn;
            return canvas ? createImageBitmap(canvas) : null;
          }
        : undefined,
      music: music
        ? async () => {
            await ready();
            return cachedAsset(music.assetId);
          }
        : undefined,
      intro: card(video.introAssetId),
      outro: card(video.outroAssetId),
    };
  }, [
    assets,
    byId,
    design,
    size,
    name,
    date,
    branding,
    video.aspect,
    video.music,
    video.cardSeconds,
    video.introAssetId,
    video.outroAssetId,
  ]);

  // Draw the overlay now, while online: fonts and images are fetched once and cached for later.
  useEffect(() => {
    void media.overlay?.().then((bmp) => bmp?.close());
  }, [media]);

  return media;
}
