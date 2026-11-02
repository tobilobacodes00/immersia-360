'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { AnimatePresence, motion } from 'motion/react';
import { Search, X } from 'lucide-react';
import {
  SHORT_CODE_ALPHABET,
  formatShortCode,
  guestThemeVars,
  type DisplayItem,
  type EventTheme,
} from '@immersia/shared';
import { QrCode, cx } from '@immersia/ui';
import { GuestButton, Headline, fade } from '@immersia/ui/guest';
import { useLiveFeed } from '@/lib/live-feed';
import { useWakeLock } from '@/app/booth/[eventId]/booth-hooks';
import { KioskLockLayer, useKioskLock } from '@/app/booth/[eventId]/KioskLock';

export interface StationEvent {
  id: string;
  name: string;
  theme: EventTheme;
  hashtag: string;
  kioskPinHash: string | null;
}

/** An enlarged item closes itself after this long without a touch. */
const DETAIL_TIMEOUT_MS = 45_000;

/** The guest's link tagged as reached from the station (DL routes), not from the big screen. */
const stationLink = (item: DisplayItem) => {
  const url = new URL(item.link);
  url.searchParams.set('r', 'station');
  return url.toString();
};

function Media({ item, large }: { item: DisplayItem; large?: boolean }) {
  const cls = cx('size-full', large ? 'object-contain' : 'object-cover');
  if (item.media.type === 'video')
    return large ? (
      <video
        src={item.media.url}
        poster={item.media.poster ?? undefined}
        autoPlay
        muted
        loop
        playsInline
        className={cls}
      />
    ) : item.media.poster ? (
      // eslint-disable-next-line @next/next/no-img-element -- signed same-origin media links
      <img src={item.media.poster} alt="" className={cls} />
    ) : (
      <video src={item.media.url} muted playsInline preload="metadata" className={cls} />
    );
  // eslint-disable-next-line @next/next/no-img-element -- signed same-origin media links (GIFs animate)
  return <img src={item.media.url} alt="" className={cls} />;
}

/** Screen 16 (SHR-4): the event's newest files; a guest taps theirs and scans its QR. */
export function Station({ event }: { event: StationEvent }) {
  const t = useTranslations('station');
  const kiosk = useKioskLock(event.kioskPinHash);
  const [started, setStarted] = useState(false);
  const [open, setOpen] = useState<DisplayItem | null>(null);
  const [touched, setTouched] = useState(0);
  const [code, setCode] = useState('');
  const { items, connection } = useLiveFeed({
    url: `/api/live/events/${event.id}/feed?role=station`,
    cacheKey: `immersia.station.${event.id}`,
  });
  useWakeLock(started);

  // Guest screens are rem-scaled to the display and locked against scroll and zoom gestures.
  useEffect(() => {
    document.documentElement.classList.add('booth-active');
    return () => document.documentElement.classList.remove('booth-active');
  }, []);

  // An enlarged item goes back to the grid when left alone (the next guest shouldn't see it).
  useEffect(() => {
    if (!open) return;
    const id = setTimeout(() => setOpen(null), DETAIL_TIMEOUT_MS);
    return () => clearTimeout(id);
  }, [open, touched]);

  const shown = useMemo(() => {
    const needle = code.replace(/[^0-9A-Za-z]/g, '').toUpperCase();
    return needle ? items.filter((i) => i.shortCode.startsWith(needle)) : items;
  }, [items, code]);
  // A removed item (hidden by the operator, or its guest opted out) closes if it was open.
  const current = open && items.some((i) => i.id === open.id) ? open : null;

  return (
    <div
      style={guestThemeVars(event.theme)}
      className="fixed inset-0 flex flex-col bg-g-bg text-g-ink"
      onPointerDown={() => setTouched((n) => n + 1)}
    >
      <header className="flex flex-wrap items-end justify-between gap-4 px-[4vmin] pt-[4vmin] pb-[2vmin]">
        <div>
          <Headline font={event.theme.font} className="text-[clamp(2rem,4.5vmin,3.5rem)]">
            {event.name}
          </Headline>
          <p className="mt-1 text-[clamp(1rem,2vmin,1.4rem)] opacity-70">{t('subtitle')}</p>
        </div>
        <label className="flex h-14 w-[min(22rem,80vw)] items-center gap-3 rounded-full border-2 border-g-ink/15 bg-white px-5 text-[#111110]">
          <Search className="size-5 opacity-60" aria-hidden />
          <input
            value={code}
            onChange={(e) =>
              setCode(
                e.target.value
                  .toUpperCase()
                  .split('')
                  .filter((c) => SHORT_CODE_ALPHABET.includes(c))
                  .join('')
                  .slice(0, 6),
              )
            }
            inputMode="text"
            autoCapitalize="characters"
            autoComplete="off"
            aria-label={t('findLabel')}
            placeholder={t('findPlaceholder')}
            className="tabular w-full bg-transparent font-mono text-[1.3rem] tracking-[0.12em] outline-none placeholder:font-sans placeholder:tracking-normal"
          />
          {code && (
            <button
              type="button"
              aria-label={t('clear')}
              onClick={() => setCode('')}
              className="focus-ring rounded-full p-1"
            >
              <X className="size-5" aria-hidden />
            </button>
          )}
        </label>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto px-[4vmin] pb-[4vmin]">
        {shown.length === 0 ? (
          <div className="grid h-full place-items-center text-center">
            <p className="max-w-md text-[clamp(1.1rem,2.4vmin,1.6rem)] opacity-70">
              {code ? t('noMatch') : t('empty')}
            </p>
          </div>
        ) : (
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(13rem,40vw),1fr))] gap-[2vmin]">
            {shown.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => setOpen(item)}
                  className="focus-ring block w-full overflow-hidden rounded-[1rem] bg-black/5 text-left"
                  aria-label={t('open', { code: formatShortCode(item.shortCode) })}
                >
                  <span className="block aspect-[3/4]">
                    <Media item={item} />
                  </span>
                  <span className="tabular block px-3 py-2 font-mono text-[1.05rem] font-semibold tracking-[0.1em]">
                    {formatShortCode(item.shortCode)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </main>

      {connection === 'offline' && (
        <p
          role="status"
          className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-g-ink/80 px-4 py-1.5 text-sm text-g-bg"
        >
          {t('offline')}
        </p>
      )}

      <AnimatePresence>
        {current && (
          <motion.div
            key="detail"
            {...fade}
            role="dialog"
            aria-modal="true"
            aria-label={t('detail', { code: formatShortCode(current.shortCode) })}
            className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-[3vmin] bg-g-bg/95 p-[4vmin] landscape:flex-row"
          >
            <div className="h-[min(70vh,70vw)] max-w-[min(70vw,60vh)] overflow-hidden rounded-[1rem] landscape:h-[80vh]">
              <Media item={current} large />
            </div>
            <div className="flex w-[min(22rem,70vw)] flex-col items-center gap-4 text-center">
              <div className="w-full rounded-[1.5rem] border border-black/10 bg-white p-4">
                <QrCode value={stationLink(current)} label={t('qr')} />
              </div>
              <p className="text-[1.1rem] opacity-70">{t('scan')}</p>
              <p className="tabular font-mono text-[2.25rem] font-bold tracking-[0.14em]">
                {formatShortCode(current.shortCode)}
              </p>
              <GuestButton primary className="min-w-[12rem]" onClick={() => setOpen(null)}>
                {t('close')}
              </GuestButton>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {!started && (
        <div className="absolute inset-0 z-30 grid place-items-center bg-g-bg/90">
          <GuestButton
            primary
            className="min-w-[16rem]"
            onClick={() => {
              setStarted(true);
              void kiosk.enter();
            }}
          >
            {t('start')}
          </GuestButton>
        </div>
      )}

      <KioskLockLayer eventId={event.id} pinHash={event.kioskPinHash} kiosk={kiosk} />
    </div>
  );
}
