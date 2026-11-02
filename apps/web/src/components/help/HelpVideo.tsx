import { getTranslations } from 'next-intl/server';

const MIME: Record<string, string> = { mp4: 'video/mp4', webm: 'video/webm' };

/**
 * A short how-to video with captions (WCAG 2.2, 1.2.2): the captions track is required by the
 * article's front matter, loaded by default, and the article's written steps cover the same ground.
 * Nothing is fetched until the person presses play.
 */
export async function HelpVideo({
  title,
  src,
  captions,
  locale,
}: {
  title: string;
  src: string;
  captions: string;
  locale: string;
}) {
  const t = await getTranslations('help.article');
  const type = MIME[src.split('.').pop() ?? ''] ?? 'video/mp4';
  return (
    <figure className="mb-8">
      <video
        controls
        preload="none"
        playsInline
        aria-label={t('video', { title })}
        className="aspect-video w-full rounded-xl bg-ink"
      >
        <source src={src} type={type} />
        <track kind="captions" src={captions} srcLang={locale} label={t('captionsLabel')} default />
        {t('videoFallback')}
      </video>
    </figure>
  );
}
