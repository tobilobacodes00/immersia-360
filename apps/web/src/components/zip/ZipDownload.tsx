'use client';

import { useRef, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { Download, X } from 'lucide-react';
import { downloadZip } from 'client-zip';
import { cx } from '@immersia/ui';

interface ZipFile {
  name: string;
  url: string;
  bytes: number | null;
}

type State =
  | { kind: 'idle' }
  | { kind: 'running'; files: number; bytes: number }
  | { kind: 'done'; files: number; skipped: number }
  | { kind: 'failed' }
  | { kind: 'cancelled' };

type SavePicker = (opts: {
  suggestedName: string;
  types: { description: string; accept: Record<string, string[]> }[];
}) => Promise<{ createWritable(): Promise<WritableStream<Uint8Array>> }>;

/**
 * A whole event as one ZIP (SHR-5, EVT-4), built in the browser from signed links: the server never
 * zips anything. Pages of links come from `source`; each file streams straight into the archive,
 * and the archive streams to disk where the browser can write files directly, so a multi-gigabyte
 * event never sits in memory.
 */
export function ZipDownload({
  source,
  filename,
  label,
  className,
  primary = false,
}: {
  source: string;
  filename: string;
  label: string;
  className?: string;
  primary?: boolean;
}) {
  const t = useTranslations('zip');
  const format = useFormatter();
  const [state, setState] = useState<State>({ kind: 'idle' });
  const abort = useRef<AbortController | null>(null);

  const start = async () => {
    const controller = new AbortController();
    abort.current = controller;
    const { signal } = controller;
    // Asked first, while the click still counts as a user gesture.
    const picker = (window as unknown as { showSaveFilePicker?: SavePicker }).showSaveFilePicker;
    let target: WritableStream<Uint8Array> | null = null;
    if (picker) {
      try {
        const handle = await picker({
          suggestedName: filename,
          types: [{ description: 'ZIP', accept: { 'application/zip': ['.zip'] } }],
        });
        target = await handle.createWritable();
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return; // the picker was dismissed
        target = null;
      }
    }

    let files = 0;
    let bytes = 0;
    let skipped = 0;
    setState({ kind: 'running', files, bytes });
    async function* entries() {
      let cursor: string | null = null;
      do {
        const res: Response = await fetch(`${source}${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`, {
          signal,
          cache: 'no-store',
        });
        if (!res.ok) throw new Error(`files ${res.status}`);
        const page = (await res.json()) as { files: ZipFile[]; next: string | null };
        for (const f of page.files) {
          const file = await fetch(f.url, { signal }).catch(() => null);
          // An expired or missing file is skipped (and counted), not the whole download.
          if (!file?.ok) {
            skipped++;
            continue;
          }
          files++;
          yield { name: f.name, input: file };
        }
        cursor = page.next;
      } while (cursor);
    }
    let shownAt = 0;
    const counter = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, ctrl) {
        bytes += chunk.byteLength;
        // A few updates a second: per chunk would re-render thousands of times on a big video.
        const now = performance.now();
        if (now - shownAt > 250) {
          shownAt = now;
          setState({ kind: 'running', files, bytes });
        }
        ctrl.enqueue(chunk);
      },
    });
    try {
      const zip = downloadZip(entries()).body!.pipeThrough(counter);
      if (target) await zip.pipeTo(target, { signal });
      else {
        const blob = await new Response(zip).blob();
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = filename;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
      }
      setState({ kind: 'done', files, skipped });
    } catch {
      setState(signal.aborted ? { kind: 'cancelled' } : { kind: 'failed' });
    } finally {
      abort.current = null;
    }
  };

  const size = (n: number) =>
    n >= 1e9
      ? format.number(n / 1e9, { style: 'unit', unit: 'gigabyte', maximumFractionDigits: 1 })
      : format.number(n / 1e6, { style: 'unit', unit: 'megabyte', maximumFractionDigits: 0 });

  return (
    <div className={className}>
      {state.kind === 'running' ? (
        <div className="flex flex-wrap items-center gap-3" role="status" aria-live="polite">
          <span className="text-sm">{t('progress', { files: state.files, size: size(state.bytes) })}</span>
          <button
            type="button"
            onClick={() => abort.current?.abort()}
            className="focus-ring inline-flex min-h-10 items-center gap-1.5 rounded-full border border-current/20 px-4 text-sm font-semibold"
          >
            <X className="size-4" aria-hidden /> {t('cancel')}
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => void start()}
          className={cx(
            'focus-ring inline-flex min-h-11 items-center gap-2 rounded-full px-5 font-semibold',
            primary ? 'bg-g-accent text-g-on-accent' : 'border border-current/20',
          )}
        >
          <Download className="size-4" aria-hidden /> {label}
        </button>
      )}
      <p className="mt-2 text-sm opacity-70" aria-live="polite">
        {state.kind === 'done' && t('done', { files: state.files, skipped: state.skipped })}
        {state.kind === 'failed' && t('failed')}
        {state.kind === 'cancelled' && t('cancelled')}
      </p>
    </div>
  );
}
