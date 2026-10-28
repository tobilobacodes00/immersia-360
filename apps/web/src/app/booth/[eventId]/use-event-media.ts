'use client';

import { useEffect, useMemo } from 'react';
import type { Template } from '@immersia/layout';
import { outputSize } from '@immersia/render-engine';
import { eventTokens, overlayCanvasFor, sessionUrl, type EventTheme, type Video360Settings } from '@immersia/shared';
import type { AssetView } from '@/server/assets';
import { boothDb, sessionForTake } from '@immersia/offline';
import { cachedAsset, fillAssets } from './event-assets';
import { END_CARD_SECONDS, loadCard, renderEndCard, renderOverlay } from './media';
import type { RenderAssets } from './use-render-queue';

export interface EventMedia {
  name: string;
  date: string;
  branding: { hashtag: string; custom1: string; custom2: string; custom3: string };
  /** The event's overlay design (VID-4), or null for clean videos. */
  overlay: Template | null;
  /** Every file the media uses, with signed URLs that fill the device cache. */
  assets: AssetView[];
  /** DL-4: close every video with the guest's QR (the hint is already translated). */
  endCard: { theme: EventTheme; hint: string } | null;
}

/**
 * The 360 booth's media for each render (VID-4, 5, 6): the overlay drawn at the output resolution,
 * the intro/outro cards and the music, all read from the device's offline cache. The overlay is
 * drawn once (and its fonts fetched) as soon as the files are on the device, while the booth is
 * still online, then copied for every job.
 */
export function useEventMedia(event: EventMedia, video: Video360Settings): RenderAssets {
  const { overlay: design, assets, name, date, branding, endCard } = event;
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
      endCard: endCard
        ? async (take) => {
            const session = await sessionForTake(boothDb(), take.id);
            if (!session) return null;
            const image = await renderEndCard({
              target: overlayCanvasFor(video.aspect),
              size,
              theme: endCard.theme,
              eventName: name,
              hint: endCard.hint,
              link: sessionUrl(window.location.origin, session.linkId, 'outro'),
              code: session.shortCode,
            });
            return { kind: 'still' as const, image, seconds: END_CARD_SECONDS };
          }
        : undefined,
    };
  }, [
    assets,
    byId,
    design,
    size,
    name,
    date,
    branding,
    endCard,
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
