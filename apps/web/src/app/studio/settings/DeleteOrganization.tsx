'use client';

import { useId, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { Button, Modal, TextInput } from '@immersia/ui';
import { confirmsDeletion, deletionPhrase } from '@/lib/privacy';
import { deleteOrganizationAction } from '../guest-actions';

/** Owner only. Deleting is final, so it asks for the organization's exact name before it enables. */
export function DeleteOrganization({ name }: { name: string }) {
  const t = useTranslations('studio.settings.delete');
  const inputId = useId();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const phrase = deletionPhrase(name);

  const remove = () =>
    start(async () => {
      setError(null);
      // On success the action redirects to the studio (another organization), so nothing returns.
      const res = await deleteOrganizationAction(typed);
      if (res && !res.ok) setError(res.error === 'invalid' ? t('errors.mismatch') : t('errors.failed'));
    });

  return (
    <>
      <Button
        variant="danger"
        onClick={() => {
          setTyped('');
          setError(null);
          setOpen(true);
        }}
      >
        {t('button')}
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title={t('dialogTitle', { name })}>
        <div className="space-y-4 p-6">
          <p className="text-sm leading-relaxed text-muted">{t('dialogBody')}</p>
          <div>
            <label htmlFor={inputId} className="block text-sm font-medium">
              {t('typeLabel', { phrase: `“${phrase}”` })}
            </label>
            <TextInput
              id={inputId}
              value={typed}
              onChange={setTyped}
              autoComplete="off"
              onEnter={() => confirmsDeletion(typed, name) && remove()}
              className="mt-1.5"
            />
          </div>
          {error && (
            <p role="alert" className="text-sm text-bad">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              {t('cancel')}
            </Button>
            <Button variant="danger" onClick={remove} disabled={pending || !confirmsDeletion(typed, name)}>
              {t('confirm')}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
