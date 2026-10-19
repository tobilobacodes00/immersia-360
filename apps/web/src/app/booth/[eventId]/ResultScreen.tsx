'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { motion } from 'motion/react';
import { Mail, MessageCircle, MessageSquareText, Link2, Check } from 'lucide-react';
import type { LocalSession } from '@immersia/offline';
import { formatShortCode, sessionUrl } from '@immersia/shared';
import { QrCode, cx } from '@immersia/ui';
import { GuestButton, Headline, type DisplayFont } from '@immersia/ui/guest';

type Channel = 'link' | 'whatsapp' | 'sms';

/** Leave the result on screen this long without interaction, then return to ready. */
export const RESULT_TIMEOUT_MS = 45_000;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Where guests type a code: the short domain when there is one, else this app's /c. */
function codeEntry(): string {
  const short = process.env.NEXT_PUBLIC_SHORT_ORIGIN;
  if (short) return new URL(short).host;
  return `${window.location.host}/c`;
}

/**
 * Screen 13: the guest's result (SHR-1/2/3). The QR exists the moment the take is saved — the link
 * id was minted on this device — so it shows straight away, online or not; the page it opens says
 * "on their way" until the upload lands. WhatsApp and SMS are QR deep links: the guest's own phone
 * opens its own app with the link filled in, so the booth never handles a phone number.
 */
export function ResultScreen({
  session,
  event,
  onEmail,
  onDone,
}: {
  session: LocalSession;
  event: { name: string; font: DisplayFont; share: { email: boolean; sms: boolean; whatsapp: boolean } };
  onEmail: (email: string) => Promise<void>;
  onDone: () => void;
}) {
  const t = useTranslations('booth.result');
  const [channel, setChannel] = useState<Channel>('link');
  const [emailOpen, setEmailOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState(false);
  const [sentTo, setSentTo] = useState<string[]>([]);
  const [touched, setTouched] = useState(0);

  // Back to ready after a quiet spell; any interaction restarts the clock.
  useEffect(() => {
    const id = setTimeout(onDone, RESULT_TIMEOUT_MS);
    return () => clearTimeout(id);
  }, [onDone, touched]);

  const origin = window.location.origin;
  const message = t('message', { event: event.name, url: sessionUrl(origin, session.linkId, 'message') });
  const values: Record<Channel, string> = {
    link: sessionUrl(origin, session.linkId, 'booth'),
    whatsapp: `https://wa.me/?text=${encodeURIComponent(message)}`,
    sms: `sms:?&body=${encodeURIComponent(message)}`,
  };
  const channels: { id: Channel; icon: typeof Link2 }[] = [
    { id: 'link', icon: Link2 },
    ...(event.share.whatsapp ? [{ id: 'whatsapp' as const, icon: MessageCircle }] : []),
    ...(event.share.sms ? [{ id: 'sms' as const, icon: MessageSquareText }] : []),
  ];

  const submitEmail = async (e: FormEvent) => {
    e.preventDefault();
    setTouched((n) => n + 1);
    const address = email.trim();
    if (!EMAIL.test(address)) return setEmailError(true);
    setEmailError(false);
    await onEmail(address);
    setSentTo((s) => [...s, address]);
    setEmail('');
    setEmailOpen(false);
  };

  return (
    <motion.div
      key="result"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="absolute inset-0 z-10 overflow-y-auto bg-g-bg px-6 py-8"
      onPointerDown={() => setTouched((n) => n + 1)}
    >
      <div className="mx-auto flex min-h-full max-w-5xl flex-col items-center justify-center gap-8 landscape:flex-row landscape:gap-14">
        <div className="flex w-[min(20rem,70vw)] shrink-0 flex-col items-center gap-4">
          <div className="w-full rounded-[1.5rem] border border-black/10 bg-white p-4">
            <QrCode value={values[channel]} label={t(`qrAlt.${channel}`)} />
          </div>
          {channels.length > 1 && (
            <div role="radiogroup" aria-label={t('title')} className="flex gap-2">
              {channels.map(({ id, icon: Icon }) => (
                <button
                  key={id}
                  type="button"
                  role="radio"
                  aria-checked={channel === id}
                  onClick={() => setChannel(id)}
                  className={cx(
                    'focus-ring flex min-h-11 items-center gap-2 rounded-full px-4 text-[1rem] font-semibold',
                    channel === id ? 'bg-g-ink text-g-bg' : 'border-2 border-g-ink/15 text-g-ink',
                  )}
                >
                  <Icon className="size-5" aria-hidden /> {t(`tabs.${id}`)}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex max-w-md flex-col items-center text-center landscape:items-start landscape:text-left">
          <Headline font={event.font} className="text-[clamp(2.25rem,5vw,3.75rem)]">
            {t('title')}
          </Headline>
          <p className="mt-3 text-[1.15rem] opacity-70">{t('subtitle')}</p>

          <p className="mt-6 text-[1rem] opacity-70">
            {session.shortCode ? t('codeHint', { url: codeEntry() }) : t('codePending')}
          </p>
          {session.shortCode && (
            <p className="tabular mt-1 font-mono text-[2.25rem] font-bold tracking-[0.14em]">
              {formatShortCode(session.shortCode)}
            </p>
          )}

          {event.share.email && (
            <div className="mt-6 w-full">
              {emailOpen ? (
                <form onSubmit={(e) => void submitEmail(e)} className="flex w-full flex-col gap-2" noValidate>
                  <label htmlFor="guest-email" className="text-[1rem] font-semibold">
                    {t('emailLabel')}
                  </label>
                  <div className="flex gap-2">
                    <input
                      id="guest-email"
                      type="email"
                      inputMode="email"
                      autoComplete="off"
                      autoFocus
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder={t('emailPlaceholder')}
                      aria-invalid={emailError || undefined}
                      aria-describedby={emailError ? 'guest-email-error' : undefined}
                      className="focus-ring h-14 min-w-0 flex-1 rounded-full border-2 border-g-ink/15 bg-white px-5 text-[1.1rem] text-[#111110]"
                    />
                    <button
                      type="submit"
                      className="focus-ring h-14 rounded-full bg-g-accent px-6 text-[1.1rem] font-semibold text-g-on-accent"
                    >
                      {t('emailSend')}
                    </button>
                  </div>
                  {emailError && (
                    <p id="guest-email-error" role="alert" className="text-[1rem]">
                      {t('emailInvalid')}
                    </p>
                  )}
                </form>
              ) : (
                <button
                  type="button"
                  onClick={() => setEmailOpen(true)}
                  className="focus-ring flex min-h-12 items-center gap-2 rounded-full border-2 border-g-ink/15 px-5 text-[1.1rem] font-semibold"
                >
                  <Mail className="size-5" aria-hidden /> {t('email')}
                </button>
              )}
              <div aria-live="polite">
                {sentTo.map((to) => (
                  <p key={to} className="mt-2 flex items-center gap-2 text-[1rem] opacity-80">
                    <Check className="size-4" aria-hidden /> {t('emailQueued', { email: to })}
                  </p>
                ))}
              </div>
            </div>
          )}

          <GuestButton primary className="mt-8 min-w-[14rem]" onClick={onDone}>
            {t('next')}
          </GuestButton>
        </div>
      </div>
    </motion.div>
  );
}
