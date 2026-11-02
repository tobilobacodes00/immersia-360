'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { CircleHelp } from 'lucide-react';
import { cx } from '@immersia/ui';
import { helpHref, type HelpSlug } from '@/lib/help-links';

/**
 * The "?" link for a screen on a booth device (HLP-2, HLP-3). It goes to the public help centre, since
 * a booth device is not necessarily signed in to the Studio, and opens in a new tab so a running
 * session is never left. Callers hide it while the kiosk is PIN-locked: a guest must not be sent to
 * operator help.
 *
 * `iconOnly` is the small round button that sits next to a status pill over the camera picture.
 */
export function BoothHelpLink({
  slug,
  anchor,
  label,
  iconOnly,
  className,
}: {
  slug: HelpSlug;
  anchor?: string;
  /** Already translated, e.g. "Fix camera access". Read by screen readers when `iconOnly`. */
  label: string;
  iconOnly?: boolean;
  className?: string;
}) {
  const t = useTranslations('help.markdown');
  return (
    <Link
      href={helpHref(slug, 'public', anchor)}
      target="_blank"
      rel="noopener"
      className={cx(
        'focus-ring inline-flex items-center gap-1 rounded',
        iconOnly
          ? 'size-7 shrink-0 justify-center rounded-full bg-g-bg/95 text-fg'
          : 'min-h-6 text-[13px] font-medium text-accent hover:underline',
        className,
      )}
    >
      <CircleHelp className={iconOnly ? 'size-4' : 'size-3.5 shrink-0'} aria-hidden />
      {iconOnly ? <span className="sr-only">{label}</span> : label}
      <span className="sr-only"> ({t('newTab')})</span>
    </Link>
  );
}
