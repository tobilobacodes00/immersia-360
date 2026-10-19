'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { Check, Copy, ExternalLink, Lock, LockOpen } from 'lucide-react';
import { Button, Card, Field, Pill, TextInput } from '@immersia/ui';
import { ZipDownload } from '@/components/zip/ZipDownload';
import { setGalleryPasswordAction } from '../../gallery-actions';
import { useCan } from '../../operator-context';

/** SHR-5 and EVT-4 on the event dashboard: the client's gallery link, its password, and every file. */
export function GalleryCard({
  eventId,
  eventName,
  url,
  items,
  locked,
}: {
  eventId: string;
  eventName: string;
  url: string;
  items: number;
  locked: boolean;
}) {
  const t = useTranslations('studio.galleryCard');
  const canUpdate = useCan({ event: ['update'] });
  const canExport = useCan({ gallery: ['export'] });
  const [copied, setCopied] = useState(false);
  const [isLocked, setLocked] = useState(locked);
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const setPw = (value: string | null) =>
    start(async () => {
      const res = await setGalleryPasswordAction(eventId, value);
      if (res.ok) {
        setLocked(value !== null);
        setPassword('');
        setMessage(value ? t('passwordSet') : t('passwordRemoved'));
      } else setMessage(res.error === 'invalid' ? t('passwordShort') : t('failed'));
    });

  return (
    <Card title={t('title')} subtitle={t('subtitle', { count: items })}>
      <Field label={t('link')} stack>
        <div className="flex flex-wrap items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded-lg bg-sunken px-3 py-2 text-[13px]">{url}</code>
          <Button
            size="sm"
            onClick={() => void navigator.clipboard.writeText(url).then(() => setCopied(true))}
            icon={copied ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
          >
            {copied ? t('copied') : t('copy')}
          </Button>
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="focus-ring inline-flex items-center gap-1 text-[13px] font-medium text-accent"
          >
            {t('openLink')} <ExternalLink className="size-3.5" aria-hidden />
          </a>
        </div>
      </Field>
      <Field
        label={t('password')}
        help={t('passwordHelp')}
        badge={
          <Pill tone={isLocked ? 'accent' : 'neutral'}>
            {isLocked ? <Lock className="size-3" aria-hidden /> : <LockOpen className="size-3" aria-hidden />}
            {isLocked ? t('locked') : t('unlocked')}
          </Pill>
        }
        stack
      >
        {canUpdate && (
          <div className="flex flex-wrap items-center gap-2">
            <TextInput
              type="password"
              value={password}
              onChange={setPassword}
              ariaLabel={t('password')}
              placeholder={isLocked ? t('newPassword') : t('setPassword')}
              autoComplete="new-password"
              className="w-56"
              onEnter={() => password.length >= 6 && setPw(password)}
            />
            <Button size="sm" disabled={pending || password.length < 6} onClick={() => setPw(password)}>
              {isLocked ? t('change') : t('set')}
            </Button>
            {isLocked && (
              <Button size="sm" variant="ghost" disabled={pending} onClick={() => setPw(null)}>
                {t('remove')}
              </Button>
            )}
          </div>
        )}
        <p className="mt-1 text-[13px] text-muted" aria-live="polite">
          {message}
        </p>
      </Field>
      {canExport && (
        <Field label={t('export')} help={t('exportHelp')} stack>
          <ZipDownload
            source={`/api/events/${eventId}/files`}
            filename={`${eventName.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '') || 'event'}-all-files.zip`}
            label={t('exportButton')}
            className="text-fg"
          />
        </Field>
      )}
    </Card>
  );
}
