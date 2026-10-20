import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Flag } from 'lucide-react';
import { REPORT_DETAILS_MAX, REPORT_REASONS, isLinkId, parseRouteParams } from '@immersia/shared';
import { BrandMark, buttonClass } from '@immersia/ui';
import { LanguagePicker } from '@/components/LanguagePicker';
import { reportTargetForLink } from '@/server/reports';
import { submitReport } from './actions';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('report');
  // The link carries a session's access secret: never indexed, never sent on to another site.
  return { title: t('metaTitle'), robots: { index: false, follow: false }, referrer: 'no-referrer' };
}

const ERRORS = ['invalid', 'contact', 'not_found', 'too_many'] as const;
type ErrorKey = (typeof ERRORS)[number];

type Props = {
  searchParams: Promise<{ l?: string; g?: string; r?: string; e?: string; done?: string }>;
};

/**
 * The guest's report form (Abuse NFR: a report-content link on share pages and the event gallery).
 * Server-rendered and a plain form: no account, no cookie, no JavaScript needed. `?l=` is a session's
 * link id (from its share page); `?g=` an event gallery's slug, where the guest names the capture by its code.
 */
export default async function ReportPage({ searchParams }: Props) {
  const sp = await searchParams;
  const t = await getTranslations('report');
  const route = parseRouteParams({ r: sp.r });
  const linkId = sp.l && isLinkId(sp.l) ? sp.l : null;
  const slug = !linkId && sp.g && /^[A-Za-z0-9_-]{8,40}$/.test(sp.g) ? sp.g : null;
  if (!linkId && !slug) notFound();

  const target = linkId ? await reportTargetForLink(linkId) : null;
  if (linkId && !target) notFound();

  const backHref = linkId
    ? `/s/${linkId}${route === 'direct' ? '' : `?r=${route}`}`
    : `/g/${slug}${route === 'direct' ? '' : `?r=${route}`}`;
  const error = ERRORS.includes(sp.e as ErrorKey) ? (sp.e as ErrorKey) : null;

  const shell = (children: ReactNode) => (
    <div className="flex min-h-dvh flex-col">
      <main className="grid flex-1 place-items-start justify-items-center px-4 py-12 sm:place-items-center">
        <div className="w-full max-w-md">
          <BrandMark size={40} className="mb-8" />
          {children}
        </div>
      </main>
      <footer className="flex items-center justify-center gap-3 px-4 py-6">
        <LanguagePicker className="w-40" />
      </footer>
    </div>
  );

  // Thank you (or: it was already gone).
  if (sp.done) {
    return shell(
      <>
        <h1 className="text-[30px] leading-[1.05] font-bold tracking-[-0.03em]">{t('sent.title')}</h1>
        <p role="status" className="mt-3 text-[15px] leading-relaxed text-muted">
          {sp.done === 'removed' ? t('sent.removedBody') : t('sent.body')}
        </p>
        <a href={backHref} className={buttonClass({ variant: 'secondary', size: 'lg', className: 'mt-8' })}>
          {t('sent.back')}
        </a>
      </>,
    );
  }

  // The session was already hidden or taken down: nothing left to report.
  if (target?.removal) {
    return shell(
      <>
        <h1 className="text-[30px] leading-[1.05] font-bold tracking-[-0.03em]">{t('sent.title')}</h1>
        <p role="status" className="mt-3 text-[15px] leading-relaxed text-muted">
          {t('sent.removedBody')}
        </p>
      </>,
    );
  }

  return shell(
    <>
      <h1 className="flex items-center gap-3 text-[30px] leading-[1.05] font-bold tracking-[-0.03em]">
        <Flag className="size-6 shrink-0" aria-hidden /> {t('title')}
      </h1>
      <p className="mt-3 text-[15px] leading-relaxed text-muted">{t('intro')}</p>
      <form action={submitReport} className="mt-8 space-y-6" noValidate>
        {linkId ? <input type="hidden" name="l" value={linkId} /> : <input type="hidden" name="g" value={slug ?? ''} />}
        {route !== 'direct' && <input type="hidden" name="r" value={route} />}

        {error && (
          <p
            id="report-error"
            role="alert"
            className="rounded-xl border border-bad/30 bg-bad/[0.06] px-4 py-3 text-sm text-bad"
          >
            {t(`errors.${error}`)}
          </p>
        )}

        {slug && (
          <div>
            <label htmlFor="report-code" className="text-sm font-medium">
              {t('codeLabel')}
            </label>
            <input
              id="report-code"
              name="code"
              required
              maxLength={9}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              aria-describedby="report-code-help"
              className="focus-ring mt-2 block h-12 w-full rounded-xl border border-line-strong bg-elev px-4 font-mono text-xl font-bold tracking-[0.2em] uppercase placeholder:text-faint"
              placeholder={t('codePlaceholder')}
            />
            <p id="report-code-help" className="mt-1.5 text-[13px] text-muted">
              {t('codeHelp')}
            </p>
          </div>
        )}

        <fieldset>
          <legend className="text-sm font-medium">{t('reasonLabel')}</legend>
          <div className="mt-2 space-y-2">
            {REPORT_REASONS.map((reason) => (
              <label
                key={reason}
                className="flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border border-line-strong bg-elev px-4 py-2 text-[15px] has-[:checked]:border-accent has-[:checked]:bg-accent-soft"
              >
                <input
                  type="radio"
                  name="reason"
                  value={reason}
                  required
                  className="size-4 accent-[var(--color-accent)]"
                />
                {t(`reasons.${reason}`)}
              </label>
            ))}
          </div>
        </fieldset>

        <div>
          <label htmlFor="report-details" className="text-sm font-medium">
            {t('detailsLabel')}
          </label>
          <textarea
            id="report-details"
            name="details"
            rows={4}
            maxLength={REPORT_DETAILS_MAX}
            aria-describedby="report-details-help"
            className="focus-ring mt-2 block w-full rounded-xl border border-line-strong bg-elev px-4 py-3 text-[15px]"
          />
          <p id="report-details-help" className="mt-1.5 text-[13px] text-muted">
            {t('detailsHelp')}
          </p>
        </div>

        <div>
          <label htmlFor="report-contact" className="text-sm font-medium">
            {t('contactLabel')}
          </label>
          <input
            id="report-contact"
            name="contact"
            type="email"
            inputMode="email"
            autoComplete="off"
            maxLength={254}
            aria-describedby="report-contact-help"
            className="focus-ring mt-2 block h-12 w-full rounded-xl border border-line-strong bg-elev px-4 text-[15px]"
          />
          <p id="report-contact-help" className="mt-1.5 text-[13px] text-muted">
            {t('contactHelp')}
          </p>
        </div>

        {/* A trap for scripts that fill every field; people never reach it. */}
        <div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
          <input type="text" name="website" tabIndex={-1} autoComplete="off" aria-label={t('honeypot')} />
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" className={buttonClass({ variant: 'primary', size: 'lg' })}>
            {t('submit')}
          </button>
          <a href={backHref} className={buttonClass({ variant: 'ghost', size: 'lg' })}>
            {t('back')}
          </a>
        </div>
      </form>
    </>,
  );
}
