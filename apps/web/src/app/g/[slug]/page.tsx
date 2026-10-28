import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { getFormatter, getTranslations } from 'next-intl/server';
import { Search } from 'lucide-react';
import {
  formatShortCode,
  guestFormCookie,
  guestThemeVars,
  isGuestFormChoice,
  parseRoute,
  type BoothMode,
} from '@immersia/shared';
import { cx } from '@immersia/ui';
import { displayFontClass } from '@immersia/ui/guest-fonts';
import { GuestFooter } from '@/components/guest/GuestFooter';
import { GuestForm } from '@/components/guest/GuestForm';
import { ZipDownload } from '@/components/zip/ZipDownload';
import { track } from '@/server/analytics';
import { galleryCookie, galleryEvent, galleryItems, validGalleryPass } from '@/server/gallery';
import { guestConsent } from '@/server/guest-form';
import { GalleryLock } from './GalleryLock';

/**
 * Screen 19: the event gallery (SHR-5, DL-7). Server-rendered with almost no JavaScript: filters,
 * search and paging are plain links and a GET form, so it opens fast on event Wi-Fi. Never indexed.
 */
export const dynamic = 'force-dynamic';

type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ r?: string; booth?: string; code?: string; cursor?: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const ev = await galleryEvent(slug);
  const t = await getTranslations('gallery');
  return {
    title: ev ? t('metaTitle', { event: ev.name }) : t('notFound'),
    robots: { index: false, follow: false },
    referrer: 'no-referrer',
  };
}

export default async function GalleryPage({ params, searchParams }: Props) {
  const [{ slug }, sp] = await Promise.all([params, searchParams]);
  const ev = await galleryEvent(slug);
  if (!ev) notFound();
  const [t, format] = await Promise.all([getTranslations('gallery'), getFormatter()]);
  const route = parseRoute(sp.r);

  if (ev.passwordHash && !validGalleryPass(slug, ev.passwordHash, (await cookies()).get(galleryCookie(slug))?.value))
    return (
      <div style={guestThemeVars(ev.theme)} className="min-h-dvh bg-g-bg text-g-ink">
        <main className="mx-auto max-w-md px-4 pt-16 pb-16 sm:px-6">
          <h1 className={cx(displayFontClass(ev.theme.font), 'text-[clamp(2rem,7vw,3rem)] leading-tight')}>
            {ev.name}
          </h1>
          <GalleryLock slug={slug} />
          <GuestFooter />
        </main>
      </div>
    );

  // SHR-6: the optional guest form, once per browser (a first-party cookie covers sessions too).
  const choice = (await cookies()).get(guestFormCookie(ev.id))?.value;
  const consent =
    ev.guestForm.enabled && !isGuestFormChoice(choice)
      ? await guestConsent({ operator: ev.operator, eventName: ev.name, settings: ev.guestForm })
      : null;

  const booth: BoothMode | null = sp.booth === 'photo' || sp.booth === 'video360' ? sp.booth : null;
  const code = sp.code?.trim() || null;
  const { items, next } = await galleryItems(ev.id, { booth, code, cursor: sp.cursor ?? null });
  if (!sp.cursor) track({ name: 'gallery_viewed', route }, { eventId: ev.id, organizationId: ev.organizationId });

  // Every link keeps how the guest got here (DL-13) and the current filters.
  const href = (patch: Record<string, string | null>) => {
    const q = new URLSearchParams();
    const merged = { r: route === 'direct' ? null : route, booth, code, ...patch };
    for (const [k, v] of Object.entries(merged)) if (v) q.set(k, v);
    const s = q.toString();
    return `/g/${slug}${s ? `?${s}` : ''}`;
  };
  const sessionHref = (linkId: string) => `/s/${linkId}${route === 'direct' ? '' : `?r=${route}`}`;
  const filters: { value: BoothMode | null; label: string }[] = [
    { value: null, label: t('filters.all') },
    { value: 'video360', label: t('filters.video360') },
    { value: 'photo', label: t('filters.photo') },
  ];

  return (
    <div style={guestThemeVars(ev.theme)} className="min-h-dvh bg-g-bg text-g-ink">
      <main className="mx-auto max-w-6xl px-4 pt-10 pb-16 sm:px-6 sm:pt-14">
        <header className="flex flex-wrap items-end justify-between gap-6">
          <div className="flex items-center gap-4">
            {ev.logoUrl && (
              // A presigned, short-lived URL: next/image would proxy and cache it.
              // eslint-disable-next-line @next/next/no-img-element
              <img src={ev.logoUrl} alt="" className="size-14 rounded-xl object-contain" />
            )}
            <div>
              <h1 className={cx(displayFontClass(ev.theme.font), 'text-[clamp(2rem,6vw,3.25rem)] leading-[0.95]')}>
                {ev.name}
              </h1>
              <p className="mt-2 text-sm opacity-70">
                {format.dateTime(new Date(`${ev.date}T12:00:00`), { dateStyle: 'long' })}
                {ev.hashtag && <span> · {ev.hashtag}</span>}
              </p>
            </div>
          </div>
          {/* SHR-6: until this browser has sent or skipped the form, it comes first (downloads wait, never lock). */}
          {!consent && (
            <ZipDownload
              source={`/api/g/${slug}/files`}
              filename={`${ev.name.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '') || 'event'}.zip`}
              label={t('downloadAll')}
              primary
            />
          )}
        </header>

        {consent && (
          <GuestForm
            scope="gallery"
            refId={slug}
            route={route === 'direct' ? '' : route}
            operator={ev.operator}
            requireName={ev.guestForm.requireName}
            consentText={consent.text}
            policyUrl={consent.policyUrl}
            fingerprint={consent.fingerprint}
          />
        )}

        <div className="mt-8 flex flex-wrap items-center justify-between gap-4">
          {ev.booths.length > 1 ? (
            <nav aria-label={t('filters.label')} className="flex gap-2">
              {filters.map((f) => (
                <a
                  key={f.label}
                  href={href({ booth: f.value, cursor: null })}
                  aria-current={booth === f.value ? 'page' : undefined}
                  className={cx(
                    'focus-ring inline-flex min-h-11 items-center rounded-full px-4 text-sm font-semibold',
                    booth === f.value ? 'bg-g-ink text-g-bg' : 'border border-g-ink/20',
                  )}
                >
                  {f.label}
                </a>
              ))}
            </nav>
          ) : (
            <span />
          )}
          <form action={`/g/${slug}`} method="get" role="search" className="flex items-center gap-2">
            {route !== 'direct' && <input type="hidden" name="r" value={route} />}
            {booth && <input type="hidden" name="booth" value={booth} />}
            <label className="flex h-11 items-center gap-2 rounded-full border border-g-ink/20 bg-white/60 px-4">
              <Search className="size-4 opacity-60" aria-hidden />
              <input
                name="code"
                defaultValue={code ?? ''}
                maxLength={7}
                autoComplete="off"
                autoCapitalize="characters"
                aria-label={t('searchLabel')}
                placeholder={t('searchPlaceholder')}
                className="w-32 bg-transparent font-mono text-sm tracking-[0.1em] uppercase outline-none placeholder:font-sans placeholder:tracking-normal placeholder:normal-case"
              />
            </label>
            <button
              type="submit"
              className="focus-ring min-h-11 rounded-full border border-g-ink/20 px-4 text-sm font-semibold"
            >
              {t('search')}
            </button>
          </form>
        </div>

        {items.length === 0 ? (
          <p className="mt-16 text-center opacity-70">{code ? t('noMatch') : t('empty')}</p>
        ) : (
          <ul className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {items.map((item) => (
              <li key={item.id}>
                <a
                  href={sessionHref(item.linkId)}
                  className="focus-ring block overflow-hidden rounded-[1rem] bg-black/5"
                  aria-label={t('open', { code: formatShortCode(item.shortCode) })}
                >
                  <span className="block aspect-[3/4]">
                    {item.thumb.type === 'image' ? (
                      // eslint-disable-next-line @next/next/no-img-element -- presigned, short-lived URL
                      <img src={item.thumb.url} alt="" loading="lazy" className="size-full object-cover" />
                    ) : (
                      <video
                        src={item.thumb.url}
                        muted
                        playsInline
                        preload="metadata"
                        className="size-full object-cover"
                      />
                    )}
                  </span>
                  <span className="tabular block px-3 py-2 font-mono text-sm font-semibold tracking-[0.1em]">
                    {formatShortCode(item.shortCode)}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-10 flex justify-center gap-3">
          {sp.cursor && (
            <a
              href={href({ cursor: null })}
              className="focus-ring inline-flex min-h-11 items-center rounded-full border border-g-ink/20 px-5 font-semibold"
            >
              {t('newest')}
            </a>
          )}
          {next && (
            <a
              href={href({ cursor: next })}
              className="focus-ring inline-flex min-h-11 items-center rounded-full border border-g-ink/20 px-5 font-semibold"
            >
              {t('older')}
            </a>
          )}
        </div>

        <GuestFooter />
      </main>
    </div>
  );
}
