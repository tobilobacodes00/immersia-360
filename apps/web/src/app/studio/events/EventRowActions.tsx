'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Archive, ArchiveRestore, Copy } from 'lucide-react';
import { Button, IconButton, Modal, TextInput } from '@immersia/ui';
import { duplicateEventAction, setArchivedAction } from '../actions';
import { useCan } from '../operator-context';

export function EventRowActions({ id, name, archived }: { id: string; name: string; archived: boolean }) {
  const t = useTranslations('studio.events');
  const router = useRouter();
  const canCreate = useCan({ event: ['create'] });
  const canArchive = useCan({ event: ['archive'] });
  const [dupOpen, setDupOpen] = useState(false);
  const [dupName, setDupName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const duplicate = () =>
    start(async () => {
      const res = await duplicateEventAction(id, dupName);
      if (!res.ok) return setError(t('errors.duplicate'));
      setDupOpen(false);
      router.push(`/studio/events/${res.data.id}/setup`);
    });

  const toggleArchive = () =>
    start(async () => {
      const res = await setArchivedAction(id, !archived);
      if (!res.ok) setError(t('errors.archive'));
    });

  return (
    <div className="inline-flex items-center gap-0.5">
      {canCreate && (
        <IconButton
          label={t('duplicate')}
          onClick={() => {
            setDupName(t('copyOf', { name }));
            setError(null);
            setDupOpen(true);
          }}
        >
          <Copy className="size-4" />
        </IconButton>
      )}
      {canArchive && (
        <IconButton label={archived ? t('unarchive') : t('archive')} onClick={toggleArchive} disabled={pending}>
          {archived ? <ArchiveRestore className="size-4" /> : <Archive className="size-4" />}
        </IconButton>
      )}
      {error && !dupOpen && (
        <span role="alert" className="ml-2 text-[12px] text-bad">
          {error}
        </span>
      )}
      <Modal open={dupOpen} onClose={() => setDupOpen(false)} title={t('duplicateTitle')}>
        <form
          className="space-y-4 p-6 text-left"
          onSubmit={(e) => {
            e.preventDefault();
            duplicate();
          }}
        >
          <p className="text-sm text-muted">{t('duplicateBody')}</p>
          <label className="block space-y-2">
            <span className="text-sm font-medium">{t('columns.name')}</span>
            <TextInput value={dupName} onChange={setDupName} required autoFocus />
          </label>
          {error && (
            <p role="alert" className="text-sm text-bad">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setDupOpen(false)}>
              {t('cancel')}
            </Button>
            <Button type="submit" variant="primary" disabled={pending || !dupName.trim()}>
              {t('duplicate')}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
