'use client';

import { useActionState } from 'react';
import { useTranslations } from 'next-intl';
import { eraseSessionAction, type EraseState } from '@/app/guest-actions';

const initial: EraseState = { error: null };

/**
 * "Delete my photos and videos" (GDPR Art. 17): a disclosure that opens to a warning and a confirm
 * button, so deleting takes two deliberate steps and works without JavaScript. Whoever holds the
 * link is the guest; the server rate-limits it and it is safe to repeat.
 */
export function EraseSession({ linkId }: { linkId: string }) {
  const t = useTranslations('share.erase');
  const [state, action, pending] = useActionState(eraseSessionAction, initial);
  return (
    <details className="mt-10 border-t border-g-ink/20 pt-3">
      <summary className="focus-ring inline-flex min-h-11 cursor-pointer items-center text-sm font-semibold underline underline-offset-4">
        {t('open')}
      </summary>
      <form action={action} className="mt-3 max-w-md rounded-xl border border-g-ink/30 p-4">
        <input type="hidden" name="linkId" value={linkId} />
        <h2 className="font-bold">{t('title')}</h2>
        <p className="mt-2 text-sm leading-relaxed">{t('body')}</p>
        {state.error && (
          <p role="alert" className="mt-3 text-sm font-semibold">
            {t(state.error)}
          </p>
        )}
        <button
          type="submit"
          disabled={pending}
          className="focus-ring mt-4 inline-flex min-h-11 items-center rounded-full bg-[#b42318] px-5 font-semibold text-white disabled:opacity-60"
        >
          {t('confirm')}
        </button>
      </form>
    </details>
  );
}
