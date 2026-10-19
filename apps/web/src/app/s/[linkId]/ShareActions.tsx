'use client';

import { useRef, useState, useSyncExternalStore } from 'react';
import { ImageDown, Share2 } from 'lucide-react';

const noop = () => () => {};

/** Phones whose share sheet takes files can "Save Video" / "Save Image" straight into Photos. */
function canShareFiles(): boolean {
  try {
    return (
      typeof navigator.canShare === 'function' &&
      navigator.canShare({ files: [new File([new Uint8Array(1)], 'probe.mp4', { type: 'video/mp4' })] })
    );
  } catch {
    return false;
  }
}

const canShareLink = () => typeof navigator.share === 'function';

const button =
  'focus-ring inline-flex min-h-12 items-center gap-2 rounded-full border border-g-ink/20 px-5 font-semibold disabled:opacity-50';

/**
 * Save to Photos (Web Share with the file) and Share (the page link). Rendered only where the
 * browser supports them; the Download button covers everything else.
 */
export function ShareActions({
  file,
  title,
  labels,
}: {
  file: { url: string; mime: string; name: string };
  title: string;
  labels: { save: string; share: string; copied: string };
}) {
  const files = useSyncExternalStore(noop, canShareFiles, () => false);
  const link = useSyncExternalStore(noop, canShareLink, () => false);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const cached = useRef<File | null>(null);

  const save = async () => {
    // With the file already fetched, share synchronously inside the tap: Safari only allows the
    // share sheet during the gesture's user activation, which a long download can outlive.
    if (cached.current) {
      await navigator.share({ files: [cached.current], title }).catch(() => undefined);
      return;
    }
    setBusy(true);
    try {
      const blob = await (await fetch(file.url)).blob();
      cached.current = new File([blob], file.name, { type: file.mime });
      await navigator.share({ files: [cached.current], title });
    } catch {
      // Cancelled, activation expired (the next tap shares at once from the cache), or the fetch
      // failed: the Download button is right there.
    } finally {
      setBusy(false);
    }
  };

  const share = async () => {
    const url = window.location.href;
    if (link) {
      await navigator.share({ url, title }).catch(() => undefined);
      return;
    }
    await navigator.clipboard?.writeText(url).catch(() => undefined);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <>
      {files && (
        <button type="button" className={button} onClick={() => void save()} disabled={busy} aria-busy={busy}>
          <ImageDown className="size-5" aria-hidden /> {labels.save}
        </button>
      )}
      <button type="button" className={button} onClick={() => void share()}>
        <Share2 className="size-5" aria-hidden /> {copied ? labels.copied : labels.share}
      </button>
      <span className="sr-only" aria-live="polite">
        {copied ? labels.copied : ''}
      </span>
    </>
  );
}
