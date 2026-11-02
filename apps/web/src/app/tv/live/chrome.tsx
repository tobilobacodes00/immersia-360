'use client';

/* eslint-disable @next/next/no-img-element -- the logo and background come from signed storage links or
   the device's own cache as object URLs: nothing for the image optimiser to do. */

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { animate, motion, useReducedMotion } from 'motion/react';
import { Maximize, Minimize, Volume2, Zap } from 'lucide-react';
import type { DisplayConfig, DisplayItem } from '@immersia/shared';
import { formatShortCode } from '@immersia/shared/ids';
import { QrCode, cx } from '@immersia/ui';
import { Headline } from '@immersia/ui/guest';
import type { LiveConnection } from '@/lib/live-feed';
import { useDisplay } from './context';
import { hashtagLabel } from './playback';
import { useMediaSrc } from './use-media';

type QrSize = DisplayConfig['settings']['qrSize'];
type QrPosition = DisplayConfig['settings']['qrPosition'];

/** QR code widths in rem (the root scales with the screen, so these hold from 720p to 4K). */
const QR_REM = {
  /** The item's own code beside it (LIV-4). */
  item: { s: 9, m: 12, l: 15 },
  /** The persistent event QR in its corner (LIV-5). */
  event: { s: 7, m: 9.5, l: 12.5 },
  /** The event QR as the centrepiece of the Counter and idle screens. */
  centre: { s: 14, m: 18, l: 22 },
} satisfies Record<string, Record<QrSize, number>>;

/** The white QR card (as on the guest result screen), always dark on white so any phone reads it. */
export function QrBlock({
  value,
  label,
  rem,
  fit = '100%',
  caption,
  code,
  note,
  className,
}: {
  value: string;
  label: string;
  rem: number;
  /** An upper bound for the width, as a CSS length. */
  fit?: string;
  caption?: string;
  code?: string;
  note?: string;
  className?: string;
}) {
  return (
    <div
      className={cx('rounded-[1.25rem] bg-white p-[0.9rem] text-center text-[#111110]', className)}
      style={{ width: `min(${rem + 1.8}rem, ${fit})` }}
    >
      <QrCode value={value} label={label} />
      {caption && <div className="mt-[0.6rem] text-[0.85rem] font-bold tracking-[0.14em] uppercase">{caption}</div>}
      {code && <div className="tabular mt-[0.25rem] font-mono text-[1.5rem] font-bold tracking-[0.12em]">{code}</div>}
      {note && <div className="mt-[0.2rem] text-[0.85rem] leading-snug text-black/70">{note}</div>}
    </div>
  );
}

/** Where guests type a short code: the short domain when there is one, else this app's /c. */
function codeEntryHost(): string {
  const short = process.env.NEXT_PUBLIC_SHORT_ORIGIN;
  return short ? new URL(short).host : `${location.host}/c`;
}

/** LIV-9: the event's logo, title and hashtag, on a solid card so they read over any background. */
export function BrandBlock({ hero = false }: { hero?: boolean }) {
  const { event } = useDisplay().config;
  const logo = useMediaSrc(event.logoUrl);
  const tag = hashtagLabel(event.hashtag);
  return (
    <div
      className={cx(
        'flex min-w-0 flex-col items-start rounded-[1.25rem] bg-g-bg',
        hero ? 'gap-[1.5rem] p-[2.25rem]' : 'gap-[0.75rem] p-[1.25rem]',
      )}
    >
      {logo && (
        <img
          src={logo}
          alt=""
          className={cx('w-auto max-w-full object-contain', hero ? 'max-h-[9rem]' : 'max-h-[5rem]')}
        />
      )}
      <Headline
        font={event.theme.font}
        className={cx('max-w-full break-words', hero ? 'text-[clamp(3rem,9vmin,6.5rem)]' : 'text-[2.1rem]')}
      >
        {event.name}
      </Headline>
      {tag && (
        <p
          className={cx(
            'max-w-full rounded-full bg-g-accent font-semibold break-words text-g-on-accent',
            hero ? 'px-[1.5rem] py-[0.6rem] text-[1.8rem]' : 'px-[1rem] py-[0.35rem] text-[1.1rem]',
          )}
        >
          {tag}
        </p>
      )}
    </div>
  );
}

// -----------------------------------------------------------------------------------------------
// The side rail: event QR in its corner, the item's QR and code, the branding (Spotlight, Mosaic, Ticker)

const LANDSCAPE_ORDER = { 1: 'landscape:order-1', 2: 'landscape:order-2', 3: 'landscape:order-3' } as const;
const PORTRAIT_ORDER = { 1: 'portrait:order-1', 2: 'portrait:order-2', 3: 'portrait:order-3' } as const;

/** The rail sits on the corner's side of the screen: left or right on landscape, top or bottom on portrait. */
function railOrder(position: QrPosition): string {
  return cx(
    position.endsWith('left') ? LANDSCAPE_ORDER[1] : LANDSCAPE_ORDER[3],
    position.startsWith('top') ? PORTRAIT_ORDER[1] : PORTRAIT_ORDER[3],
  );
}

function ItemCard({ item }: { item: DisplayItem }) {
  const t = useTranslations('tv.display');
  const reduced = useReducedMotion();
  const { qrSize } = useDisplay().config.settings;
  const code = formatShortCode(item.shortCode);
  return (
    <motion.div
      initial={{ opacity: 0, y: reduced ? 0 : 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: reduced ? 0 : 0.5, ease: [0.16, 1, 0.3, 1] }}
      className="flex w-full justify-center"
    >
      <QrBlock
        value={item.link}
        label={t('itemAlt', { code })}
        rem={QR_REM.item[qrSize]}
        fit="100%"
        caption={t('itemScan')}
        code={code}
        note={t('enterCode', { host: codeEntryHost() })}
      />
    </motion.div>
  );
}

export function Rail({ item }: { item: DisplayItem | null }) {
  const t = useTranslations('tv.display');
  const { config } = useDisplay();
  const { qrPosition, qrSize } = config.settings;
  const top = qrPosition.startsWith('top');
  const left = qrPosition.endsWith('left');
  // The corner QR hugs its corner; the branding takes the opposite end; the item's own code sits between.
  const corner = cx(
    top ? LANDSCAPE_ORDER[1] : LANDSCAPE_ORDER[3],
    left ? PORTRAIT_ORDER[1] : PORTRAIT_ORDER[3],
    left ? 'landscape:justify-start' : 'landscape:justify-end',
  );
  const brand = cx(top ? LANDSCAPE_ORDER[3] : LANDSCAPE_ORDER[1], left ? PORTRAIT_ORDER[3] : PORTRAIT_ORDER[1]);
  return (
    <aside
      className={cx(
        'flex shrink-0 gap-[1.25rem] p-[1.5rem] landscape:w-[26vw] landscape:max-w-[34rem] landscape:min-w-[19rem] landscape:flex-col portrait:flex-row portrait:items-stretch',
        railOrder(qrPosition),
      )}
    >
      <div className={cx('flex min-w-0 portrait:flex-1', corner)}>
        <QrBlock
          value={config.event.galleryUrl}
          label={t('galleryAlt')}
          rem={QR_REM.event[qrSize]}
          caption={t('gallery')}
        />
      </div>
      <div
        className={cx('flex min-h-0 min-w-0 flex-1 items-center justify-center', LANDSCAPE_ORDER[2], PORTRAIT_ORDER[2])}
      >
        {item && <ItemCard key={item.id} item={item} />}
      </div>
      <div className={cx('flex min-w-0 portrait:flex-1', brand)}>
        <BrandBlock />
      </div>
    </aside>
  );
}

/** Ticker: this item arrived while the screen was on. */
export function JustInBadge({ className }: { className?: string }) {
  const t = useTranslations('tv.display');
  return (
    <div
      className={cx(
        'z-10 flex items-center gap-[0.5rem] rounded-full bg-g-accent px-[1.1rem] py-[0.5rem] text-[1.1rem] font-bold tracking-[0.12em] text-g-on-accent uppercase',
        className,
      )}
    >
      <Zap className="size-[1.2rem]" aria-hidden />
      {t('justIn')}
    </div>
  );
}

// -----------------------------------------------------------------------------------------------
// Centrepiece (Counter and idle)

export function Centrepiece({ children }: { children?: ReactNode }) {
  const t = useTranslations('tv.display');
  const { config } = useDisplay();
  return (
    <main className="absolute inset-0 flex items-center justify-center gap-[7vmin] p-[6vmin] landscape:flex-row portrait:flex-col">
      <div className="flex max-w-[52rem] min-w-0 flex-col items-start gap-[2rem] landscape:flex-1">
        <BrandBlock hero />
        {children}
      </div>
      <QrBlock
        value={config.event.galleryUrl}
        label={t('galleryAlt')}
        rem={QR_REM.centre[config.settings.qrSize]}
        fit="44vmin"
        caption={t('galleryScan')}
        className="shrink-0"
      />
    </main>
  );
}

/** Counter: a number that counts up to its new value instead of jumping. */
export function AnimatedCount({ value }: { value: number }) {
  const reduced = useReducedMotion();
  const format = useFormatter();
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    if (reduced || from.current === value) return;
    const controls = animate(from.current, value, {
      duration: 1.2,
      ease: 'easeOut',
      onUpdate: (v) => {
        from.current = v;
        setShown(Math.round(v));
      },
      onComplete: () => {
        from.current = value;
        setShown(value);
      },
    });
    return () => controls.stop();
  }, [value, reduced]);
  return <span className="tabular">{format.number(reduced ? value : shown)}</span>;
}

// -----------------------------------------------------------------------------------------------
// Background (LIV-9)

export function EventBackground() {
  const { background } = useDisplay().config.event;
  const src = useMediaSrc(background?.url ?? null);
  if (!background || !src) return null;
  const classes = 'absolute inset-0 size-full object-cover';
  return background.type === 'video' ? (
    <video src={src} className={classes} muted loop autoPlay playsInline preload="auto" aria-hidden tabIndex={-1} />
  ) : (
    <img src={src} alt="" className={classes} aria-hidden />
  );
}

// -----------------------------------------------------------------------------------------------
// Status and full screen: out of the way unless something just changed or someone is at the screen

const CONNECTION_DOT: Record<LiveConnection, string> = {
  socket: 'bg-ok',
  polling: 'bg-warn',
  offline: 'bg-bad',
};

const PILL = 'inline-flex items-center gap-[0.6rem] rounded-full px-[1.1rem] py-[0.55rem] text-[1.05rem] font-semibold';

export function Controls({
  connection,
  statusVisible,
  controlsVisible,
  soundHint,
  fullscreen,
}: {
  connection: LiveConnection;
  /** A connection change is recent. */
  statusVisible: boolean;
  /** Someone touched the screen or a key. */
  controlsVisible: boolean;
  soundHint: boolean;
  fullscreen: { supported: boolean; active: boolean; toggle: () => void };
}) {
  const t = useTranslations('tv.display');
  const showStatus = statusVisible || controlsVisible;
  const hidden = 'opacity-0 group-focus-within/controls:opacity-100 group-hover/controls:opacity-100';
  return (
    <div className="pointer-events-none absolute inset-x-0 top-[2.5vmin] z-50 flex justify-center">
      <div className="group/controls pointer-events-auto flex items-center gap-[0.75rem]">
        <p
          role="status"
          className={cx(
            PILL,
            'bg-g-ink text-g-bg transition-opacity duration-300',
            showStatus ? 'opacity-100' : hidden,
          )}
        >
          <span className={cx('size-[0.7rem] rounded-full', CONNECTION_DOT[connection])} aria-hidden />
          {t(`status.${connection}`)}
        </p>
        {soundHint && (
          <p
            className={cx(
              PILL,
              'bg-g-ink text-g-bg transition-opacity duration-300',
              showStatus ? 'opacity-100' : hidden,
            )}
          >
            <Volume2 className="size-[1.2rem]" aria-hidden />
            {t('soundHint')}
          </p>
        )}
        {fullscreen.supported && (
          <button
            type="button"
            onClick={fullscreen.toggle}
            className={cx(
              PILL,
              'focus-ring border-2 border-g-ink/25 bg-g-bg text-g-ink transition-opacity duration-300',
              controlsVisible ? 'opacity-100' : hidden,
            )}
          >
            {fullscreen.active ? (
              <Minimize className="size-[1.2rem]" aria-hidden />
            ) : (
              <Maximize className="size-[1.2rem]" aria-hidden />
            )}
            {fullscreen.active ? t('exitFullscreen') : t('fullscreen')}
          </button>
        )}
      </div>
    </div>
  );
}
