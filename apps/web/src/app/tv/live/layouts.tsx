'use client';

import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { motion, useReducedMotion } from 'motion/react';
import type { DisplayItem } from '@immersia/shared';
import { formatShortCode } from '@immersia/shared/ids';
import { cx } from '@immersia/ui';
import { displayFontClass } from '@immersia/ui/guest';
import { AnimatedCount, Centrepiece, JustInBadge, Rail } from './chrome';
import { useDisplay } from './context';
import { PlayedMedia, Stage } from './MediaView';
import { mosaicPlan, mosaicTiles, stripItems } from './playback';
import { useElementSize } from './use-tv';

/**
 * The four layouts (LIV-3). Spotlight, Mosaic and Ticker share a frame: media on one side, a rail
 * on the other that holds the event QR in its corner (LIV-5), the item's own QR and code (LIV-4)
 * and the branding (LIV-9). Counter and idle are a branded centrepiece.
 */
function Frame({ children }: { children: ReactNode }) {
  const { current } = useDisplay();
  return (
    <div className="absolute inset-0 flex landscape:flex-row portrait:flex-col">
      <Rail item={current} />
      <main className="order-2 min-h-0 min-w-0 flex-1 p-[1.5rem]">{children}</main>
    </div>
  );
}

/** LIV-3 Spotlight: one item full screen, its QR and code beside it, newest first. */
export function Spotlight() {
  const { current, playId } = useDisplay();
  return (
    <Frame>
      <Stage item={current} playId={playId} className="size-full" />
    </Frame>
  );
}

/** LIV-3 Ticker: Spotlight plus a strip of recent items and a "just in" badge. */
export function Ticker() {
  const { current, playId, currentJustIn, items, justIn } = useDisplay();
  const t = useTranslations('tv.display');
  return (
    <Frame>
      <div className="flex size-full flex-col gap-[1rem]">
        <Stage
          item={current}
          playId={playId}
          className="min-h-0 flex-1"
          badge={currentJustIn && <JustInBadge className="absolute top-[1.25rem] left-[1.25rem]" />}
        />
        <ul className="flex h-[9rem] shrink-0 gap-[0.75rem] overflow-hidden" aria-label={t('recent')}>
          {stripItems(items).map((item) => (
            <Thumb key={item.id} item={item} current={item.id === current?.id} justIn={justIn(item.id)} />
          ))}
        </ul>
      </div>
    </Frame>
  );
}

function Thumb({ item, current, justIn }: { item: DisplayItem; current: boolean; justIn: boolean }) {
  // A strip of thumbnails keeps its height; the width follows the media, within reason.
  const aspect = Math.min(1.8, Math.max(0.45, item.media.width / item.media.height));
  return (
    <li
      style={{ aspectRatio: aspect }}
      className={cx(
        'relative h-full shrink-0 overflow-hidden rounded-[0.9rem] bg-g-ink',
        current && 'ring-[0.3rem] ring-g-accent ring-offset-[0.2rem] ring-offset-g-bg',
      )}
    >
      <PlayedMedia item={item} fit="cover" playing={false} />
      {justIn && <JustInBadge className="absolute top-[0.5rem] left-[0.5rem] px-[0.7rem] py-[0.2rem] text-[0.75rem]" />}
    </li>
  );
}

/** LIV-3 Mosaic: six to twelve items playing muted, the one in turn enlarged with its QR. */
export function Mosaic() {
  const { current, playId, currentJustIn, items } = useDisplay();
  const [measure, size] = useElementSize<HTMLDivElement>();
  const plan = mosaicPlan(items.length, size.h > size.w);
  const tiles = mosaicTiles(items, current?.id ?? null, plan.tiles);
  return (
    <Frame>
      <div
        ref={measure}
        className="grid size-full gap-[0.75rem]"
        style={{ gridTemplateColumns: plan.columns, gridTemplateRows: plan.rows }}
      >
        <div
          className="relative min-h-0 min-w-0"
          style={{ gridColumn: `span ${plan.bigColumns}`, gridRow: `span ${plan.bigRows}` }}
        >
          <Stage
            item={current}
            playId={playId}
            className="size-full"
            badge={currentJustIn && <JustInBadge className="absolute top-[1.25rem] left-[1.25rem]" />}
          />
        </div>
        {tiles.map((item) => (
          <Tile key={item.id} item={item} />
        ))}
      </div>
    </Frame>
  );
}

function Tile({ item }: { item: DisplayItem }) {
  const reduced = useReducedMotion();
  return (
    <motion.figure
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: reduced ? 0 : 0.5 }}
      className="relative m-0 min-h-0 min-w-0 overflow-hidden rounded-[1rem] bg-g-ink"
    >
      <PlayedMedia item={item} fit="cover" />
      {/* LIV-4: every item shows its code; the QR goes to whichever one is enlarged. */}
      <figcaption className="absolute bottom-[0.6rem] left-[0.6rem] rounded-full bg-g-bg px-[0.7rem] py-[0.2rem] font-mono text-[0.85rem] font-bold tracking-[0.1em] text-g-ink">
        {formatShortCode(item.shortCode)}
      </figcaption>
    </motion.figure>
  );
}

/** LIV-3 Counter: the event logo, how many moments have been captured, and the event QR. */
export function Counter() {
  const { config } = useDisplay();
  const t = useTranslations('tv.display');
  const { moments, theme } = config.event;
  return (
    <Centrepiece>
      <div className="flex flex-col gap-[0.5rem] rounded-[1.25rem] bg-g-bg px-[2.25rem] py-[1.5rem]">
        <p className={cx(displayFontClass(theme.font), 'text-[clamp(6rem,24vmin,18rem)] leading-[0.9]')}>
          <AnimatedCount value={moments} />
        </p>
        <p className="text-[1.75rem] font-medium text-g-ink/75">{t('moments', { count: moments })}</p>
      </div>
    </Centrepiece>
  );
}

/** Nothing to play yet, or Live Display is off: branded, calm, never an error. */
export function Idle() {
  const { config } = useDisplay();
  const t = useTranslations('tv.display');
  return (
    <Centrepiece>
      {config.event.live && (
        <p className="max-w-[30rem] rounded-[1.25rem] bg-g-bg px-[1.75rem] py-[1.25rem] text-[1.6rem] leading-snug text-g-ink/80">
          {t('idleLive')}
        </p>
      )}
    </Centrepiece>
  );
}
