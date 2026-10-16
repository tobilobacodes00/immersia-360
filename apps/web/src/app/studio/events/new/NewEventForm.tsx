'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Images, RotateCw } from 'lucide-react';
import { Button, Card, Field, Segmented, TextInput, useHydrated } from '@immersia/ui';
import { todayIso } from '@/lib/format';
import { createEventAction } from '../../actions';

type Mode = 'video360' | 'photo';
type Expiry = '7' | '30' | '90';

export function NewEventForm({ initialMode }: { initialMode: Mode }) {
  const t = useTranslations('studio.newEvent');
  const te = useTranslations('studio.events');
  const router = useRouter();
  const [name, setName] = useState('');
  // The operator's own calendar day, not the server's.
  const [date, setDate] = useState(() => todayIso(Intl.DateTimeFormat().resolvedOptions().timeZone));
  const [mode, setMode] = useState<Mode>(initialMode);
  const [expiry, setExpiry] = useState<Expiry>('30');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const hydrated = useHydrated();

  const submit = () =>
    start(async () => {
      setError(null);
      const res = await createEventAction({ name, date, mode, expiryDays: Number(expiry) });
      if (!res.ok) return setError(res.error === 'invalid' ? t('errors.invalid') : t('errors.generic'));
      router.push(`/studio/events/${res.data.id}/setup`);
    });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="max-w-2xl"
    >
      <Card>
        <Field label={t('name')} htmlFor="event-name" stack>
          <TextInput
            id="event-name"
            value={name}
            onChange={setName}
            placeholder={t('namePlaceholder')}
            required
            autoFocus
          />
        </Field>
        <Field label={t('date')} htmlFor="event-date">
          <input
            id="event-date"
            type="date"
            required
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="h-9 rounded-[10px] border border-line-strong bg-elev px-3 text-sm outline-none focus:border-accent focus:ring-3 focus:ring-accent-soft"
          />
        </Field>
        <Field label={t('mode')} help={t('modeHelp')}>
          <Segmented<Mode>
            label={t('mode')}
            value={mode}
            onChange={setMode}
            options={[
              {
                value: 'video360',
                label: (
                  <>
                    <RotateCw className="size-3.5" /> {te('modes.video360')}
                  </>
                ),
              },
              {
                value: 'photo',
                label: (
                  <>
                    <Images className="size-3.5" /> {te('modes.photo')}
                  </>
                ),
              },
            ]}
          />
        </Field>
        <Field label={t('expiry')} help={t('expiryHelp')}>
          <Segmented<Expiry>
            label={t('expiry')}
            value={expiry}
            onChange={setExpiry}
            options={(['7', '30', '90'] as const).map((d) => ({ value: d, label: t('days', { count: Number(d) }) }))}
          />
        </Field>
      </Card>
      {error && (
        <p role="alert" className="mt-4 text-sm text-bad">
          {error}
        </p>
      )}
      <div className="mt-6 flex gap-2">
        <Button type="submit" variant="primary" size="lg" disabled={!hydrated || pending || !name.trim() || !date}>
          {pending ? t('creating') : t('create')}
        </Button>
        <Button size="lg" variant="ghost" onClick={() => router.back()}>
          {t('cancel')}
        </Button>
      </div>
    </form>
  );
}
