'use client';

import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { FolderOpen, Search } from 'lucide-react';
import type { AssetType } from '@immersia/shared';
import { EmptyState, Modal, Pill, TextInput, cx } from '@immersia/ui';
import { listAssetsAction } from '@/app/studio/assets/actions';
import { useCan } from '@/app/studio/operator-context';
import type { AssetView } from '@/server/assets';
import { describeAsset } from './asset-meta';
import { AssetPreview } from './AssetPreview';
import { DropArea, UploadBar, UploadList } from './UploadControls';
import { useAssetUploads } from './useAssetUploads';

export { AssetPreview };

export interface AssetPickerProps {
  open: boolean;
  onClose: () => void;
  /** Which kinds of asset the slot accepts. Uploading from the picker offers the same kinds. */
  types: AssetType[];
  /** Called with the chosen asset. The picker stays open: close it from here if the pick is final. */
  onPick: (asset: AssetView) => void;
  selectedId?: string | null;
  title?: string;
}

type Load = { status: 'loading' } | { status: 'error' } | { status: 'ready'; assets: AssetView[] };

const ARROWS: Record<string, 'left' | 'right' | 'up' | 'down'> = {
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowUp: 'up',
  ArrowDown: 'down',
};

/** Arrow keys move between cards by where they are on screen, whatever the number of columns. */
function moveFocus(e: KeyboardEvent<HTMLUListElement>) {
  const direction = ARROWS[e.key];
  if (!direction) return;
  const picks = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('[data-pick]'));
  const from = picks.findIndex((b) => b === document.activeElement);
  if (from < 0) return;
  const box = (b: HTMLElement) => (b.closest('li') ?? b).getBoundingClientRect();
  const here = box(picks[from]!);
  let target: HTMLButtonElement | undefined;
  if (direction === 'left' || direction === 'right') {
    target = picks[from + (direction === 'right' ? 1 : -1)];
  } else {
    const down = direction === 'down';
    const beyond = picks.filter((b) => (down ? box(b).top >= here.bottom - 1 : box(b).bottom <= here.top + 1));
    // The nearest row in that direction, then the card in it closest to this one's column.
    const rowTop = (down ? Math.min : Math.max)(...beyond.map((b) => box(b).top));
    const centre = here.left + here.width / 2;
    target = beyond
      .filter((b) => box(b).top === rowTop)
      .sort(
        (a, b) => Math.abs(box(a).left + box(a).width / 2 - centre) - Math.abs(box(b).left + box(b).width / 2 - centre),
      )[0];
  }
  if (!target) return;
  e.preventDefault();
  target.focus();
}

function PickerBody({
  types,
  onPick,
  selectedId,
}: {
  types: AssetType[];
  onPick: (asset: AssetView) => void;
  selectedId: string | null;
}) {
  const t = useTranslations('studio.assets');
  const locale = useLocale();
  const canCreate = useCan({ asset: ['create'] });
  // Fixed for this open: the parent may pass a fresh array on every render.
  const [accepted] = useState(types);
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [query, setQuery] = useState('');
  const [uploadType, setUploadType] = useState<AssetType | undefined>(accepted[0]);

  useEffect(() => {
    let cancelled = false;
    listAssetsAction(accepted).then(
      (res) => !cancelled && setLoad(res.ok ? { status: 'ready', assets: res.data } : { status: 'error' }),
      () => !cancelled && setLoad({ status: 'error' }),
    );
    return () => {
      cancelled = true;
    };
  }, [accepted]);

  const uploads = useAssetUploads((asset) =>
    setLoad((prev) =>
      prev.status === 'ready'
        ? { status: 'ready', assets: [asset, ...prev.assets.filter((a) => a.id !== asset.id)] }
        : prev,
    ),
  );
  const upload = (files: File[], type = uploadType) => {
    if (type) uploads.start(files, type);
  };

  const needle = query.trim().toLowerCase();
  const assets =
    load.status === 'ready' ? load.assets.filter((a) => !needle || a.name.toLowerCase().includes(needle)) : [];
  const showType = accepted.length > 1;

  return (
    <DropArea
      onFiles={(files) => upload(files)}
      disabled={!canCreate}
      label={t('dropActive')}
      className="space-y-4 p-6"
    >
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[200px] flex-1">
          <Search
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-faint"
            aria-hidden
          />
          <TextInput
            value={query}
            onChange={setQuery}
            ariaLabel={t('picker.search')}
            placeholder={t('picker.search')}
            className="pl-9"
          />
        </div>
        {canCreate && uploadType && (
          <UploadBar types={accepted} type={uploadType} onTypeChange={setUploadType} onFiles={upload} />
        )}
      </div>

      <UploadList items={uploads.items} onCancel={uploads.cancel} onRetry={uploads.retry} onDismiss={uploads.dismiss} />

      {load.status === 'loading' && (
        <p role="status" className="py-12 text-center text-sm text-muted">
          {t('picker.loading')}
        </p>
      )}
      {load.status === 'error' && (
        <p role="alert" className="py-12 text-center text-sm text-bad">
          {t('errors.load')}
        </p>
      )}
      {load.status === 'ready' && assets.length === 0 && (
        <div className="card">
          <EmptyState
            icon={<FolderOpen className="size-5" />}
            title={load.assets.length === 0 ? t('picker.emptyTitle') : t('picker.noMatchTitle')}
            body={load.assets.length === 0 ? t('picker.emptyBody') : t('picker.noMatchBody')}
          />
        </div>
      )}
      {assets.length > 0 && (
        <ul onKeyDown={moveFocus} className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {assets.map((a) => {
            const selected = a.id === selectedId;
            return (
              <li
                key={a.id}
                className={cx(
                  'card relative flex flex-col overflow-hidden transition-shadow focus-within:ring-2 focus-within:ring-accent',
                  selected && 'ring-2 ring-accent',
                )}
              >
                <AssetPreview asset={a} />
                <div className="border-t border-line px-3 py-2.5">
                  {/* The card is one big target: the button's pseudo-element covers it, the play control sits above. */}
                  <button
                    type="button"
                    data-pick
                    aria-current={selected ? 'true' : undefined}
                    onClick={() => onPick(a)}
                    className="block max-w-full truncate rounded text-left text-sm font-medium outline-none after:absolute after:inset-0"
                  >
                    {a.name}
                  </button>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="tabular text-[12px] text-faint">
                      {describeAsset(a, locale, showType ? t(`types.${a.type}`) : undefined)}
                    </span>
                    {selected && <Pill tone="accent">{t('picker.selected')}</Pill>}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </DropArea>
  );
}

/**
 * Choose a library asset for a slot (a logo, a music track, an overlay): searchable, with upload
 * built in. The cards are buttons, so Tab, the arrow keys and Enter all work.
 */
export function AssetPicker({ open, onClose, types, onPick, selectedId, title }: AssetPickerProps) {
  const t = useTranslations('studio.assets');
  return (
    <Modal open={open} onClose={onClose} title={title ?? t('picker.title')} width="max-w-3xl">
      {/* Mounted while open, so the list is fetched fresh each time (and its signed URLs are new). */}
      <PickerBody key={types.join(',')} types={types} onPick={onPick} selectedId={selectedId ?? null} />
    </Modal>
  );
}
