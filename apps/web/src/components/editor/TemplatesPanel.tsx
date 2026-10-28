'use client';

import { useMemo, useState, type Dispatch, type ReactNode } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { BookmarkPlus, Trash2 } from 'lucide-react';
import {
  OVERLAY_STYLES,
  TEMPLATE_CATEGORIES,
  fitDocument,
  overlayPreset,
  presetTemplate,
  type RenderInputs,
  type Shots,
  type Template,
  type TemplateCategory,
} from '@immersia/layout';
import type { ASPECTS, PRINT_SIZES } from '@immersia/shared';
import { Button, IconButton, Modal, Select, TextInput, buttonClass } from '@immersia/ui';
import { deleteLibraryTemplateAction, saveToLibraryAction } from '@/app/studio/design-actions';
import { TemplateThumb, VIDEO_BACKDROP } from '@/components/templates/TemplateThumb';
import { useTemplateNames } from '@/components/templates/use-template-names';
import { builtinSummaries, sizeFirst, sizeKeyOf } from '@/lib/builtin-templates';
import type { TemplateSummary } from '@/server/templates';
import type { EditorAction, EditorDoc } from './state';
import { TemplateCanvas } from './TemplateCanvas';

export interface Theme {
  background: string;
  ink: string;
  accent: string;
  font: 'sans' | 'serif';
}

export { VIDEO_BACKDROP };

/** Library templates shown at first, and added by each "Show more". */
const LIBRARY_PAGE = 12;

/** Templates panel (screen 6): start from a preset or a saved template; save the current design. */
export function TemplatesPanel({
  kind,
  current,
  canvas,
  printSize,
  aspect,
  theme,
  library,
  onLibraryChange,
  dispatch,
  inputs,
  redrawKey,
}: {
  kind: 'layout' | 'overlay';
  /** The design as it is on screen now (saved to the library as is, not the last autosave). */
  current: EditorDoc;
  canvas: { width: number; height: number };
  printSize: (typeof PRINT_SIZES)[number];
  aspect: (typeof ASPECTS)[number];
  theme: Theme;
  library: TemplateSummary[];
  onLibraryChange: (next: TemplateSummary[]) => void;
  dispatch: Dispatch<EditorAction>;
  inputs: RenderInputs;
  redrawKey: number;
}) {
  const t = useTranslations('studio.editor.templates');
  const names = useTemplateNames();
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [confirm, setConfirm] = useState<{ title: string; doc: EditorDoc } | null>(null);
  const [occasion, setOccasion] = useState<TemplateCategory | 'all'>('all');
  const [shown, setShown] = useState(LIBRARY_PAGE);

  // The built-in library, the designs of this page's size first (the others are fitted when used).
  const pageSize = kind === 'layout' ? printSize : aspect;
  const ordered = useMemo(
    () =>
      sizeFirst(
        builtinSummaries(kind).filter((b) => occasion === 'all' || b.category === occasion),
        pageSize,
      ),
    [kind, occasion, pageSize],
  );
  const visible = ordered.slice(0, shown);
  const sameSize = visible.filter((b) => sizeKeyOf(b) === pageSize);
  const otherSizes = visible.filter((b) => sizeKeyOf(b) !== pageSize);
  const occasions = useMemo(
    () => [
      { value: 'all' as const, label: t('allCategories') },
      ...TEMPLATE_CATEGORIES.map((c) => ({ value: c, label: names.category(c) })),
    ],
    [t, names],
  );

  const presets = useMemo(() => {
    if (kind === 'layout')
      return ([1, 2, 3, 4] as Shots[]).map((n) => ({
        id: `preset-${n}`,
        title: t('presetShots', { count: n }),
        doc: presetTemplate(printSize, { shots: n, background: theme.background, ink: theme.ink, font: theme.font }),
      }));
    return OVERLAY_STYLES.map((s) => ({
      id: `overlay-${s}`,
      title: t(`overlayStyles.${s}`),
      doc: overlayPreset(aspect, s, theme),
    }));
  }, [kind, printSize, aspect, theme, t]);

  const fitted = (doc: Template): EditorDoc => {
    const same = doc.canvas.width === canvas.width && doc.canvas.height === canvas.height;
    const out = same ? doc : fitDocument(doc, canvas.width, canvas.height);
    // A layout fitted to this page is a layout for this page's print size.
    return kind === 'layout' && out.canvas.printSize !== printSize
      ? { ...out, canvas: { ...out.canvas, printSize } }
      : out;
  };

  /** A library template: drawn lazily with its own fonts, named from translated parts. */
  const libraryCard = (item: TemplateSummary) => {
    const title = names.name(item);
    return (
      <li key={item.id}>
        <button
          type="button"
          aria-label={title}
          onClick={() => setConfirm({ title, doc: fitted(item.doc) })}
          className="focus-ring flex w-full flex-col items-center gap-2 rounded-xl border border-line bg-elev p-2.5 transition-colors hover:border-line-strong"
        >
          <TemplateThumb
            doc={item.doc}
            tokens={inputs.tokens}
            qr={inputs.qr ?? undefined}
            maxWidth={132}
            maxHeight={132}
            label={title}
            backdrop={kind === 'overlay' ? VIDEO_BACKDROP : undefined}
          />
          <span className="w-full truncate text-center text-[12px] text-muted">{names.occasion(item) ?? title}</span>
        </button>
      </li>
    );
  };

  const save = async () => {
    setBusy(true);
    setError(false);
    const res = await saveToLibraryAction(kind, name, current);
    setBusy(false);
    if (!res.ok) return setError(true);
    setSaving(false);
    setName('');
    onLibraryChange([{ id: res.data.id, kind, name: name.trim(), doc: current, builtIn: false }, ...library]);
  };

  const remove = async (id: string) => {
    const res = await deleteLibraryTemplateAction(id);
    if (res.ok) onLibraryChange(library.filter((l) => l.id !== id));
  };

  const card = (key: string, title: string, doc: Template, extra?: ReactNode) => (
    <li key={key} className="relative">
      <button
        type="button"
        onClick={() => setConfirm({ title, doc: fitted(doc) })}
        className="focus-ring flex w-full flex-col items-center gap-2 rounded-xl border border-line bg-elev p-2.5 transition-colors hover:border-line-strong"
      >
        <TemplateCanvas
          doc={doc}
          inputs={inputs}
          redrawKey={redrawKey}
          maxWidth={132}
          maxHeight={132}
          label={title}
          backdrop={kind === 'overlay' ? VIDEO_BACKDROP : undefined}
        />
        <span className="w-full truncate text-center text-[12px] text-muted">{title}</span>
      </button>
      {extra}
    </li>
  );

  return (
    <div className="space-y-5 p-3">
      <section>
        <h3 className="eyebrow mb-2 px-1">{t('presets')}</h3>
        <ul className="grid grid-cols-2 gap-2">{presets.map((p) => card(p.id, p.title, p.doc))}</ul>
      </section>
      <section>
        <div className="mb-2 flex items-center justify-between px-1">
          <h3 className="eyebrow">{t('saved')}</h3>
          <Button size="sm" variant="ghost" onClick={() => setSaving(true)}>
            <BookmarkPlus className="size-3.5" aria-hidden /> {t('saveCurrent')}
          </Button>
        </div>
        {library.length === 0 ? (
          <p className="px-1 text-[12px] leading-relaxed text-faint">{t('savedEmpty')}</p>
        ) : (
          <ul className="grid grid-cols-2 gap-2">
            {library.map((l) =>
              card(
                l.id,
                l.name,
                l.doc,
                !l.builtIn && (
                  <IconButton
                    label={t('delete', { name: l.name })}
                    className="absolute top-1 right-1 bg-elev/90"
                    onClick={() => void remove(l.id)}
                  >
                    <Trash2 className="size-3.5" aria-hidden />
                  </IconButton>
                ),
              ),
            )}
          </ul>
        )}
      </section>
      <section>
        <h3 className="eyebrow mb-2 px-1">{t('library')}</h3>
        <Select<TemplateCategory | 'all'>
          label={t('filterLabel')}
          value={occasion}
          onChange={(v) => {
            setOccasion(v);
            setShown(LIBRARY_PAGE);
          }}
          options={occasions}
        />
        {sameSize.length > 0 && (
          <div className="mt-3">
            {otherSizes.length > 0 && <h4 className="mb-1.5 px-1 text-[12px] font-semibold">{t('fitsPage')}</h4>}
            <ul className="grid grid-cols-2 gap-2">{sameSize.map(libraryCard)}</ul>
          </div>
        )}
        {otherSizes.length > 0 && (
          <div className="mt-3">
            <h4 className="mb-1.5 px-1 text-[12px] font-semibold">{t('otherSizes')}</h4>
            <ul className="grid grid-cols-2 gap-2">{otherSizes.map(libraryCard)}</ul>
          </div>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {visible.length < ordered.length && (
            <Button size="sm" onClick={() => setShown((n) => n + LIBRARY_PAGE)}>
              {t('showMore')}
            </Button>
          )}
          <Link href="/studio/templates" className={buttonClass({ variant: 'ghost', size: 'sm' })}>
            {t('browse')}
          </Link>
        </div>
      </section>

      <Modal open={saving} onClose={() => setSaving(false)} title={t('saveTitle')}>
        <div className="space-y-4">
          <TextInput
            value={name}
            onChange={setName}
            ariaLabel={t('name')}
            placeholder={t('namePlaceholder')}
            autoFocus
            onEnter={() => name.trim() && void save()}
          />
          {error && (
            <p role="alert" className="text-[13px] text-bad">
              {t('saveFailed')}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setSaving(false)}>
              {t('cancel')}
            </Button>
            <Button variant="primary" disabled={!name.trim() || busy} onClick={() => void save()}>
              {t('save')}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        title={t('applyTitle', { name: confirm?.title ?? '' })}
      >
        <p className="text-sm leading-relaxed text-muted">{t('applyBody')}</p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirm(null)}>
            {t('cancel')}
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              if (confirm) dispatch({ type: 'replace', doc: confirm.doc });
              setConfirm(null);
            }}
          >
            {t('apply')}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
