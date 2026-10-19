'use client';

import { useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { Trash2 } from 'lucide-react';
import type { AssetType } from '@immersia/shared';
import { Button, EmptyState, IconButton, Modal, Segmented, TextInput } from '@immersia/ui';
import { AssetPreview } from '@/components/assets/AssetPreview';
import { describeAsset } from '@/components/assets/asset-meta';
import { ASSET_GROUPS, ASSET_GROUP_ORDER, type AssetGroupId } from '@/components/assets/groups';
import { DropArea, UploadBar, UploadList } from '@/components/assets/UploadControls';
import { useAssetUploads } from '@/components/assets/useAssetUploads';
import type { AssetUsage, AssetView } from '@/server/assets';
import { useCan } from '../operator-context';
import { deleteAssetAction, renameAssetAction } from './actions';

/** Click the name to edit it in place: Enter or leaving the field saves, Escape cancels. */
function AssetName({
  asset,
  editable,
  onRename,
}: {
  asset: AssetView;
  editable: boolean;
  onRename: (asset: AssetView, name: string) => void;
}) {
  const t = useTranslations('studio.assets');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const trigger = useRef<HTMLButtonElement>(null);
  // Enter then the blur that follows it (or Escape then blur) must save or cancel only once.
  const settled = useRef(false);

  if (!editable)
    return (
      <p className="truncate text-sm font-medium" title={asset.name}>
        {asset.name}
      </p>
    );

  const finish = (save: boolean, refocus: boolean) => {
    if (settled.current) return;
    settled.current = true;
    setEditing(false);
    const name = draft.trim();
    if (save && name && name !== asset.name) onRename(asset, name);
    if (refocus) requestAnimationFrame(() => trigger.current?.focus());
  };

  if (!editing)
    return (
      <button
        ref={trigger}
        type="button"
        title={asset.name}
        aria-label={t('renameNamed', { name: asset.name })}
        onClick={() => {
          settled.current = false;
          setDraft(asset.name);
          setEditing(true);
        }}
        className="focus-ring block max-w-full truncate rounded text-left text-sm font-medium hover:underline"
      >
        {asset.name}
      </button>
    );

  return (
    <div
      onBlur={() => finish(true, false)}
      onKeyDown={(e) => {
        if (e.key === 'Escape') finish(false, true);
      }}
    >
      <TextInput
        value={draft}
        onChange={(v) => setDraft(v.slice(0, 120))}
        onEnter={() => finish(true, true)}
        autoFocus
        ariaLabel={t('renameLabel')}
        className="h-8"
      />
    </div>
  );
}

/** Screen 8: the organization's overlays, intros, music, fonts, logos and backgrounds. */
export function AssetLibrary({ initial }: { initial: AssetView[] }) {
  const t = useTranslations('studio.assets');
  const locale = useLocale();
  const canCreate = useCan({ asset: ['create'] });
  const canDelete = useCan({ asset: ['delete'] });

  const [assets, setAssets] = useState(initial);
  // A fresh list from the server (after a revalidation) replaces ours: it is the source of truth.
  const [seen, setSeen] = useState(initial);
  if (seen !== initial) {
    setSeen(initial);
    setAssets(initial);
  }

  const [groupId, setGroupId] = useState<AssetGroupId>('overlays');
  const [uploadTypes, setUploadTypes] = useState<Partial<Record<AssetGroupId, AssetType>>>({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [deleting, setDeleting] = useState<AssetView | null>(null);
  const [usedBy, setUsedBy] = useState<AssetUsage[] | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const group = ASSET_GROUPS[groupId];
  const uploadType = uploadTypes[groupId] ?? group.types[0];
  const visible = assets.filter((a) => group.types.includes(a.type));

  const uploads = useAssetUploads((asset) => {
    setAssets((prev) => [asset, ...prev.filter((a) => a.id !== asset.id)]);
    setNotice(t('uploaded', { name: asset.name }));
  });
  const upload = (files: File[], type: AssetType = uploadType) => {
    setError(null);
    uploads.start(files, type);
  };

  const rename = async (asset: AssetView, name: string) => {
    setError(null);
    const set = (to: string) => setAssets((prev) => prev.map((a) => (a.id === asset.id ? { ...a, name: to } : a)));
    set(name);
    const res = await renameAssetAction(asset.id, name);
    if (!res.ok) {
      set(asset.name);
      setError(t('errors.rename'));
    }
  };

  const openDelete = (asset: AssetView) => {
    setDeleteError(null);
    setUsedBy(null);
    setDeleting(asset);
  };
  const closeDelete = () => setDeleting(null);

  const confirmDelete = () =>
    start(async () => {
      if (!deleting) return;
      const res = await deleteAssetAction(deleting.id);
      if (!res.ok) return setDeleteError(t('errors.delete'));
      if (!res.data.deleted) return setUsedBy(res.data.usedBy);
      setAssets((prev) => prev.filter((a) => a.id !== deleting.id));
      setNotice(t('deleted', { name: deleting.name }));
      closeDelete();
    });

  return (
    <DropArea onFiles={(files) => upload(files)} disabled={!canCreate} label={t('dropActive')} className="space-y-5">
      <Segmented
        label={t('groupsLabel')}
        value={groupId}
        onChange={setGroupId}
        options={ASSET_GROUP_ORDER.map((id) => ({ value: id, label: t(`groups.${id}`) }))}
      />

      {canCreate && (
        <div className="card flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-dashed border-line-strong px-5 py-4">
          <div className="min-w-0 max-w-xl">
            <p className="text-sm font-medium">{t('dropHint')}</p>
            <p className="mt-0.5 text-[13px] leading-relaxed text-faint">{t(`accepts.${groupId}`)}</p>
          </div>
          <UploadBar
            types={group.types}
            type={uploadType}
            onTypeChange={(type) => setUploadTypes((prev) => ({ ...prev, [groupId]: type }))}
            onFiles={upload}
          />
        </div>
      )}

      <UploadList items={uploads.items} onCancel={uploads.cancel} onRetry={uploads.retry} onDismiss={uploads.dismiss} />

      {error && (
        <p role="alert" className="text-sm text-bad">
          {error}
        </p>
      )}

      {visible.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={<group.icon className="size-5" />}
            title={t(`empty.${groupId}.title`)}
            body={t(`empty.${groupId}.body`)}
          />
        </div>
      ) : (
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {visible.map((a) => (
            <li key={a.id} className="card flex flex-col overflow-hidden">
              <AssetPreview asset={a} />
              <div className="flex min-w-0 flex-1 items-start gap-1 border-t border-line px-3.5 py-3">
                <div className="min-w-0 flex-1">
                  <AssetName asset={a} editable={canCreate} onRename={rename} />
                  <p className="tabular mt-0.5 text-[12px] leading-relaxed text-faint">
                    {describeAsset(a, locale, group.types.length > 1 ? t(`types.${a.type}`) : undefined)}
                  </p>
                </div>
                {canDelete && (
                  <IconButton
                    label={t('deleteNamed', { name: a.name })}
                    className="-mt-1 -mr-1.5 shrink-0"
                    onClick={() => openDelete(a)}
                  >
                    <Trash2 className="size-4" />
                  </IconButton>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <p role="status" className="sr-only">
        {notice}
      </p>

      <Modal
        open={Boolean(deleting)}
        onClose={closeDelete}
        title={
          usedBy ? t('usedTitle', { name: deleting?.name ?? '' }) : t('deleteTitle', { name: deleting?.name ?? '' })
        }
      >
        <div className="space-y-4 p-6">
          <p className="text-sm leading-relaxed text-muted">{usedBy ? t('usedBody') : t('deleteBody')}</p>
          {usedBy && (
            <ul className="divide-y divide-line rounded-[10px] border border-line">
              {usedBy.map((u) => (
                <li key={`${u.kind}:${u.id}`} className="px-3.5 py-2.5 text-sm">
                  {u.kind === 'event' ? (
                    <Link href={`/studio/events/${u.id}/setup`} className="font-medium text-accent hover:underline">
                      {u.name}
                    </Link>
                  ) : (
                    t('usedByTemplate', { name: u.name })
                  )}
                </li>
              ))}
            </ul>
          )}
          {deleteError && (
            <p role="alert" className="text-sm text-bad">
              {deleteError}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={closeDelete}>
              {usedBy ? t('close') : t('cancel')}
            </Button>
            {!usedBy && (
              <Button variant="danger" onClick={confirmDelete} disabled={pending}>
                {t('delete')}
              </Button>
            )}
          </div>
        </div>
      </Modal>
    </DropArea>
  );
}
