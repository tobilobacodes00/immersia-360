'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Trash2 } from 'lucide-react';
import { Button, IconButton, Modal } from '@immersia/ui';
import { deleteAllContactsAction, deleteContactAction } from '../../../guest-actions';

/** Delete one contact (confirmed in a dialog). The guest's photos and videos are not touched. */
export function DeleteContact({ eventId, contactId, email }: { eventId: string; contactId: string; email: string }) {
  const t = useTranslations('studio.guests');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const confirm = () =>
    start(async () => {
      const res = await deleteContactAction(eventId, contactId);
      if (!res.ok) return setError(res.error === 'forbidden' ? t('errors.forbidden') : t('errors.delete'));
      setOpen(false);
      router.refresh();
    });

  return (
    <>
      <IconButton
        label={t('deleteLabel', { email })}
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
      >
        <Trash2 className="size-4" />
      </IconButton>
      <Modal open={open} onClose={() => setOpen(false)} title={t('deleteTitle')}>
        <div className="space-y-4 p-6">
          <p className="text-sm leading-relaxed text-muted">{t('deleteBody', { email })}</p>
          {error && (
            <p role="alert" className="text-sm text-bad">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              {t('cancel')}
            </Button>
            <Button variant="danger" onClick={confirm} disabled={pending}>
              {t('deleteConfirm')}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}

/** Delete every contact of the event (confirmed in a dialog; recorded in the audit log). */
export function DeleteAllContacts({ eventId, count }: { eventId: string; count: number }) {
  const t = useTranslations('studio.guests');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  const confirm = () =>
    start(async () => {
      const res = await deleteAllContactsAction(eventId);
      if (!res.ok) return setMessage({ ok: false, text: t('errors.delete') });
      setOpen(false);
      setMessage({ ok: true, text: t('allDeleted', { count: res.data.count }) });
      router.refresh();
    });

  return (
    <>
      <Button
        variant="danger"
        icon={<Trash2 className="size-4" aria-hidden />}
        disabled={count === 0}
        onClick={() => {
          setMessage(null);
          setOpen(true);
        }}
      >
        {t('deleteAll')}
      </Button>
      {message?.ok && (
        <p role="status" className="text-[13px] text-ok">
          {message.text}
        </p>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title={t('deleteAllTitle', { count })}>
        <div className="space-y-4 p-6">
          <p className="text-sm leading-relaxed text-muted">{t('deleteAllBody')}</p>
          {message && !message.ok && (
            <p role="alert" className="text-sm text-bad">
              {message.text}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              {t('cancel')}
            </Button>
            <Button variant="danger" onClick={confirm} disabled={pending}>
              {t('deleteAllConfirm')}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
