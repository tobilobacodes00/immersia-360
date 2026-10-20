'use client';

import { useEffect, useMemo, useState } from 'react';
import { warmSegmenterAssets } from '@immersia/capture/segment';
import type { RenderBackground } from '@immersia/render-engine';
import type { LiveBackground } from '@immersia/render-engine/background';
import type { Background } from '@immersia/shared';
import type { AssetView } from '@/server/assets';
import { cachedAsset, fillAssets } from './event-assets';

/**
 * The event's background (CAP-10) as the booth's renderers want it. A colour or a blur needs no file; a
 * picture or video is read from the device's own copy of the event's assets (filled while the booth was
 * online), so a booth that has lost its connection still replaces backgrounds.
 */

const assetIdOf = (bg: Background) => (bg && 'assetId' in bg ? bg.assetId : null);

/**
 * While the booth is online and a background is set, fetch the model and runtime through the service worker
 * so they are on the device before the connection goes (the 360 booth also renders in a worker, which uses the
 * module build of the runtime).
 */
export function useWarmSegmenter(enabled: boolean, worker: boolean) {
  useEffect(() => {
    if (enabled && navigator.onLine) void warmSegmenterAssets({ worker });
  }, [enabled, worker]);
}

/** For a render job. Called per job: the worker takes ownership of what it is sent. Null renders as filmed. */
export async function loadRenderBackground(
  bg: Background,
  assets: readonly AssetView[],
): Promise<RenderBackground | null> {
  if (!bg) return null;
  if ('color' in bg) return { kind: 'color', color: bg.color };
  if ('blur' in bg) return { kind: 'blur' };
  const view = assets.find((a) => a.id === bg.assetId);
  if (!view) return null;
  await fillAssets(assets);
  const blob = await cachedAsset(view.id);
  if (!blob) return null;
  if (view.mime.startsWith('video/')) return { kind: 'video', file: blob };
  const image = await createImageBitmap(blob).catch(() => null);
  return image ? { kind: 'image', image } : null;
}

/**
 * For the live preview and photo stills: the background as pictures and elements this page can draw from.
 * Null while a picture is still loading, or when there is none to show.
 */
export function useLiveBackground(bg: Background, assets: readonly AssetView[]): LiveBackground | null {
  const assetId = assetIdOf(bg);
  const color = bg && 'color' in bg ? bg.color : null;
  const blur = Boolean(bg && 'blur' in bg);
  const simple = useMemo<LiveBackground | null>(
    () => (color ? { kind: 'color', color } : blur ? { kind: 'blur' } : null),
    [color, blur],
  );
  const [loaded, setLoaded] = useState<{ id: string; value: LiveBackground } | null>(null);

  useEffect(() => {
    if (!assetId) return;
    const view = assets.find((a) => a.id === assetId);
    if (!view) return;
    let live = true;
    let cleanup = () => {};
    void (async () => {
      await fillAssets(assets);
      const blob = await cachedAsset(assetId);
      if (!blob || !live) return;
      let value: LiveBackground;
      if (view.mime.startsWith('video/')) {
        const url = URL.createObjectURL(blob);
        const el = document.createElement('video');
        el.muted = true;
        el.loop = true;
        el.playsInline = true;
        el.src = url;
        void el.play().catch(() => undefined);
        cleanup = () => {
          el.pause();
          el.removeAttribute('src');
          el.load();
          URL.revokeObjectURL(url);
        };
        value = { kind: 'video', video: el };
      } else {
        const image = await createImageBitmap(blob).catch(() => null);
        if (!image) return;
        if (!live) {
          image.close();
          return;
        }
        cleanup = () => image.close();
        value = { kind: 'image', image, width: image.width, height: image.height };
      }
      if (live) setLoaded({ id: assetId, value });
      else cleanup();
    })();
    return () => {
      live = false;
      cleanup();
    };
  }, [assetId, assets]);

  return simple ?? (assetId && loaded?.id === assetId ? loaded.value : null);
}
