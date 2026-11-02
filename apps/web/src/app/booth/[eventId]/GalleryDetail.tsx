'use client';

import { useLocale, useTranslations } from 'next-intl';
import { Download } from 'lucide-react';
import type { TakeStore } from '@immersia/offline';
import { formatShortCode, sessionUrl } from '@immersia/shared';
import { Button, Pill, QrCode } from '@immersia/ui';
import { formatBytes, formatClock } from '@/lib/format';
import { UPLOAD_TONE } from './GalleryCard';
import { Preview } from './gallery-media';
import { formatWhen, isVideoMime, outputFilename, type GalleryItem } from './gallery-model';

/**
 * One output, large: the file itself, the guest's QR to reshare (a guest who missed theirs can scan
 * it again), their short code, and a way to save the file to this device.
 */
export function GalleryDetail({
  item,
  store,
  onSave,
  saveFailed,
}: {
  item: GalleryItem;
  store: TakeStore;
  onSave: () => void;
  saveFailed: boolean;
}) {
  const t = useTranslations('booth.gallery');
  const locale = useLocale();
  const kind = t(`kinds.${item.kind}`);
  return (
    <div className="grid gap-6 p-6 md:grid-cols-[minmax(0,1fr)_17.5rem]" style={{ fontSize: 15 }}>
      <div className="flex min-h-48 items-center justify-center rounded-xl bg-sunken p-3">
        <Preview item={item} store={store} label={t('previewAlt', { kind })} />
      </div>

      <div className="flex flex-col gap-5">
        <section aria-labelledby="gallery-reshare" className="flex flex-col items-center gap-3 text-center">
          <h4 id="gallery-reshare" className="eyebrow">
            {t('detail.reshare')}
          </h4>
          {item.linkId ? (
            <>
              <div className="w-44 rounded-2xl border border-line bg-white p-3">
                <QrCode value={sessionUrl(window.location.origin, item.linkId, 'booth')} label={t('detail.qrAlt')} />
              </div>
              <p className="max-w-[16rem] text-[13px] leading-relaxed text-muted">{t('detail.reshareHint')}</p>
            </>
          ) : (
            <p className="text-[13px] text-muted">{t('detail.noLink')}</p>
          )}
          {item.shortCode ? (
            <p className="tabular font-mono text-[28px] leading-none font-bold tracking-[0.14em]">
              {formatShortCode(item.shortCode)}
            </p>
          ) : (
            <p className="text-[13px] font-medium text-faint">{t('codePending')}</p>
          )}
        </section>

        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[13px]">
          <dt className="text-faint">{t('detail.type')}</dt>
          <dd className="text-right">{kind}</dd>
          <dt className="text-faint">{t('detail.status')}</dt>
          <dd className="text-right">
            <Pill tone={UPLOAD_TONE[item.upload]}>{t(`upload.${item.upload}`)}</Pill>
          </dd>
          <dt className="text-faint">{t('detail.made')}</dt>
          <dd className="tabular text-right">{formatWhen(item.createdAt, locale)}</dd>
          <dt className="text-faint">{t('detail.size')}</dt>
          <dd className="tabular text-right">{formatBytes(item.bytes, locale)}</dd>
          {item.width > 0 && (
            <>
              <dt className="text-faint">{t('detail.dimensions')}</dt>
              <dd className="tabular text-right">{t('detail.pixels', { width: item.width, height: item.height })}</dd>
            </>
          )}
          {isVideoMime(item.mime) && item.durationMs > 0 && (
            <>
              <dt className="text-faint">{t('detail.duration')}</dt>
              <dd className="tabular text-right">{formatClock(item.durationMs)}</dd>
            </>
          )}
          <dt className="text-faint">{t('detail.file')}</dt>
          <dd className="text-right font-mono text-[12px] break-all">{outputFilename(item)}</dd>
        </dl>

        <div className="mt-auto flex flex-col gap-2">
          <Button variant="primary" size="lg" icon={<Download className="size-4" aria-hidden />} onClick={onSave}>
            {t('detail.save')}
          </Button>
          {saveFailed && (
            <p role="alert" className="text-[13px] text-bad">
              {t('detail.saveFailed')}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
