'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Expand, LayoutTemplate, PenLine, Trash2 } from 'lucide-react';
import { OVERLAY_STYLES, overlayPreset, presetTemplate, type Shots, type Template } from '@immersia/layout';
import {
  overlayCanvasFor,
  type ASPECTS,
  type EventTheme,
  type PRINT_SIZES,
  type TemplateElement,
  type TokenContext,
} from '@immersia/shared';
import { Button, Modal, Segmented, buttonClass, cx } from '@immersia/ui';
import { applyDesignAction, patchMediaAction } from '@/app/studio/design-actions';
import { TemplateCanvas } from '@/components/editor/TemplateCanvas';
import { VIDEO_BACKDROP } from '@/components/editor/TemplatesPanel';
import { useTemplateInputs } from '@/components/editor/use-template-inputs';
import type { AssetView } from '@/server/assets';
import type { TemplateSummary } from '@/server/templates';

type Kind = 'layout' | 'overlay';
interface Option {
  id: string;
  title: string;
  doc: Template;
}

const base = { rotation: 0, opacity: 1, locked: false, hidden: false } as const;

/** An uploaded PNG as a design: a full-frame overlay, or a strip frame over the preset's photo slots. */
function fromUpload(
  kind: Kind,
  a: AssetView,
  o: { aspect: (typeof ASPECTS)[number]; printSize: (typeof PRINT_SIZES)[number]; shots: number; theme: EventTheme },
): Template {
  if (kind === 'overlay') {
    const c = overlayCanvasFor(o.aspect);
    return {
      canvas: { ...c, dpi: 72, printSize: null, background: '#00000000', backgroundAssetId: null },
      elements: [
        {
          ...base,
          id: 'frame',
          type: 'image',
          assetId: a.id,
          fit: 'cover',
          x: 0,
          y: 0,
          width: c.width,
          height: c.height,
        },
      ],
    };
  }
  const preset = presetTemplate(o.printSize, { shots: o.shots as Shots, ...o.theme, qr: false });
  const frame: TemplateElement = {
    ...base,
    id: 'frame',
    type: 'image',
    assetId: a.id,
    fit: 'cover',
    x: 0,
    y: 0,
    width: preset.canvas.width,
    height: preset.canvas.height,
  };
  // The frame sits on top: its transparent windows show the photos below.
  return { canvas: preset.canvas, elements: [...preset.elements.filter((e) => e.type === 'photo'), frame] };
}

/** Screen 5: the event's overlay (360) or print layout (photo), with the chooser and full-screen viewer. */
export function DesignCard({
  eventId,
  kind,
  design,
  library,
  uploads,
  assets,
  theme,
  tokens,
  printSize,
  shots,
  aspect,
  readOnly,
}: {
  eventId: string;
  kind: Kind;
  design: { id: string; doc: Template } | null;
  library: TemplateSummary[];
  uploads: AssetView[];
  assets: AssetView[];
  theme: EventTheme;
  tokens: TokenContext;
  printSize: (typeof PRINT_SIZES)[number];
  shots: number;
  aspect: (typeof ASPECTS)[number];
  readOnly: boolean;
}) {
  const t = useTranslations('studio.branding.design');
  const router = useRouter();
  const [chooser, setChooser] = useState(false);
  const [viewer, setViewer] = useState(false);
  const [tab, setTab] = useState<'presets' | 'saved' | 'uploads'>('presets');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState(false);

  const presets = useMemo<Option[]>(
    () =>
      kind === 'layout'
        ? ([1, 2, 3, 4] as Shots[]).map((n) => ({
            id: `preset-${n}`,
            title: t('presetShots', { count: n }),
            doc: presetTemplate(printSize, { shots: n, ...theme }),
          }))
        : OVERLAY_STYLES.filter((s) => s !== 'blank').map((s) => ({
            id: `overlay-${s}`,
            title: t(`overlayStyles.${s}`),
            doc: overlayPreset(aspect, s, theme),
          })),
    [kind, printSize, aspect, theme, t],
  );
  const saved = useMemo<Option[]>(() => library.map((l) => ({ id: l.id, title: l.name, doc: l.doc })), [library]);
  const uploaded = useMemo<Option[]>(
    () =>
      uploads.map((a) => ({ id: a.id, title: a.name, doc: fromUpload(kind, a, { aspect, printSize, shots, theme }) })),
    [uploads, kind, aspect, printSize, shots, theme],
  );

  const docs = useMemo(
    () => [...(design ? [design.doc] : []), ...presets, ...saved, ...uploaded].map((d) => ('doc' in d ? d.doc : d)),
    [design, presets, saved, uploaded],
  );
  const views = useMemo(() => [...assets, ...uploads], [assets, uploads]);
  const { inputs, redrawKey } = useTemplateInputs({
    docs,
    initialViews: views,
    tokens,
    qr: { url: 'https://immersia.example/s/preview', code: 'K7M2PQ' },
  });
  const backdrop = kind === 'overlay' ? VIDEO_BACKDROP : undefined;
  const editorHref = `/studio/events/${eventId}/design/${kind}` as const;

  const apply = async (o: Option) => {
    setBusy(o.id);
    setError(false);
    const res = await applyDesignAction(eventId, kind, o.doc);
    setBusy(null);
    if (!res.ok) return setError(true);
    setChooser(false);
    router.refresh();
  };

  const remove = async () => {
    const res = await patchMediaAction(eventId, { overlayTemplateId: null });
    if (res.ok) router.refresh();
  };

  const options = tab === 'presets' ? presets : tab === 'saved' ? saved : uploaded;

  return (
    <div className="flex flex-col gap-5 py-4 sm:flex-row sm:items-start">
      <div className="grid min-h-[220px] w-full shrink-0 place-items-center rounded-xl bg-sunken p-4 sm:w-[260px]">
        {design ? (
          <TemplateCanvas
            doc={design.doc}
            inputs={inputs}
            redrawKey={redrawKey}
            maxWidth={220}
            maxHeight={280}
            label={t(kind === 'overlay' ? 'currentOverlay' : 'currentLayout')}
            backdrop={backdrop}
          />
        ) : (
          <div className="text-center text-[13px] text-muted">
            <LayoutTemplate className="mx-auto mb-2 size-6 text-subtle" aria-hidden />
            {t(kind === 'overlay' ? 'noOverlay' : 'defaultLayout')}
          </div>
        )}
      </div>
      <div className="min-w-0 space-y-3">
        <p className="max-w-prose text-[13px] leading-relaxed text-muted">
          {t(kind === 'overlay' ? 'overlayHelp' : 'layoutHelp')}
        </p>
        <div className="flex flex-wrap gap-2">
          {!readOnly && (
            <Link href={editorHref} className={buttonClass({ variant: 'primary', size: 'sm' })}>
              <PenLine className="size-3.5" aria-hidden />
              {design ? t('edit') : t('design')}
            </Link>
          )}
          {!readOnly && (
            <Button size="sm" onClick={() => setChooser(true)}>
              <LayoutTemplate className="size-3.5" aria-hidden />
              {t('choose')}
            </Button>
          )}
          {design && (
            <Button size="sm" variant="ghost" onClick={() => setViewer(true)}>
              <Expand className="size-3.5" aria-hidden />
              {t('fullScreen')}
            </Button>
          )}
          {design && kind === 'overlay' && !readOnly && (
            <Button size="sm" variant="ghost" onClick={() => void remove()}>
              <Trash2 className="size-3.5" aria-hidden />
              {t('removeOverlay')}
            </Button>
          )}
        </div>
      </div>

      <Modal open={chooser} onClose={() => setChooser(false)} title={t('chooserTitle')} width="max-w-3xl">
        <div className="space-y-4">
          <Segmented
            size="sm"
            value={tab}
            onChange={setTab}
            label={t('chooserTitle')}
            options={[
              { value: 'presets', label: t('tabs.presets') },
              { value: 'saved', label: t('tabs.saved', { count: saved.length }) },
              { value: 'uploads', label: t('tabs.uploads', { count: uploaded.length }) },
            ]}
          />
          {error && (
            <p role="alert" className="text-[13px] text-bad">
              {t('applyFailed')}
            </p>
          )}
          {options.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted">{t(tab === 'saved' ? 'noSaved' : 'noUploads')}</p>
          ) : (
            <ul className="grid max-h-[60vh] grid-cols-2 gap-3 overflow-y-auto sm:grid-cols-3 md:grid-cols-4">
              {options.map((o) => (
                <li key={o.id}>
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => void apply(o)}
                    className={cx(
                      'focus-ring flex w-full flex-col items-center gap-2 rounded-xl border border-line bg-elev p-3 transition-colors hover:border-line-strong',
                      busy === o.id && 'opacity-60',
                    )}
                  >
                    <TemplateCanvas
                      doc={o.doc}
                      inputs={inputs}
                      redrawKey={redrawKey}
                      maxWidth={140}
                      maxHeight={170}
                      label={o.title}
                      backdrop={backdrop}
                    />
                    <span className="w-full truncate text-center text-[12px] text-muted">{o.title}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="text-[12px] leading-relaxed text-faint">{t('chooserNote')}</p>
          <p className="text-[13px]">
            <Link href="/studio/templates" className="focus-ring rounded font-medium text-accent hover:underline">
              {t('browseLibrary')}
            </Link>
          </p>
        </div>
      </Modal>

      <Modal open={viewer} onClose={() => setViewer(false)} title={t('viewerTitle')} width="max-w-5xl">
        {design && viewer && (
          <div className="grid place-items-center">
            <TemplateCanvas
              doc={design.doc}
              inputs={inputs}
              redrawKey={redrawKey}
              maxWidth={Math.min(960, window.innerWidth - 96)}
              maxHeight={Math.max(240, window.innerHeight - 220)}
              label={t(kind === 'overlay' ? 'currentOverlay' : 'currentLayout')}
              backdrop={backdrop}
            />
          </div>
        )}
      </Modal>
    </div>
  );
}
