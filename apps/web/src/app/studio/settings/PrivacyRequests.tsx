'use client';

import { useId, useState, useTransition } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { formatShortCode } from '@immersia/shared';
import { Button, Modal, TextInput } from '@immersia/ui';
import { erasePersonAction, findPersonAction, type PersonView } from '../guest-actions';

/**
 * "Find and delete a person's data": a guest asked, by email, for everything to go. Search first
 * (nothing is changed by searching), then delete with an explicit confirmation. Optionally their
 * sessions go too: files, gallery and Live Display entries, and the link says "deleted at your request".
 */
export function PrivacyRequests() {
  const t = useTranslations('studio.settings.requests');
  const tg = useTranslations('studio.guests');
  const format = useFormatter();
  const inputId = useId();
  const [email, setEmail] = useState('');
  const [person, setPerson] = useState<PersonView | null>(null);
  const [withSessions, setWithSessions] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  const errorText = (error: string) =>
    error === 'invalid'
      ? t('errors.invalid')
      : error === 'conflict'
        ? t('errors.tooMany')
        : error === 'forbidden'
          ? t('forbidden')
          : t('errors.failed');

  const find = () =>
    start(async () => {
      setMessage(null);
      setPerson(null);
      setWithSessions(false);
      const res = await findPersonAction(email);
      if (!res.ok) return setMessage({ ok: false, text: errorText(res.error) });
      setPerson(res.data);
    });

  const erase = () =>
    start(async () => {
      if (!person) return;
      const res = await erasePersonAction(person.email, withSessions);
      setConfirming(false);
      if (!res.ok) return setMessage({ ok: false, text: errorText(res.error) });
      setMessage({ ok: true, text: t('done', res.data) });
      setPerson(null);
      setEmail('');
    });

  return (
    <div className="space-y-4 py-4">
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (email.trim()) find();
        }}
      >
        <div className="min-w-0 flex-1 basis-64">
          <label htmlFor={inputId} className="block text-sm font-medium">
            {t('emailLabel')}
          </label>
          <TextInput
            id={inputId}
            type="email"
            value={email}
            onChange={setEmail}
            placeholder={t('emailPlaceholder')}
            autoComplete="off"
            className="mt-1.5"
          />
        </div>
        <Button type="submit" disabled={pending || !email.trim()}>
          {t('find')}
        </Button>
      </form>

      {message && (
        <p role={message.ok ? 'status' : 'alert'} className={message.ok ? 'text-sm text-ok' : 'text-sm text-bad'}>
          {message.text}
        </p>
      )}

      {person &&
        (person.contacts.length === 0 ? (
          <p role="status" className="text-sm text-muted">
            {t('none', { email: person.email })}
          </p>
        ) : (
          <div className="space-y-4">
            <p role="status" className="text-sm">
              {t('found', { contacts: person.contacts.length, email: person.email, sessions: person.sessions })}
            </p>
            <ul className="divide-y divide-line rounded-[10px] border border-line text-sm">
              {person.contacts.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-2.5">
                  <span className="font-medium">{c.eventName}</span>
                  <span className="text-[13px] text-muted">
                    {c.sessionCode ? tg('session', { code: formatShortCode(c.sessionCode) }) : tg('gallery')} ·{' '}
                    {format.dateTime(new Date(c.consentAt), { dateStyle: 'medium' })}
                  </span>
                </li>
              ))}
            </ul>
            {person.sessions > 0 && (
              <label className="flex items-start gap-3 text-sm leading-relaxed">
                <input
                  type="checkbox"
                  checked={withSessions}
                  onChange={(e) => setWithSessions(e.target.checked)}
                  className="focus-ring mt-0.5 size-4 shrink-0 accent-accent"
                />
                <span>{t('withSessions')}</span>
              </label>
            )}
            <Button variant="danger" onClick={() => setConfirming(true)} disabled={pending}>
              {t('deleteButton')}
            </Button>
            <Modal
              open={confirming}
              onClose={() => setConfirming(false)}
              title={t('confirmTitle', { email: person.email })}
            >
              <div className="space-y-4 p-6">
                <p className="text-sm leading-relaxed text-muted">
                  {withSessions ? t('confirmBodySessions') : t('confirmBody')}
                </p>
                <div className="flex justify-end gap-2">
                  <Button variant="ghost" onClick={() => setConfirming(false)}>
                    {t('cancel')}
                  </Button>
                  <Button variant="danger" onClick={erase} disabled={pending}>
                    {t('confirm')}
                  </Button>
                </div>
              </div>
            </Modal>
          </div>
        ))}
    </div>
  );
}
