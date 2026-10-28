import Link from 'next/link';
import { CircleHelp } from 'lucide-react';
import { cx } from '@immersia/ui';
import { helpHref, type HelpScope, type HelpSlug } from '@/lib/help-links';

/**
 * A "?" link from a screen to the help article that explains it (HLP-2, HLP-3). Server- and
 * client-safe: the caller passes the already-translated label. `newTab` is for the booth, which must
 * not navigate away from a running session.
 */
export function HelpLink({
  slug,
  label,
  scope = 'studio',
  anchor,
  newTab,
  className,
}: {
  slug: HelpSlug;
  label: string;
  scope?: HelpScope;
  anchor?: string;
  newTab?: boolean;
  className?: string;
}) {
  return (
    <Link
      href={helpHref(slug, scope, anchor)}
      {...(newTab ? { target: '_blank', rel: 'noopener' } : {})}
      className={cx(
        // min-h-6: a 24 px target (WCAG 2.2 target size), whatever the line height around it.
        'focus-ring inline-flex min-h-6 items-center gap-1 rounded text-[13px] font-medium text-accent hover:underline',
        className,
      )}
    >
      <CircleHelp className="size-3.5 shrink-0" aria-hidden />
      {label}
    </Link>
  );
}
