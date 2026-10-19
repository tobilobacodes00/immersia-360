'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RenderInputs } from '@immersia/layout';
import { templateAssetIds, templateFontFaces, type TemplateDocument, type TokenContext } from '@immersia/shared';
import { prepareTemplateFonts, type FontResolver, type TemplateFace } from '@/lib/template-fonts';
import type { AssetView } from '@/server/assets';

/**
 * Everything the renderer needs to draw a template in the studio: images fetched from signed URLs,
 * fonts loaded (library, built-in, uploaded), tokens and a sample QR. `redrawKey` changes whenever
 * something finishes loading, so canvases know to repaint.
 */
export function useTemplateInputs({
  docs,
  initialViews,
  tokens,
  qr,
  placeholders = true,
}: {
  /** Every document drawn with these inputs (the editor's one, or a gallery of thumbnails). */
  docs: readonly Pick<TemplateDocument, 'canvas' | 'elements'>[];
  initialViews: readonly AssetView[];
  tokens: TokenContext;
  qr?: RenderInputs['qr'];
  placeholders?: boolean;
}) {
  const [views, setViews] = useState(() => new Map(initialViews.map((a) => [a.id, a])));
  const [images, setImages] = useState<Map<string, ImageBitmap>>(() => new Map());
  const [fonts, setFonts] = useState<{ resolve: FontResolver; version: number } | null>(null);
  const loading = useRef(new Set<string>());

  const addView = useCallback((a: AssetView) => setViews((m) => new Map(m).set(a.id, a)), []);

  const needed = useMemo(
    () => [...new Set(docs.flatMap((d) => templateAssetIds(d)))].filter((id) => views.get(id)?.type !== 'font'),
    [docs, views],
  );
  useEffect(() => {
    for (const id of needed) {
      const v = views.get(id);
      if (!v || loading.current.has(id)) continue;
      loading.current.add(id);
      void fetch(v.url)
        .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(String(r.status)))))
        .then((b) => createImageBitmap(b))
        .then((bmp) => setImages((m) => new Map(m).set(id, bmp)))
        .catch(() => loading.current.delete(id));
    }
  }, [needed, views]);

  // Re-prepare only when the set of faces changes, not on every edit.
  const faceKey = useMemo(() => JSON.stringify(docs.flatMap((d) => templateFontFaces(d))), [docs]);
  useEffect(() => {
    let live = true;
    const bytes = async (id: string) => {
      const v = views.get(id);
      if (!v) return null;
      const r = await fetch(v.url);
      return r.ok ? r.arrayBuffer() : null;
    };
    void prepareTemplateFonts(JSON.parse(faceKey) as TemplateFace[], bytes).then((resolve) => {
      if (live) setFonts((f) => ({ resolve, version: (f?.version ?? 0) + 1 }));
    });
    return () => {
      live = false;
    };
  }, [faceKey, views]);

  const inputs = useMemo<RenderInputs>(
    () => ({
      photos: [],
      tokens,
      assets: (id) => images.get(id) ?? null,
      qr: qr ?? null,
      placeholders,
      fonts: fonts?.resolve,
    }),
    [tokens, images, fonts, qr, placeholders],
  );

  return {
    inputs,
    /** Changes when an image or a font finishes loading. */
    redrawKey: images.size * 1000 + (fonts?.version ?? 0),
    views,
    addView,
    assetName: useCallback((id: string) => views.get(id)?.name ?? null, [views]),
  };
}
