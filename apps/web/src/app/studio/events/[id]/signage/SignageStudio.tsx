'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Check, Copy, FileDown, ImageDown } from 'lucide-react';
import { SIGNAGE_FORMATS, SIGNAGE_SAFE_MM, signageTemplate, type SignageFormat } from '@immersia/layout';
import type { EventTheme, TokenContext } from '@immersia/shared';
import { Button, Card, Field, Segmented, TextInput } from '@immersia/ui';
import { TemplateCanvas } from '@/components/editor/TemplateCanvas';
import { useTemplateInputs } from '@/components/editor/use-template-inputs';
import { saveBlob, signageFilename, signagePdf, signagePng } from '@/lib/signage-export';
import type { AssetView } from '@/server/assets';

/** The signage's texts are literal; there is nothing for tokens to fill in. */
const NO_TOKENS: TokenContext = {};
const HEADLINE_MAX = 80;
const CTA_MAX = 60;
/** The preview never grows past this, so a tall poster still fits a laptop screen. */
const PREVIEW_MAX = { width: 520, height: 620 };

/** Screen 25: the event QR as print-ready signage (DL-5). */
export function SignageStudio({
  eventName,
  theme,
  hashtag,
  logo,
  link,
}: {
  eventName: string;
  theme: EventTheme;
  hashtag: string;
  /** The event's logo from Branding, when it has one. */
  logo: AssetView | null;
  /** The gallery link the code opens (tagged as the event QR route). */
  link: string;
}) {
  const t = useTranslations('studio.signage');
  const [format, setFormat] = useState<SignageFormat>('a4');
  const [headline, setHeadline] = useState(() => t('defaults.headline'));
  const [cta, setCta] = useState(() => t('defaults.cta'));
  const [busy, setBusy] = useState<'png' | 'pdf' | null>(null);
  const [failed, setFailed] = useState(false);
  const [copied, setCopied] = useState(false);
  const linkField = useRef<HTMLInputElement>(null);

  const template = useMemo(
    () =>
      signageTemplate(format, {
        theme,
        eventName,
        hashtag,
        headline,
        cta,
        logoAssetId: logo?.id ?? null,
        logoAspect: logo?.width && logo.height ? logo.width / logo.height : null,
      }),
    [format, theme, eventName, hashtag, headline, cta, logo],
  );

  // The same fonts, images and renderer as the editor, so the preview is what the files contain.
  const docs = useMemo(() => [template], [template]);
  const views = useMemo(() => (logo ? [logo] : []), [logo]);
  const qr = useMemo(() => ({ url: link, code: null }), [link]);
  const { inputs, redrawKey } = useTemplateInputs({
    docs,
    initialViews: views,
    tokens: NO_TOKENS,
    qr,
    placeholders: false,
  });
  // A file made before the fonts or the logo arrive would silently miss them.
  const ready = Boolean(inputs.fonts) && (!logo || Boolean(inputs.assets?.(logo.id)));

  const stage = useRef<HTMLDivElement>(null);
  const [stageWidth, setStageWidth] = useState<number>(PREVIEW_MAX.width);
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setStageWidth(Math.floor(entry!.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const download = async (kind: 'png' | 'pdf') => {
    setBusy(kind);
    setFailed(false);
    try {
      const blob = kind === 'png' ? await signagePng(template, inputs) : await signagePdf(template, inputs, format);
      saveBlob(blob, signageFilename(eventName, format, kind));
    } catch {
      setFailed(true);
    } finally {
      setBusy(null);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // No clipboard access (insecure page, permission): leave the link selected to copy by hand.
      linkField.current?.select();
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:items-start">
      <div className="min-w-0 space-y-6">
        <Card title={t('format.title')} subtitle={t('format.subtitle')}>
          <div className="space-y-3 py-4">
            <Segmented
              value={format}
              label={t('format.label')}
              onChange={setFormat}
              options={SIGNAGE_FORMATS.map((f) => ({ value: f, label: t(`formats.${f}`) }))}
            />
            <p className="text-[13px] leading-relaxed text-muted">{t(`hints.${format}`)}</p>
          </div>
        </Card>

        <Card title={t('wording.title')} subtitle={t('wording.subtitle')}>
          <div className="divide-y divide-line">
            <Field label={t('wording.headline')} htmlFor="signage-headline" stack>
              <TextInput
                id="signage-headline"
                value={headline}
                onChange={(v) => setHeadline(v.slice(0, HEADLINE_MAX))}
                autoComplete="off"
              />
            </Field>
            <Field label={t('wording.cta')} htmlFor="signage-cta" stack>
              <TextInput
                id="signage-cta"
                value={cta}
                onChange={(v) => setCta(v.slice(0, CTA_MAX))}
                autoComplete="off"
              />
            </Field>
          </div>
        </Card>

        <Card title={t('link.title')} subtitle={t('link.subtitle')}>
          <div className="py-4">
            <label htmlFor="signage-link" className="sr-only">
              {t('link.label')}
            </label>
            <div className="flex gap-2">
              <input
                ref={linkField}
                id="signage-link"
                readOnly
                value={link}
                onFocus={(e) => e.currentTarget.select()}
                className="h-9 min-w-0 flex-1 rounded-[10px] border border-line-strong bg-sunken px-3 font-mono text-[13px] outline-none focus:border-accent focus:ring-3 focus:ring-accent-soft"
              />
              <Button
                icon={copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
                onClick={() => void copy()}
              >
                {copied ? t('link.copied') : t('link.copy')}
              </Button>
            </div>
            <span className="sr-only" role="status">
              {copied ? t('link.copied') : ''}
            </span>
          </div>
        </Card>
      </div>

      <Card title={t('preview.title')} className="min-w-0 lg:sticky lg:top-6">
        <div ref={stage} className="grid place-items-center py-5">
          <TemplateCanvas
            doc={template}
            inputs={inputs}
            redrawKey={redrawKey}
            maxWidth={Math.max(160, Math.min(stageWidth, PREVIEW_MAX.width))}
            maxHeight={PREVIEW_MAX.height}
            label={t('preview.label', { format: t(`formats.${format}`) })}
          />
        </div>
        <div className="space-y-3 border-t border-line py-4">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="primary"
              icon={<FileDown className="size-4" aria-hidden />}
              disabled={!ready || busy !== null}
              aria-busy={busy === 'pdf'}
              onClick={() => void download('pdf')}
            >
              {t('download.pdf')}
            </Button>
            <Button
              icon={<ImageDown className="size-4" aria-hidden />}
              disabled={!ready || busy !== null}
              aria-busy={busy === 'png'}
              onClick={() => void download('png')}
            >
              {t('download.png')}
            </Button>
            {!ready && (
              <span role="status" className="text-[13px] text-muted">
                {t('preview.loading')}
              </span>
            )}
          </div>
          {failed && (
            <p role="alert" className="text-[13px] text-bad">
              {t('download.failed')}
            </p>
          )}
          <p className="text-[13px] leading-relaxed text-faint">{t('preview.tip', { mm: SIGNAGE_SAFE_MM })}</p>
        </div>
      </Card>
    </div>
  );
}
