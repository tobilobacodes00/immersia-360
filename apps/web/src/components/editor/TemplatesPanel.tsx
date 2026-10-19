'use client';

import { useEffect, useMemo, useRef, useState, type Dispatch, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { BookmarkPlus, Trash2 } from 'lucide-react';
import {
  OVERLAY_STYLES,
  fitDocument,
  overlayPreset,
  presetTemplate,
  renderTemplate,
  type RenderInputs,
  type Shots,
  type Template,
} from '@immersia/layout';
import type { ASPECTS, PRINT_SIZES, TokenContext } from '@immersia/shared';
import { Button, IconButton, Modal, TextInput } from '@immersia/ui';
import { deleteLibraryTemplateAction, saveToLibraryAction } from '@/app/studio/design-actions';
import type { TemplateSummary } from '@/server/templates';
import type { EditorAction, EditorDoc } from './state';

export interface Theme {
  background: string;
  ink: string;
  accent: string;
  font: 'sans' | 'serif';
}

/** A small, exact preview: the same renderer as print, at thumbnail scale. */
function Thumb({ doc, inputs, label }: { doc: Template; inputs: RenderInputs; label: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const box = 132;
    const s = Math.min(box / doc.canvas.width, box / doc.canvas.height);
    c.width = Math.max(1, Math.round(doc.canvas.width * s));
    c.height = Math.max(1, Math.round(doc.canvas.height * s));
    const ctx = c.getContext('2d');
    if (ctx) renderTemplate(ctx, doc, { ...inputs, placeholders: true }, s);
  }, [doc, inputs]);
  return (
    <canvas
      ref={ref}
      role="img"
      aria-label={label}
      className="max-h-[132px] max-w-full rounded-md shadow-[0_0_0_1px_rgba(17,17,16,0.08)]"
    />
  );
}

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
  tokens,
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
  tokens: TokenContext;
}) {
  const t = useTranslations('studio.editor.templates');
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [confirm, setConfirm] = useState<{ title: string; doc: EditorDoc } | null>(null);

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

  const fitted = (doc: Template): EditorDoc =>
    doc.canvas.width === canvas.width && doc.canvas.height === canvas.height
      ? doc
      : fitDocument(doc, canvas.width, canvas.height);

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
        <Thumb doc={doc} inputs={{ ...inputs, tokens }} label={title} />
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
