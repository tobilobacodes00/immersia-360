'use client';

import { useRef, useState, type DragEvent, type ReactNode } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Upload } from 'lucide-react';
import type { AssetType } from '@immersia/shared';
import { Button, Segmented, cx } from '@immersia/ui';
import type { AssetUploadErrorCode } from '@/lib/asset-upload';
import { formatBytes, formatSpan } from '@/lib/format';
import { acceptFor } from './groups';
import type { UploadItem } from './useAssetUploads';

/** The sentence for a failed upload, in the operator's language. */
export function useUploadErrorText() {
  const t = useTranslations('studio.assets.errors');
  const locale = useLocale();
  return ({ code, limit }: { code: AssetUploadErrorCode; limit?: number }): string => {
    switch (code) {
      case 'wrong_type':
        return t('wrongType');
      case 'too_big':
        return limit ? t('tooBig', { max: formatBytes(limit, locale) }) : t('failed');
      case 'too_long':
        return limit ? t('tooLong', { max: formatSpan(limit, locale) }) : t('failed');
      case 'unreadable':
        return t('unreadable');
      case 'quota':
        return t('quota');
      default:
        return t('failed');
    }
  };
}

/** The upload button, with a choice of type when the section holds two (intro or outro, overlay or frame). */
export function UploadBar({
  types,
  type,
  onTypeChange,
  onFiles,
}: {
  types: readonly AssetType[];
  type: AssetType;
  onTypeChange: (type: AssetType) => void;
  onFiles: (files: File[], type: AssetType) => void;
}) {
  const t = useTranslations('studio.assets');
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className="flex flex-wrap items-center gap-3">
      {types.length > 1 && (
        <div className="flex items-center gap-2">
          <span aria-hidden className="text-[13px] text-muted">
            {t('uploadAs')}
          </span>
          <Segmented
            size="sm"
            label={t('uploadAs')}
            value={type}
            onChange={onTypeChange}
            options={types.map((ty) => ({ value: ty, label: t(`types.${ty}`) }))}
          />
        </div>
      )}
      <Button variant="primary" icon={<Upload className="size-4" aria-hidden />} onClick={() => input.current?.click()}>
        {t('upload')}
      </Button>
      <input
        ref={input}
        type="file"
        multiple
        hidden
        accept={acceptFor([type])}
        aria-label={t('upload')}
        onChange={(e) => {
          // Copy before clearing: the list empties with the input, and choosing the same file again must fire.
          const files = Array.from(e.currentTarget.files ?? []);
          e.currentTarget.value = '';
          if (files.length) onFiles(files, type);
        }}
      />
    </div>
  );
}

/** Makes its children a drop target for files from the desktop. */
export function DropArea({
  onFiles,
  disabled,
  label,
  className,
  children,
}: {
  onFiles: (files: File[]) => void;
  disabled?: boolean;
  label: string;
  className?: string;
  children: ReactNode;
}) {
  const [over, setOver] = useState(false);
  const carriesFiles = (e: DragEvent) => Array.from(e.dataTransfer.types).includes('Files');
  return (
    <div
      className={cx('relative', className)}
      onDragEnter={(e) => {
        if (disabled || !carriesFiles(e)) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragOver={(e) => {
        if (disabled || !carriesFiles(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }}
      onDragLeave={(e) => {
        // Moving between children fires leave on the old one: only a real exit ends the highlight.
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false);
      }}
      onDrop={(e) => {
        if (disabled || !carriesFiles(e)) return;
        e.preventDefault();
        setOver(false);
        const files = Array.from(e.dataTransfer.files);
        if (files.length) onFiles(files);
      }}
    >
      {children}
      {over && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 z-20 grid place-items-center rounded-[14px] border-2 border-dashed border-accent bg-accent-soft text-sm font-semibold text-accent"
        >
          {label}
        </div>
      )}
    </div>
  );
}

/** Files on their way: progress and cancel while sending, the reason and retry/dismiss after a failure. */
export function UploadList({
  items,
  onCancel,
  onRetry,
  onDismiss,
}: {
  items: UploadItem[];
  onCancel: (key: number) => void;
  onRetry: (item: UploadItem) => void;
  onDismiss: (key: number) => void;
}) {
  const t = useTranslations('studio.assets');
  const locale = useLocale();
  const errorText = useUploadErrorText();
  if (items.length === 0) return null;
  const percent = new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 });
  return (
    <ul className="card divide-y divide-line">
      {items.map((item) => {
        const pct = Math.round(item.fraction * 100);
        return (
          <li key={item.key} className="flex items-center gap-3 px-4 py-3">
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{item.file.name}</div>
              {item.error ? (
                <p role="alert" className="mt-0.5 text-[13px] text-bad">
                  {errorText(item.error)}
                </p>
              ) : (
                <div className="mt-1.5 flex items-center gap-3">
                  <div
                    role="progressbar"
                    aria-label={item.file.name}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={pct}
                    className="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-sunken"
                  >
                    <div className="h-full bg-accent transition-[width] duration-150" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="tabular w-24 shrink-0 text-right text-[12px] text-faint">
                    {item.fraction <= 0
                      ? t('progress.checking')
                      : item.fraction >= 1
                        ? t('progress.finishing')
                        : t('progress.uploading', { percent: percent.format(item.fraction) })}
                  </span>
                </div>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {item.error ? (
                <>
                  {item.error.code === 'failed' && (
                    <Button
                      size="sm"
                      variant="secondary"
                      aria-label={`${t('retry')} ${item.file.name}`}
                      onClick={() => onRetry(item)}
                    >
                      {t('retry')}
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`${t('dismiss')} ${item.file.name}`}
                    onClick={() => onDismiss(item.key)}
                  >
                    {t('dismiss')}
                  </Button>
                </>
              ) : (
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`${t('cancel')} ${item.file.name}`}
                  onClick={() => onCancel(item.key)}
                >
                  {t('cancel')}
                </Button>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
