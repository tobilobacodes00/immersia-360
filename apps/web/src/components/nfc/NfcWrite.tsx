'use client';

import { useId, useRef, useState, useSyncExternalStore } from 'react';
import { useTranslations } from 'next-intl';
import { Check, Copy, Nfc } from 'lucide-react';
import { Button } from '@immersia/ui';
import { nfcFailure, nfcSupport, writeUrlToTag, type NfcFailure, type NfcSupport } from '@/lib/nfc';

type State =
  | { kind: 'idle' }
  | { kind: 'waiting' }
  | { kind: 'written' }
  | { kind: 'failed'; failure: Exclude<NfcFailure, 'cancelled'> };

const noSubscription = () => () => {};

/**
 * DL-10: put the event gallery's link on an NFC tag or wristband. On Chrome for Android the button writes it
 * straight from the phone (Web NFC); everywhere else the page says so and gives the link, tagged as the NFC route, to
 * paste into any NFC-writing app, with what to look for in tags and wristbands.
 */
export function NfcWrite({ url }: { url: string }) {
  const t = useTranslations('studio.nfc');
  const linkId = useId();
  const linkField = useRef<HTMLInputElement>(null);
  const abort = useRef<AbortController | null>(null);
  const [state, setState] = useState<State>({ kind: 'idle' });
  const [copied, setCopied] = useState(false);
  // Decided in the browser only: the server and the first paint say "unsupported", then it is corrected.
  const support: NfcSupport = useSyncExternalStore(
    noSubscription,
    () => nfcSupport(window),
    () => 'unsupported',
  );

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // No clipboard access (insecure page, permission): leave the link selected to copy by hand.
      linkField.current?.select();
    }
  };

  const write = async () => {
    const controller = new AbortController();
    abort.current = controller;
    setState({ kind: 'waiting' });
    try {
      await writeUrlToTag(window, url, controller.signal);
      setState({ kind: 'written' });
    } catch (err) {
      const failure = nfcFailure(err);
      setState(failure === 'cancelled' ? { kind: 'idle' } : { kind: 'failed', failure });
    } finally {
      abort.current = null;
    }
  };

  return (
    <div className="space-y-3 py-1">
      <p className="text-[13px] leading-relaxed text-muted">{t('intro')}</p>

      <div>
        <label htmlFor={linkId} className="sr-only">
          {t('linkLabel')}
        </label>
        <div className="flex gap-2">
          <input
            ref={linkField}
            id={linkId}
            readOnly
            value={url}
            onFocus={(e) => e.currentTarget.select()}
            className="h-9 min-w-0 flex-1 rounded-[10px] border border-line-strong bg-sunken px-3 font-mono text-[13px] outline-none focus:border-accent focus:ring-3 focus:ring-accent-soft"
          />
          <Button
            icon={copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
            onClick={() => void copy()}
          >
            {copied ? t('copied') : t('copy')}
          </Button>
        </div>
        <span className="sr-only" role="status">
          {copied ? t('copied') : ''}
        </span>
      </div>

      {support === 'supported' ? (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            {state.kind === 'waiting' ? (
              <Button onClick={() => abort.current?.abort()}>{t('cancel')}</Button>
            ) : (
              <Button variant="primary" icon={<Nfc className="size-4" aria-hidden />} onClick={() => void write()}>
                {t('write')}
              </Button>
            )}
          </div>
          <p role="status" className="text-[13px] leading-relaxed text-muted">
            {state.kind === 'waiting' && t('waiting')}
            {state.kind === 'written' && t('written')}
          </p>
          {state.kind === 'failed' && (
            <p role="alert" className="text-[13px] leading-relaxed text-bad">
              {t(`failures.${state.failure}`)}
            </p>
          )}
        </div>
      ) : (
        <p className="text-[13px] leading-relaxed text-muted">
          {support === 'insecure' ? t('insecure') : t('unsupported')}
        </p>
      )}

      <details className="text-[13px] leading-relaxed text-muted">
        <summary className="focus-ring cursor-pointer rounded font-medium text-fg">{t('tips.title')}</summary>
        <ul className="mt-2 list-disc space-y-1.5 pl-5">
          <li>{t('tips.tags')}</li>
          <li>{t('tips.record')}</li>
          <li>{t('tips.test')}</li>
          <li>{t('tips.metal')}</li>
          <li>{t('tips.lock')}</li>
        </ul>
      </details>
    </div>
  );
}
