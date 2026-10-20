'use client';

import { useEffect, useMemo, useState } from 'react';
import type { RenderInputs, Template } from '@immersia/layout';
import type { TokenContext } from '@immersia/shared';
import { TemplateCanvas } from '@/components/editor/TemplateCanvas';
import { useTemplateInputs } from '@/components/editor/use-template-inputs';
import type { AssetView } from '@/server/assets';

/** Overlays are previewed over a dark stand-in for the video. */
export const VIDEO_BACKDROP = '#2a2925';

/** True once the element has come near the viewport (and stays true). One observer per element. */
function useSeen(rootMargin = '240px'): [(el: HTMLElement | null) => void, boolean] {
  const [el, setEl] = useState<HTMLElement | null>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    if (!el || seen) return;
    // No observer (a very old browser): draw straight away rather than never.
    if (typeof IntersectionObserver === 'undefined') {
      const frame = requestAnimationFrame(() => setSeen(true));
      return () => cancelAnimationFrame(frame);
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setSeen(true);
          io.disconnect();
        }
      },
      { rootMargin },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [el, seen, rootMargin]);
  return [setEl, seen];
}

interface ThumbProps {
  doc: Template;
  tokens: TokenContext;
  qr?: RenderInputs['qr'];
  /** Signed links for the images a saved template uses (library templates draw with none). */
  views?: readonly AssetView[];
  maxWidth: number;
  maxHeight: number;
  label: string;
  /** Drawn under the template: overlays are shown over a stand-in for the video. */
  backdrop?: string;
}

/** The canvas of a thumbnail: fonts and images load for this template alone, when it mounts. */
function LiveThumb({ doc, tokens, qr, views = [], maxWidth, maxHeight, label, backdrop }: ThumbProps) {
  const docs = useMemo(() => [doc], [doc]);
  const { inputs, redrawKey, fontsReady } = useTemplateInputs({ docs, initialViews: views, tokens, qr });
  if (!fontsReady) return <Skeleton doc={doc} maxWidth={maxWidth} maxHeight={maxHeight} />;
  return (
    <TemplateCanvas
      doc={doc}
      inputs={inputs}
      redrawKey={redrawKey}
      maxWidth={maxWidth}
      maxHeight={maxHeight}
      label={label}
      backdrop={backdrop}
    />
  );
}

function Skeleton({ doc, maxWidth, maxHeight }: Pick<ThumbProps, 'doc' | 'maxWidth' | 'maxHeight'>) {
  const s = Math.min(maxWidth / doc.canvas.width, maxHeight / doc.canvas.height);
  return (
    <div
      aria-hidden
      className="animate-pulse rounded-md bg-line"
      style={{
        width: Math.max(1, Math.round(doc.canvas.width * s)),
        height: Math.max(1, Math.round(doc.canvas.height * s)),
      }}
    />
  );
}

/**
 * A template drawn by the real renderer, but only once it is near the screen (IntersectionObserver),
 * and with only its own fonts loaded: a library of 250 designs would otherwise paint 250 canvases and
 * fetch every typeface at once. Until then it holds its place with a same-sized block, so the grid does
 * not jump.
 */
export function TemplateThumb(props: ThumbProps) {
  const [ref, seen] = useSeen();
  return (
    <div ref={ref} className="grid place-items-center">
      {seen ? (
        <LiveThumb {...props} />
      ) : (
        <Skeleton doc={props.doc} maxWidth={props.maxWidth} maxHeight={props.maxHeight} />
      )}
    </div>
  );
}
