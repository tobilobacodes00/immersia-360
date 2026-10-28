'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { Lock, LockOpen } from 'lucide-react';
import { KIOSK_PIN } from '@immersia/shared/kiosk';
import { Button, Card, Field, Pill } from '@immersia/ui';
import { setKioskPinAction } from '../../../actions';

/** KIO-1: the PIN that locks the booth screen. Only its hash leaves this form. */
export function KioskSettings({ eventId, pinSet, readOnly }: { eventId: string; pinSet: boolean; readOnly: boolean }) {
  const t = useTranslations('studio.setup.kiosk');
  const [pin, setPin] = useState('');
  const [on, setOn] = useState(pinSet);
  const [message, setMessage] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
  const [pending, start] = useTransition();

  const save = (value: string | null) =>
    start(async () => {
      if (value !== null && !KIOSK_PIN.test(value)) return setMessage({ tone: 'bad', text: t('invalid') });
      const res = await setKioskPinAction(eventId, value);
      if (!res.ok) return setMessage({ tone: 'bad', text: t('failed') });
      setOn(value !== null);
      setPin('');
      setMessage({ tone: 'ok', text: value === null ? t('removed') : t('saved') });
    });

  return (
    <Card id="kiosk" title={t('title')} subtitle={t('subtitle')}>
      <div className="space-y-4">
        <Pill tone={on ? 'ok' : 'neutral'}>
          {on ? <Lock className="size-3.5" aria-hidden /> : <LockOpen className="size-3.5" aria-hidden />}
          {on ? t('statusOn') : t('statusOff')}
        </Pill>
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            save(pin);
          }}
        >
          <Field label={on ? t('newPin') : t('pin')} help={t('pinHelp')} htmlFor="kiosk-pin" stack>
            <input
              id="kiosk-pin"
              type="password"
              inputMode="numeric"
              autoComplete="new-password"
              pattern="\d{4,8}"
              maxLength={8}
              value={pin}
              disabled={readOnly || pending}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
              className="focus-ring h-10 w-40 rounded-[10px] border border-line-strong bg-elev px-3 font-mono tracking-[0.3em]"
            />
          </Field>
          <Button type="submit" variant="primary" disabled={readOnly || pending || pin.length < 4}>
            {on ? t('change') : t('set')}
          </Button>
          {on && (
            <Button type="button" variant="ghost" disabled={readOnly || pending} onClick={() => save(null)}>
              {t('remove')}
            </Button>
          )}
        </form>
        <p
          className={message?.tone === 'bad' ? 'text-sm text-bad' : 'text-sm text-muted'}
          role={message?.tone === 'bad' ? 'alert' : 'status'}
        >
          {message?.text ?? ''}
        </p>
      </div>
    </Card>
  );
}
