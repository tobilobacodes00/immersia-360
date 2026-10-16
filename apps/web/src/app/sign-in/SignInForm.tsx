'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { AnimatePresence, motion } from 'motion/react';
import { Mail, MailCheck } from 'lucide-react';
import { Button, TextInput, useHydrated } from '@immersia/ui';
import { authClient } from '@/lib/auth-client';

const RESEND_COOLDOWN_S = 30;

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden>
      <path
        fill="#4285F4"
        d="M23.5 12.27c0-.82-.07-1.6-.2-2.36H12v4.47h6.45a5.52 5.52 0 0 1-2.4 3.62v3h3.88c2.27-2.09 3.57-5.17 3.57-8.73Z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.95-1.07 7.93-2.91l-3.88-3c-1.07.72-2.45 1.15-4.05 1.15-3.12 0-5.76-2.1-6.7-4.94H1.3v3.1A12 12 0 0 0 12 24Z"
      />
      <path fill="#FBBC05" d="M5.3 14.3a7.2 7.2 0 0 1 0-4.6V6.6h-4a12 12 0 0 0 0 10.8l4-3.1Z" />
      <path
        fill="#EA4335"
        d="M12 4.77c1.76 0 3.34.6 4.58 1.8l3.44-3.44A11.97 11.97 0 0 0 1.3 6.6l4 3.1C6.24 6.87 8.88 4.77 12 4.77Z"
      />
    </svg>
  );
}

export function SignInForm({
  destination,
  google,
  initialError,
}: {
  destination: string;
  google: boolean;
  initialError: string | null;
}) {
  const t = useTranslations('signIn');
  const [email, setEmail] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [pending, setPending] = useState<'email' | 'google' | null>(null);
  const [error, setError] = useState<string | null>(initialError);
  const [cooldown, setCooldown] = useState(0);
  const hydrated = useHydrated();

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(id);
  }, [cooldown]);

  const sendLink = async (address: string) => {
    setError(null);
    setPending('email');
    const { error: err } = await authClient.signIn.magicLink({
      email: address,
      callbackURL: destination,
      errorCallbackURL: `/sign-in?error=link&next=${encodeURIComponent(destination)}`,
    });
    setPending(null);
    if (err) {
      setError(err.status === 429 ? t('errors.rateLimited') : t('errors.generic'));
      return;
    }
    setSentTo(address);
    setCooldown(RESEND_COOLDOWN_S);
  };

  const signInWithGoogle = async () => {
    setError(null);
    setPending('google');
    const { error: err } = await authClient.signIn.social({ provider: 'google', callbackURL: destination });
    if (err) {
      setPending(null);
      setError(t('errors.generic'));
    }
  };

  return (
    <div className="mt-8">
      <AnimatePresence mode="wait" initial={false}>
        {sentTo ? (
          <motion.div
            key="sent"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="card p-5"
            role="status"
          >
            <MailCheck className="size-5 text-accent" aria-hidden />
            <h2 className="mt-3 text-[15px] font-semibold">{t('sent.title')}</h2>
            <p className="mt-1 text-sm leading-relaxed text-muted">{t('sent.body', { email: sentTo })}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button size="sm" disabled={cooldown > 0 || pending !== null} onClick={() => sendLink(sentTo)}>
                {cooldown > 0 ? t('sent.resendIn', { seconds: cooldown }) : t('sent.resend')}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setSentTo(null)}>
                {t('sent.different')}
              </Button>
            </div>
          </motion.div>
        ) : (
          <motion.form
            key="form"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            onSubmit={(e) => {
              e.preventDefault();
              const address = email.trim();
              if (address) void sendLink(address);
            }}
            className="space-y-3"
          >
            <label htmlFor="email" className="text-sm font-medium">
              {t('email')}
            </label>
            <TextInput
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={setEmail}
              placeholder={t('emailPlaceholder')}
              className="h-11"
            />
            <Button
              type="submit"
              variant="primary"
              size="lg"
              className="w-full"
              disabled={!hydrated || pending !== null}
              icon={<Mail className="size-4" />}
            >
              {pending === 'email' ? t('sending') : t('sendLink')}
            </Button>
            {google && (
              <>
                <div className="flex items-center gap-3 py-1 text-xs text-faint" aria-hidden>
                  <span className="h-px flex-1 bg-line" />
                  {t('or')}
                  <span className="h-px flex-1 bg-line" />
                </div>
                <Button
                  size="lg"
                  className="w-full"
                  disabled={!hydrated || pending !== null}
                  onClick={signInWithGoogle}
                  icon={<GoogleMark />}
                >
                  {t('google')}
                </Button>
              </>
            )}
          </motion.form>
        )}
      </AnimatePresence>
      {error && (
        <p role="alert" className="mt-4 text-sm text-bad">
          {error}
        </p>
      )}
      <p className="mt-8 text-[13px] leading-relaxed text-faint">{t('guestNote')}</p>
    </div>
  );
}
