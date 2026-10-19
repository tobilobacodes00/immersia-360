import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getFormatter, getTranslations } from 'next-intl/server';
import { Download } from 'lucide-react';
import { formatShortCode, guestThemeVars, isLinkId, parseRoute, type OutputKind } from '@immersia/shared';
import { displayFontClass } from '@immersia/ui/guest-fonts';
import { track } from '@/server/analytics';
import { sharePage, type ShareFile } from '@/server/share';
import { contactHref } from '@/server/share-state';
import { OnTheWay } from './OnTheWay';
import { ShareActions } from './ShareActions';

/**
 * Screen 18: the guest's session page (DL-1, DL-8). Server-rendered, poster first, with almost no
 * JavaScript, so it opens fast on event Wi-Fi or 4G. The link id in the URL is the access secret;
 * the page is never indexed.
 */
export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ linkId: string }>; searchParams: Promise<{ r?: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { linkId } = await params;
  const page = isLinkId(linkId) ? await sharePage(linkId) : null;
  const t = await getTranslations('share');
  return {
    title: page ? t('metaTitle', { event: page.event.name }) : t('onTheWay'),
    robots: { index: false, follow: false },
    referrer: 'no-referrer',
  };
}

/** The file a guest sees first: the main video, else the strip, else whatever exists. */
const PRIMARY: OutputKind[] = ['mp4', 'strip', 'gif', 'boomerang', 'short_video', 'small_mp4'];

export default async function SharePage({ params, searchParams }: Props) {
  const { linkId } = await params;
  if (!isLinkId(linkId)) notFound();
  const route = parseRoute((await searchParams).r);
  const [page, t, format] = await Promise.all([sharePage(linkId), getTranslations('share'), getFormatter()]);

  // Minted on the booth, not registered yet (offline booth, upload queue): the QR still works.
  if (!page) return <OnTheWayScreen linkId={linkId} />;
  // The proxy answers 410 for expired sessions; this covers the moment between expiry and the sweep.
  if (page.state === 'expired')
    return (
      <Shell theme={page.event.theme}>
        <h1 className="text-[clamp(1.9rem,6vw,2.75rem)] leading-tight font-bold tracking-[-0.03em]">
          {t('endedTitle')}
        </h1>
        <p className="mt-3 opacity-70">{t('endedBody')}</p>
        {page.contact && <Contact contact={page.contact} template={t.raw('endedContact') as string} />}
      </Shell>
    );

  track({ name: 'share_page_viewed', output_kind: 'session', route }, { eventId: page.event.id });

  const ready = page.files.filter((f) => f.viewUrl);
  const pending = page.files.length - ready.length;
  const primary = PRIMARY.map((k) => ready.find((f) => f.kind === k)).find(Boolean) ?? null;
  const poster = ready.find((f) => f.kind === 'poster') ?? null;
  const downloads = ready.filter((f) => f.kind !== 'poster');
  const dl = (f: ShareFile) => `/d/${f.id}?l=${linkId}${route === 'direct' ? '' : `&r=${route}`}`;
  const eyebrow = (
    <p className="text-sm font-semibold tracking-[0.14em] uppercase opacity-70">
      {t('eyebrow')} {page.event.name}
    </p>
  );

  // Registered, nothing uploaded yet: the waiting state, in the event's colours.
  if (!primary)
    return (
      <Shell theme={page.event.theme}>
        {eyebrow}
        <div className="mt-6">
          <OnTheWay linkId={linkId} ready={ready.length} />
        </div>
      </Shell>
    );

  return (
    <Shell theme={page.event.theme}>
      {eyebrow}
      <h1 className={`${displayFontClass(page.event.theme.font)} mt-2 text-[clamp(2.25rem,8vw,3.5rem)] leading-[0.95]`}>
        {t('title')}
      </h1>

      <Media
        file={primary}
        poster={poster?.viewUrl ?? null}
        label={primary.mime.startsWith('video/') ? t('player') : t(`kinds.${primary.kind}`)}
      />

      <div className="mt-5 flex flex-wrap gap-3">
        <a
          href={dl(primary)}
          className="focus-ring inline-flex min-h-12 items-center gap-2 rounded-full bg-g-accent px-6 font-semibold text-g-on-accent"
        >
          <Download className="size-5" aria-hidden /> {t('download')}
        </a>
        <ShareActions
          file={{ url: primary.viewUrl!, mime: primary.mime, name: `${page.event.name}.${primary.mime.split('/')[1]}` }}
          title={page.event.name}
          labels={{ save: t('save'), share: t('share'), copied: t('copied') }}
        />
      </div>

      {downloads.length > 1 && (
        <ul className="mt-8 divide-y divide-g-ink/10 border-y border-g-ink/10">
          {downloads.map((f) => (
            <li key={f.id} className="flex items-center justify-between gap-4 py-3">
              <div>
                <div className="font-medium">{t(`kinds.${f.kind}`)}</div>
                <div className="text-sm opacity-60">
                  {f.kind === 'small_mp4' && `${t('kindHelp.small_mp4')} · `}
                  {f.bytes
                    ? format.number(f.bytes / 1_000_000, { style: 'unit', unit: 'megabyte', maximumFractionDigits: 1 })
                    : ''}
                </div>
              </div>
              <a
                href={dl(f)}
                className="focus-ring inline-flex min-h-11 items-center gap-2 rounded-full border border-g-ink/20 px-4 text-sm font-semibold"
              >
                <Download className="size-4" aria-hidden /> {t('download')}
              </a>
            </li>
          ))}
        </ul>
      )}

      {pending > 0 && (
        <div className="mt-6">
          <OnTheWay linkId={linkId} ready={ready.length} compact />
        </div>
      )}

      <dl className="mt-8 flex items-baseline gap-2 text-sm">
        <dt className="opacity-60">{t('code')}</dt>
        <dd className="font-mono font-bold tracking-[0.12em]">{formatShortCode(page.shortCode)}</dd>
      </dl>
      <p className="mt-2 text-sm opacity-60">
        {t('expires', { date: format.dateTime(page.expiresAt, { dateStyle: 'long' }) })}
      </p>
    </Shell>
  );
}

function Media({ file, poster, label }: { file: ShareFile; poster: string | null; label: string }) {
  const ratio = file.width && file.height ? `${file.width} / ${file.height}` : '9 / 16';
  return (
    <div
      className="mx-auto mt-6 w-full max-w-[26rem] overflow-hidden rounded-[1.25rem] bg-black/5"
      style={{ aspectRatio: ratio }}
    >
      {file.mime.startsWith('video/') ? (
        <video
          className="size-full object-contain"
          src={file.viewUrl!}
          poster={poster ?? undefined}
          controls
          playsInline
          preload="metadata"
          aria-label={label}
        />
      ) : (
        // A presigned, short-lived URL: next/image would proxy and cache it, which defeats expiry.
        // eslint-disable-next-line @next/next/no-img-element
        <img className="size-full object-contain" src={file.viewUrl!} alt={label} />
      )}
    </div>
  );
}

/** DL-12: "Questions? Contact …", linked when the contact is an email address or phone number. */
function Contact({ contact, template }: { contact: string; template: string }) {
  const href = contactHref(contact);
  const [before = '', after = ''] = template.split('{contact}');
  return (
    <p className="mt-4">
      {before}
      {href ? (
        <a href={href} className="font-semibold underline underline-offset-4">
          {contact}
        </a>
      ) : (
        contact
      )}
      {after}
    </p>
  );
}

function Shell({
  theme,
  children,
}: {
  theme: { accent: string; background: string; ink: string; font: 'sans' | 'serif' };
  children: ReactNode;
}) {
  return (
    <div style={guestThemeVars(theme)} className="min-h-dvh bg-g-bg text-g-ink">
      <main className="mx-auto max-w-xl px-4 pt-10 pb-16 sm:px-6 sm:pt-16">{children}</main>
    </div>
  );
}

function OnTheWayScreen({ linkId }: { linkId: string }) {
  return (
    <div className="min-h-dvh bg-g-bg text-g-ink">
      <main className="mx-auto max-w-xl px-4 pt-16 pb-16 sm:px-6">
        <OnTheWay linkId={linkId} ready={0} />
      </main>
    </div>
  );
}
