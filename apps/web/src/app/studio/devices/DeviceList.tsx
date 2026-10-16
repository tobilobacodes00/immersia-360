'use client';

import { useEffect, useState, useSyncExternalStore, useTransition } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Laptop, MonitorSmartphone, Pencil, Smartphone, Tablet } from 'lucide-react';
import { describeUserAgent } from '@immersia/shared';
import { Button, Card, EmptyState, IconButton, Modal, Pill, TextInput } from '@immersia/ui';
import { formatRelative } from '@/lib/format';
import { detectCapabilities } from '@/lib/device-capabilities';
import { clearDeviceIdentity, readDeviceIdentity, writeDeviceIdentity } from '@/lib/device-identity';
import { registerDeviceAction, renameDeviceAction, revokeDeviceAction } from '../actions';
import { useCan } from '../operator-context';

export interface DeviceView {
  id: string;
  name: string;
  platform: string;
  browser: string;
  lastSeenAt: string | null;
  revoked: boolean;
  renderPath: 'local' | 'wasm' | 'server';
}

const ONLINE_MS = 2 * 60_000;

function PlatformIcon({ platform }: { platform: string }) {
  const cls = 'size-5 text-muted';
  if (platform === 'iPhone' || platform === 'Android') return <Smartphone className={cls} aria-hidden />;
  if (platform === 'iPad') return <Tablet className={cls} aria-hidden />;
  return <Laptop className={cls} aria-hidden />;
}

// localStorage is client-only: read it through useSyncExternalStore so SSR and hydration agree.
const subscribe = (cb: () => void) => {
  window.addEventListener('storage', cb);
  return () => window.removeEventListener('storage', cb);
};
const thisDeviceId = () => readDeviceIdentity()?.id ?? null;

export function DeviceList({ devices }: { devices: DeviceView[] }) {
  const t = useTranslations('studio.devices');
  const locale = useLocale();
  const canRegister = useCan({ device: ['register'] });
  const canRevoke = useCan({ device: ['revoke'] });
  const localId = useSyncExternalStore(subscribe, thisDeviceId, () => null);
  const [now, setNow] = useState(() => Date.now());
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [registerOpen, setRegisterOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [renaming, setRenaming] = useState<DeviceView | null>(null);
  const [renameTo, setRenameTo] = useState('');
  const [revoking, setRevoking] = useState<DeviceView | null>(null);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const registered = localId ? devices.find((d) => d.id === localId && !d.revoked) : undefined;

  const register = () =>
    start(async () => {
      setError(null);
      const { platform, browser } = describeUserAgent(navigator.userAgent);
      const res = await registerDeviceAction({
        name: newName,
        platform,
        browser,
        capabilities: await detectCapabilities(),
      });
      if (!res.ok) return setError(t('errors.register'));
      if (!writeDeviceIdentity({ id: res.data.id, token: res.data.token, name: newName.trim() })) {
        setError(t('errors.storage'));
      }
      window.dispatchEvent(new StorageEvent('storage'));
      setRegisterOpen(false);
    });

  const rename = () =>
    start(async () => {
      if (!renaming) return;
      const res = await renameDeviceAction(renaming.id, renameTo);
      if (!res.ok) return setError(t('errors.rename'));
      setRenaming(null);
    });

  const revoke = () =>
    start(async () => {
      if (!revoking) return;
      const res = await revokeDeviceAction(revoking.id);
      if (!res.ok) return setError(t('errors.revoke'));
      if (revoking.id === localId) {
        clearDeviceIdentity();
        window.dispatchEvent(new StorageEvent('storage'));
      }
      setRevoking(null);
    });

  return (
    <div className="space-y-6">
      {canRegister && !registered && (
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-4 py-4">
            <div className="max-w-xl">
              <h2 className="text-[15px] font-semibold">{t('thisBrowser')}</h2>
              <p className="mt-1 text-[13px] leading-relaxed text-muted">{t('thisBrowserBody')}</p>
            </div>
            <Button
              variant="primary"
              onClick={() => {
                const { platform, browser } = describeUserAgent(navigator.userAgent);
                setNewName(t('defaultName', { platform, browser }));
                setError(null);
                setRegisterOpen(true);
              }}
            >
              {t('register')}
            </Button>
          </div>
        </Card>
      )}

      {error && (
        <p role="alert" className="text-sm text-bad">
          {error}
        </p>
      )}

      <Card pad={false}>
        {devices.length === 0 ? (
          <EmptyState icon={<MonitorSmartphone className="size-5" />} title={t('emptyTitle')} body={t('emptyBody')} />
        ) : (
          <ul className="divide-y divide-line">
            {devices.map((d) => {
              const seen = d.lastSeenAt ? new Date(d.lastSeenAt) : null;
              const online = !d.revoked && seen && now - seen.getTime() < ONLINE_MS;
              return (
                <li key={d.id} className="flex flex-wrap items-center gap-4 px-5 py-4 sm:px-6">
                  <PlatformIcon platform={d.platform} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={d.revoked ? 'text-sm font-medium text-faint line-through' : 'text-sm font-medium'}
                      >
                        {d.name}
                      </span>
                      {d.id === localId && !d.revoked && <Pill tone="accent">{t('thisDevice')}</Pill>}
                      {d.revoked ? (
                        <Pill tone="bad">{t('revoked')}</Pill>
                      ) : online ? (
                        <Pill tone="ok" dot>
                          {t('online')}
                        </Pill>
                      ) : null}
                    </div>
                    <div className="mt-0.5 text-[13px] text-muted">
                      {d.platform} · {d.browser} · {t(`renderPath.${d.renderPath}`)}
                      {seen && !online && <> · {t('lastSeen', { when: formatRelative(seen, locale, now) })}</>}
                    </div>
                  </div>
                  {!d.revoked && (
                    <div className="flex items-center gap-1">
                      {canRegister && (
                        <IconButton
                          label={t('rename')}
                          onClick={() => {
                            setRenameTo(d.name);
                            setRenaming(d);
                          }}
                        >
                          <Pencil className="size-4" />
                        </IconButton>
                      )}
                      {canRevoke && (
                        <Button size="sm" variant="danger" onClick={() => setRevoking(d)}>
                          {t('revoke')}
                        </Button>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Modal open={registerOpen} onClose={() => setRegisterOpen(false)} title={t('registerTitle')}>
        <form
          className="space-y-4 p-6"
          onSubmit={(e) => {
            e.preventDefault();
            register();
          }}
        >
          <p className="text-sm text-muted">{t('registerBody')}</p>
          <label className="block space-y-2">
            <span className="text-sm font-medium">{t('name')}</span>
            <TextInput value={newName} onChange={setNewName} required autoFocus placeholder={t('namePlaceholder')} />
          </label>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setRegisterOpen(false)}>
              {t('cancel')}
            </Button>
            <Button type="submit" variant="primary" disabled={pending || !newName.trim()}>
              {t('register')}
            </Button>
          </div>
        </form>
      </Modal>

      <Modal open={Boolean(renaming)} onClose={() => setRenaming(null)} title={t('renameTitle')}>
        <form
          className="space-y-4 p-6"
          onSubmit={(e) => {
            e.preventDefault();
            rename();
          }}
        >
          <label className="block space-y-2">
            <span className="text-sm font-medium">{t('name')}</span>
            <TextInput value={renameTo} onChange={setRenameTo} required autoFocus />
          </label>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setRenaming(null)}>
              {t('cancel')}
            </Button>
            <Button type="submit" variant="primary" disabled={pending || !renameTo.trim()}>
              {t('save')}
            </Button>
          </div>
        </form>
      </Modal>

      <Modal
        open={Boolean(revoking)}
        onClose={() => setRevoking(null)}
        title={t('revokeTitle', { name: revoking?.name ?? '' })}
      >
        <div className="space-y-4 p-6">
          <p className="text-sm leading-relaxed text-muted">{t('revokeBody')}</p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setRevoking(null)}>
              {t('cancel')}
            </Button>
            <Button variant="danger" onClick={revoke} disabled={pending}>
              {t('revoke')}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
