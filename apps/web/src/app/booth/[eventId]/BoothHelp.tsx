'use client';

import { useTranslations } from 'next-intl';
import { BoothHelpLink } from '@/components/BoothHelpLink';
import { cameraErrorHelp, HELP_ARTICLES, renderErrorHelp, type HelpTarget } from '@/lib/help-links';

/**
 * The "?" links of the booth screens (HLP-3). They go to the public help centre in a new tab and are
 * only ever rendered for an operator: callers leave them out while the kiosk is PIN-locked.
 */

/** Under a camera error card: the article that has the steps for that code. */
export function CameraErrorHelp({ code, className }: { code: string; className?: string }) {
  const th = useTranslations('help.links');
  const target = cameraErrorHelp(code);
  return (
    <BoothHelpLink
      slug={target.slug}
      {...(target.anchor ? { anchor: target.anchor } : {})}
      label={target.slug === HELP_ARTICLES.cameraPermissions ? th('cameraPermissions') : th('boothErrors')}
      {...(className ? { className } : {})}
    />
  );
}

/** Next to a failed take in the render queue: why a render fails and what to do. */
export function RenderErrorHelp({ code }: { code: string | null | undefined }) {
  const th = useTranslations('help.links');
  const target: HelpTarget = renderErrorHelp(code);
  return (
    <BoothHelpLink slug={target.slug} {...(target.anchor ? { anchor: target.anchor } : {})} label={th('boothErrors')} />
  );
}

const STATUS_TARGETS = {
  /** No connection, or uploads waiting for one (and failed uploads: the pills table explains them). */
  offline: { slug: HELP_ARTICLES.offline, label: 'offline' },
  /** The device was revoked, so its uploads are refused. */
  revoked: { slug: HELP_ARTICLES.devices, label: 'devices' },
  storage: { slug: HELP_ARTICLES.iosStorage, label: 'storage' },
  background: { slug: HELP_ARTICLES.boothErrors, anchor: 'background', label: 'boothErrors' },
} as const;

/** A small round "?" beside a status pill in the booth's top bar. */
export function StatusHelp({ kind }: { kind: keyof typeof STATUS_TARGETS }) {
  const th = useTranslations('help.links');
  const target = STATUS_TARGETS[kind];
  return (
    <BoothHelpLink
      iconOnly
      slug={target.slug}
      {...('anchor' in target ? { anchor: target.anchor } : {})}
      label={th(target.label)}
    />
  );
}
