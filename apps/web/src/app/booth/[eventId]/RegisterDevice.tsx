'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { MonitorSmartphone } from 'lucide-react';
import { describeUserAgent } from '@immersia/shared';
import { Button, TextInput } from '@immersia/ui';
import { detectCapabilities } from '@/lib/device-capabilities';
import { writeDeviceIdentity, type DeviceIdentity } from '@/lib/device-identity';
import { registerDeviceAction } from '../../studio/actions';

/** A booth only records on a registered device (ACC-2): its takes and uploads belong to it. */
export function RegisterDevice({ onRegistered }: { onRegistered: (identity: DeviceIdentity) => void }) {
  const t = useTranslations('booth.register');
  const [name, setName] = useState(() => {
    const { platform, browser } = describeUserAgent(navigator.userAgent);
    return `${platform} (${browser})`;
  });
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const register = () =>
    start(async () => {
      setError(null);
      const { platform, browser } = describeUserAgent(navigator.userAgent);
      const res = await registerDeviceAction({ name, platform, browser, capabilities: await detectCapabilities() });
      if (!res.ok) return setError(res.error === 'forbidden' ? t('forbidden') : t('error'));
      const identity = { id: res.data.id, token: res.data.token, name: name.trim() };
      if (!writeDeviceIdentity(identity)) setError(t('storage'));
      onRegistered(identity);
    });

  return (
    <main className="grid size-full place-items-center px-4" style={{ fontSize: 15 }}>
      <form
        className="card w-full max-w-md p-6 text-fg"
        onSubmit={(e) => {
          e.preventDefault();
          register();
        }}
      >
        <MonitorSmartphone className="size-6 text-accent" aria-hidden />
        <h1 className="mt-4 text-xl font-bold tracking-[-0.02em]">{t('title')}</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">{t('body')}</p>
        <label className="mt-5 block space-y-2">
          <span className="text-sm font-medium">{t('name')}</span>
          <TextInput value={name} onChange={setName} required />
        </label>
        {error && (
          <p role="alert" className="mt-3 text-sm text-bad">
            {error}
          </p>
        )}
        <Button type="submit" variant="primary" size="lg" className="mt-5 w-full" disabled={pending || !name.trim()}>
          {t('register')}
        </Button>
      </form>
    </main>
  );
}
