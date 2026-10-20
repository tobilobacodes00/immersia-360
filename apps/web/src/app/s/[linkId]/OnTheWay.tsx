'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

/**
 * "Your files are on their way" (DL-1): the QR exists before the upload does, so the page waits and
 * re-renders on the server as files land. Polls a tiny status endpoint, backing off from 3 s to
 * 15 s, and pauses while the tab is hidden.
 */
export function OnTheWay({ linkId, ready, compact }: { linkId: string; ready: number; compact?: boolean }) {
  const t = useTranslations('share');
  const router = useRouter();

  useEffect(() => {
    let delay = 3000;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    const poll = async () => {
      if (stopped) return;
      if (document.visibilityState === 'visible') {
        try {
          const res = await fetch(`/api/share/${linkId}`, { cache: 'no-store' });
          if (res.ok) {
            const s = (await res.json()) as { state: string; ready: number };
            if (s.ready > ready || s.state === 'expired' || s.state === 'erased') return router.refresh();
          }
        } catch {
          // Offline for a moment: try again on the next tick.
        }
      }
      delay = Math.min(15_000, Math.round(delay * 1.3));
      timer = setTimeout(poll, delay);
    };
    timer = setTimeout(poll, delay);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [linkId, ready, router]);

  if (compact)
    return (
      <p role="status" className="flex items-center gap-2 text-sm opacity-70">
        <span className="size-2 animate-pulse rounded-full bg-current motion-reduce:animate-none" aria-hidden />
        {t('uploading')}
      </p>
    );
  return (
    <div role="status">
      <span
        className="mb-5 block size-3 animate-pulse rounded-full bg-g-accent motion-reduce:animate-none"
        aria-hidden
      />
      <h1 className="text-[clamp(1.9rem,6vw,2.75rem)] leading-tight font-bold tracking-[-0.03em]">{t('onTheWay')}</h1>
      <p className="mt-3 opacity-70">{t('onTheWayBody')}</p>
    </div>
  );
}
