'use client';

import { useActionState, useId } from 'react';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { CheckCircle2 } from 'lucide-react';
import { Button } from '@immersia/ui';
import { submitSupportRequest, type ContactState } from '@/app/help/actions';
import {
  SUPPORT_MESSAGE_MAX,
  SUPPORT_MESSAGE_MIN,
  SUPPORT_RESPONSE_BUSINESS_DAYS,
  SUPPORT_TOPICS,
} from '@/lib/support';

const FIELD =
  'w-full rounded-[10px] border border-line-strong bg-elev px-3 text-sm outline-none transition-colors placeholder:text-faint hover:border-[#c9c6bd] focus:border-accent focus:ring-3 focus:ring-accent-soft aria-[invalid=true]:border-bad';

/**
 * HLP-2 contact form: a server action behind a plain form, so it works before the page has finished
 * loading too. States the response target next to the button, because that is where it is wanted.
 */
export function ContactForm({
  defaults,
  supportAddress,
}: {
  defaults: { name: string; email: string };
  supportAddress: string;
}) {
  const t = useTranslations('help.contact');
  const pathname = usePathname();
  const [state, action, pending] = useActionState<ContactState, FormData>(submitSupportRequest, { status: 'idle' });
  const id = useId();
  const days = SUPPORT_RESPONSE_BUSINESS_DAYS;

  if (state.status === 'sent')
    return (
      <div role="status" className="flex items-start gap-3 rounded-xl border border-ok/25 bg-ok/[0.07] p-5">
        <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-ok" aria-hidden />
        <div>
          <p className="font-semibold">{t('sent.title')}</p>
          <p className="mt-1 text-sm leading-relaxed text-muted">{t('sent.body', { email: state.email, days })}</p>
        </div>
      </div>
    );

  const typed = state.status === 'error' ? state.values : null;
  const invalid = (field: 'email' | 'message') => state.status === 'error' && state.fields.includes(field);
  return (
    <form action={action} className="space-y-4" noValidate>
      {state.status === 'error' && (
        <p role="alert" className="rounded-lg border border-bad/25 bg-bad/[0.05] px-3 py-2 text-sm text-bad">
          {t(`errors.${state.code}`)}
        </p>
      )}
      <input type="hidden" name="page" value={pathname} />
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor={`${id}-name`} className="text-[13px] font-medium">
            {t('name')}
          </label>
          <input
            id={`${id}-name`}
            name="name"
            type="text"
            autoComplete="name"
            defaultValue={typed?.name ?? defaults.name}
            maxLength={100}
            className={`${FIELD} h-10`}
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor={`${id}-email`} className="text-[13px] font-medium">
            {t('email')}
          </label>
          <input
            id={`${id}-email`}
            name="email"
            type="email"
            autoComplete="email"
            required
            defaultValue={typed?.email ?? defaults.email}
            maxLength={200}
            aria-invalid={invalid('email')}
            aria-describedby={invalid('email') ? `${id}-email-error` : undefined}
            className={`${FIELD} h-10`}
          />
          {invalid('email') && (
            <p id={`${id}-email-error`} className="text-[13px] text-bad">
              {t('errors.email')}
            </p>
          )}
        </div>
      </div>
      <div className="space-y-1.5">
        <label htmlFor={`${id}-topic`} className="text-[13px] font-medium">
          {t('topic')}
        </label>
        <select
          id={`${id}-topic`}
          name="topic"
          defaultValue={typed?.topic ?? 'other'}
          className={`${FIELD} h-10 cursor-pointer`}
        >
          {SUPPORT_TOPICS.map((topic) => (
            <option key={topic} value={topic}>
              {t(`topics.${topic}`)}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-1.5">
        <label htmlFor={`${id}-message`} className="text-[13px] font-medium">
          {t('message')}
        </label>
        <textarea
          id={`${id}-message`}
          name="message"
          rows={6}
          required
          defaultValue={typed?.message ?? ''}
          minLength={SUPPORT_MESSAGE_MIN}
          maxLength={SUPPORT_MESSAGE_MAX}
          aria-invalid={invalid('message')}
          aria-describedby={`${id}-message-hint${invalid('message') ? ` ${id}-message-error` : ''}`}
          className={`${FIELD} py-2 leading-relaxed`}
        />
        <p id={`${id}-message-hint`} className="text-[13px] leading-relaxed text-faint">
          {t('messageHint')}
        </p>
        {invalid('message') && (
          <p id={`${id}-message-error`} className="text-[13px] text-bad">
            {t('errors.message', { min: SUPPORT_MESSAGE_MIN })}
          </p>
        )}
      </div>
      {/* Only a bot fills this: it is off screen, out of the tab order and hidden from assistive tech. */}
      <div aria-hidden className="absolute -left-[10000px] h-0 w-0 overflow-hidden">
        <input name="website" type="text" tabIndex={-1} autoComplete="off" defaultValue="" />
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Button type="submit" variant="primary" size="lg" disabled={pending}>
          {pending ? t('sending') : t('submit')}
        </Button>
        <p className="text-[13px] leading-relaxed text-muted">{t('target', { days })}</p>
      </div>
      <p className="text-[13px] leading-relaxed text-faint">
        {t('orEmail', { email: supportAddress })} {t('privacy')}
      </p>
    </form>
  );
}
