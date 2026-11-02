'use client';

import { memo } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Check } from 'lucide-react';
import type { TakeStore } from '@immersia/offline';
import { formatShortCode } from '@immersia/shared';
import { Pill, cx, type PillTone } from '@immersia/ui';
import { formatBytes, formatClock } from '@/lib/format';
import { Thumb, type ViewObserver } from './gallery-media';
import { formatWhen, isVideoMime, type GalleryItem, type UploadState } from './gallery-model';

export const UPLOAD_TONE: Record<UploadState, PillTone> = {
  local: 'neutral',
  uploading: 'info',
  uploaded: 'ok',
  failed: 'bad',
};

interface Props {
  item: GalleryItem;
  store: TakeStore | null;
  viewer: ViewObserver;
  /** The booth is capturing: no new pictures are loaded. */
  paused: boolean;
  selecting: boolean;
  selected: boolean;
  onActivate: (id: string) => void;
}

/** One output in the grid: picture, kind, code, time and upload state. */
function CardView({ item, store, viewer, paused, selecting, selected, onActivate }: Props) {
  const t = useTranslations('booth.gallery');
  const locale = useLocale();
  const code = item.shortCode ? formatShortCode(item.shortCode) : null;
  const kind = t(`kinds.${item.kind}`);
  const clip = isVideoMime(item.mime) && item.durationMs > 0 ? `${formatClock(item.durationMs)} · ` : '';
  return (
    <li>
      <button
        type="button"
        role={selecting ? 'checkbox' : undefined}
        aria-checked={selecting ? selected : undefined}
        aria-label={t('card', { kind, code: code ?? t('codePending') })}
        onClick={() => onActivate(item.id)}
        className={cx(
          'focus-ring relative flex w-full flex-col overflow-hidden rounded-[14px] border bg-elev text-left shadow-card transition-[border-color,box-shadow] duration-150',
          selected ? 'border-accent ring-2 ring-accent' : 'border-line hover:border-line-strong',
        )}
      >
        <Thumb item={item} store={store} viewer={viewer} paused={paused}>
          {selecting && (
            <span
              aria-hidden
              className={cx(
                'absolute top-2 left-2 grid size-6 place-items-center rounded-full border-2 transition-colors',
                selected ? 'border-accent bg-accent text-white' : 'border-white bg-black/35 text-transparent',
              )}
            >
              <Check className="size-3.5" strokeWidth={3} />
            </span>
          )}
          <span className="absolute top-2 right-2 rounded-full bg-elev px-2 py-0.5 text-[11px] font-semibold shadow-card">
            {kind}
          </span>
          <span className="absolute bottom-2 left-2 rounded-full bg-elev shadow-card">
            <Pill tone={UPLOAD_TONE[item.upload]}>{t(`upload.${item.upload}`)}</Pill>
          </span>
        </Thumb>
        <span className="flex flex-col gap-0.5 px-3 py-2.5">
          {code ? (
            <span className="tabular font-mono text-[15px] font-bold tracking-[0.08em]">{code}</span>
          ) : (
            <span className="text-[13px] font-medium text-faint">{t('codePending')}</span>
          )}
          <span className="tabular text-[12px] text-muted">
            {clip}
            {formatWhen(item.createdAt, locale)} · {formatBytes(item.bytes, locale)}
          </span>
        </span>
      </button>
    </li>
  );
}

/**
 * The liveQuery hands over fresh objects on every change; a card only redraws when something it
 * shows did, so hundreds of cards stay cheap while uploads tick over.
 */
export const GalleryCard = memo(CardView, (a, b) => {
  const x = a.item;
  const y = b.item;
  return (
    x.id === y.id &&
    x.upload === y.upload &&
    x.shortCode === y.shortCode &&
    x.bytes === y.bytes &&
    x.poster?.path === y.poster?.path &&
    a.store === b.store &&
    a.viewer === b.viewer &&
    a.paused === b.paused &&
    a.selecting === b.selecting &&
    a.selected === b.selected &&
    a.onActivate === b.onActivate
  );
});
