'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { ImageIcon, Music, Trash2, type LucideIcon } from 'lucide-react';
import { Button, IconButton } from '@immersia/ui';
import { AssetPicker } from '@/components/assets/AssetPicker';
import type { AssetView } from '@/server/assets';

const formatSeconds = (ms: number | null) => (ms === null ? '' : `${(ms / 1000).toFixed(1)} s`);

function Preview({ asset }: { asset: AssetView }) {
  if (asset.mime.startsWith('image/'))
    // eslint-disable-next-line @next/next/no-img-element -- signed, short-lived storage URLs: no image optimisation
    return <img src={asset.url} alt="" className="size-16 shrink-0 rounded-lg bg-sunken object-contain" />;
  if (asset.mime.startsWith('video/'))
    return (
      <video
        src={asset.url}
        muted
        playsInline
        preload="metadata"
        className="size-16 shrink-0 rounded-lg bg-sunken object-cover"
        aria-hidden
      />
    );
  return (
    <span className="grid size-16 shrink-0 place-items-center rounded-lg bg-sunken" aria-hidden>
      <Music className="size-5 text-muted" />
    </span>
  );
}

/** One media reference (logo, intro, outro, music, attract background): pick, replace, remove. */
export function MediaSlot({
  label,
  help,
  types,
  asset,
  onPick,
  onRemove,
  readOnly,
  icon: Icon = ImageIcon,
  accept,
}: {
  label: string;
  help?: string;
  types: AssetView['type'][];
  asset: AssetView | null;
  onPick: (a: AssetView) => void;
  onRemove: () => void;
  readOnly: boolean;
  icon?: LucideIcon;
  /** Narrows the picker beyond `types` (see AssetPicker). */
  accept?: (a: AssetView) => boolean;
}) {
  const t = useTranslations('studio.branding.media');
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col gap-3 py-3.5 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <div className="text-sm font-medium">{label}</div>
        {help && <p className="mt-1 max-w-prose text-[13px] leading-relaxed text-faint">{help}</p>}
      </div>
      <div className="flex min-w-0 items-center gap-3">
        {asset ? (
          <>
            <Preview asset={asset} />
            <div className="min-w-0">
              <div className="max-w-48 truncate text-[13px] font-medium">{asset.name}</div>
              <div className="text-[12px] text-faint">
                {asset.durationMs !== null
                  ? formatSeconds(asset.durationMs)
                  : asset.width
                    ? `${asset.width} × ${asset.height}`
                    : ''}
              </div>
            </div>
          </>
        ) : (
          <span
            className="grid size-16 shrink-0 place-items-center rounded-lg border border-dashed border-line-strong"
            aria-hidden
          >
            <Icon className="size-5 text-subtle" />
          </span>
        )}
        {!readOnly && (
          <div className="flex shrink-0 items-center gap-1">
            <Button size="sm" onClick={() => setOpen(true)}>
              {asset ? t('replace') : t('choose')}
            </Button>
            {asset && (
              <IconButton label={t('remove', { name: label })} onClick={onRemove}>
                <Trash2 className="size-4" aria-hidden />
              </IconButton>
            )}
          </div>
        )}
      </div>
      <AssetPicker
        open={open}
        onClose={() => setOpen(false)}
        types={types}
        accept={accept}
        selectedId={asset?.id ?? null}
        title={label}
        onPick={(a) => {
          setOpen(false);
          onPick(a);
        }}
      />
    </div>
  );
}
