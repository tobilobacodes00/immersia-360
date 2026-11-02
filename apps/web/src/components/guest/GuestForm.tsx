'use client';

import { useActionState, useId } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { GuestFormScope } from '@immersia/shared';
import { skipGuestFormAction, submitGuestFormAction, type GuestFormState } from '@/app/guest-actions';

const initial: GuestFormState = { error: null };

const field =
  'focus-ring mt-1.5 block h-12 w-full rounded-xl border border-g-ink/50 bg-white px-4 text-base text-[#111110] aria-[invalid=true]:border-[#b42318] aria-[invalid=true]:border-2';

/**
 * SHR-6: the optional guest data form, shown before the download buttons. It is a plain form that
 * posts to a server action, so it works without JavaScript; the checkbox starts unticked and is
 * required only to send. "Skip" is always there and costs the guest nothing (GDPR Art. 7(4)).
 * The consent sentence shown is hashed (`fingerprint`) and checked again on the server, so what is
 * stored is exactly what the guest saw.
 */
export function GuestForm({
  scope,
  refId,
  route,
  operator,
  requireName,
  consentText,
  policyUrl,
  fingerprint,
}: {
  scope: GuestFormScope;
  /** The session link id, or the gallery slug. */
  refId: string;
  route: string;
  operator: string;
  requireName: boolean;
  consentText: string;
  /** The operator's own policy (https), or '' for Immersia 360's general notice. */
  policyUrl: string;
  fingerprint: string;
}) {
  const t = useTranslations('share.form');
  const [state, action, pending] = useActionState(submitGuestFormAction, initial);
  const id = useId();
  const shown = state.consent ?? { text: consentText, policyUrl, fingerprint };
  const fields = state.fields ?? {};
  const problems = [
    state.error === 'fields' && fields.name && t('errors.name'),
    state.error === 'fields' && fields.email && t('errors.email'),
    state.error === 'fields' && fields.consent && t('errors.consent'),
    state.error === 'stale' && t('errors.stale'),
    state.error === 'tooMany' && t('errors.tooMany'),
    state.error === 'failed' && t('errors.failed'),
  ].filter((m): m is string => typeof m === 'string');

  return (
    <section aria-labelledby={`${id}-title`} className="mt-8 rounded-[1.25rem] border border-g-ink/30 p-5 sm:p-6">
      <h2 id={`${id}-title`} className="text-xl font-bold tracking-[-0.02em]">
        {t('title')}
      </h2>
      <p className="mt-2 leading-relaxed">{t('intro', { operator })}</p>

      <form action={action} className="mt-5 space-y-4">
        <input type="hidden" name="scope" value={scope} />
        <input type="hidden" name="ref" value={refId} />
        <input type="hidden" name="r" value={route} />
        <input type="hidden" name="fp" value={shown.fingerprint} />

        {problems.length > 0 && (
          <ul role="alert" className="space-y-1 rounded-xl border-2 border-[#b42318] p-3 text-sm font-medium">
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        )}

        <div>
          <label htmlFor={`${id}-name`} className="font-semibold">
            {requireName ? t('name') : t('nameOptional')}
          </label>
          <input
            id={`${id}-name`}
            name="name"
            type="text"
            autoComplete="name"
            maxLength={120}
            required={requireName}
            defaultValue={state.values?.name}
            aria-invalid={fields.name ? true : undefined}
            className={field}
          />
        </div>
        <div>
          <label htmlFor={`${id}-email`} className="font-semibold">
            {t('email')}
          </label>
          <input
            id={`${id}-email`}
            name="email"
            type="email"
            autoComplete="email"
            inputMode="email"
            maxLength={254}
            required
            defaultValue={state.values?.email}
            aria-invalid={fields.email ? true : undefined}
            className={field}
          />
        </div>

        <div className="flex items-start gap-3">
          {/* Unticked by default, and required only to send. */}
          <input
            id={`${id}-consent`}
            name="consent"
            type="checkbox"
            required
            aria-invalid={fields.consent ? true : undefined}
            className="focus-ring mt-1 size-6 shrink-0 accent-g-accent"
          />
          <div className="text-[15px] leading-relaxed">
            <label htmlFor={`${id}-consent`}>{shown.text}</label>{' '}
            {shown.policyUrl ? (
              <a
                href={shown.policyUrl}
                target="_blank"
                rel="noopener noreferrer nofollow"
                referrerPolicy="no-referrer"
                className="focus-ring font-semibold underline underline-offset-4"
              >
                {t('policy')}
              </a>
            ) : (
              <Link href="/privacy" className="focus-ring font-semibold underline underline-offset-4">
                {t('generalNotice')}
              </Link>
            )}
          </div>
        </div>

        <div className="flex flex-wrap gap-3 pt-1">
          <button
            type="submit"
            disabled={pending}
            className="focus-ring inline-flex min-h-12 items-center rounded-full bg-g-accent px-6 font-semibold text-g-on-accent disabled:opacity-60"
          >
            {t('submit')}
          </button>
          {/* The same form, a different action, and no validation: skipping needs nothing filled in. */}
          <button
            type="submit"
            formAction={skipGuestFormAction}
            formNoValidate
            disabled={pending}
            className="focus-ring inline-flex min-h-12 items-center rounded-full border-2 border-g-ink px-6 font-semibold"
          >
            {t('skip')}
          </button>
        </div>
        <p className="text-sm opacity-80">{t('note')}</p>
      </form>
    </section>
  );
}
