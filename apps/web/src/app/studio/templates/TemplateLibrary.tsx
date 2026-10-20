'use client';

import { memo, useCallback, useDeferredValue, useMemo, useState } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { LayoutTemplate, Plus, SearchX } from 'lucide-react';
import { TEMPLATE_CATEGORIES, type TemplateCategory } from '@immersia/layout';
import type { TokenContext } from '@immersia/shared';
import { Button, EmptyState, Modal, Pill, Select, TextInput, buttonClass, cx } from '@immersia/ui';
import { applyDesignAction, saveToLibraryAction } from '@/app/studio/design-actions';
import { TemplateCanvas } from '@/components/editor/TemplateCanvas';
import { useMediaQuery } from '@/components/editor/use-media-query';
import { useTemplateInputs } from '@/components/editor/use-template-inputs';
import { SAMPLE_QR, useTemplateNames } from '@/components/templates/use-template-names';
import { TemplateThumb, VIDEO_BACKDROP } from '@/components/templates/TemplateThumb';
import {
  builtinSummaries,
  filterTemplates,
  siblingFor,
  sizeKeyOf,
  type SizeKey,
  type TemplateFilters,
} from '@/lib/builtin-templates';
import { formatEventDate } from '@/lib/format';
import type { AssetView } from '@/server/assets';
import type { DesignTarget, TemplateSummary } from '@/server/templates';
import { useCan } from '../operator-context';

const THUMB = { width: 200, height: 240 };

/** The page's own copy of a template's size fields, for a template saved from a built-in. */
const sizeFieldsOf = (t: TemplateSummary): Pick<TemplateSummary, 'printSize' | 'aspect' | 'shots'> => ({
  ...(t.printSize ? { printSize: t.printSize } : {}),
  ...(t.aspect ? { aspect: t.aspect } : {}),
  ...(t.shots === undefined ? {} : { shots: t.shots }),
});

/** Screen 7: the template library. Occasion chips, a size filter, search, and a preview with "use". */
export function TemplateLibrary({
  mine: initialMine,
  targets,
  views,
}: {
  /** The organisation's own saved templates (the built-ins come from code, not the server). */
  mine: TemplateSummary[];
  targets: DesignTarget[];
  views: AssetView[];
}) {
  const t = useTranslations('studio.templates');
  const names = useTemplateNames();

  const [mine, setMine] = useState(initialMine);
  const [seenMine, setSeenMine] = useState(initialMine);
  if (seenMine !== initialMine) {
    setSeenMine(initialMine);
    setMine(initialMine);
  }

  const [filters, setFilters] = useState<TemplateFilters>({ category: 'all', size: 'all', query: '' });
  const query = useDeferredValue(filters.query);
  const items = useMemo(() => [...mine, ...builtinSummaries()], [mine]);
  const shown = useMemo(
    () => filterTemplates(items, { ...filters, query }, names.name),
    [items, filters, query, names.name],
  );

  const [selected, setSelected] = useState<TemplateSummary | null>(null);
  const [open, setOpen] = useState(false);
  // A new key per opening: the preview starts from its first step every time.
  const [openings, setOpenings] = useState(0);
  const openPreview = useCallback((item: TemplateSummary) => {
    setSelected(item);
    setOpenings((n) => n + 1);
    setOpen(true);
  }, []);
  const closePreview = useCallback(() => setOpen(false), []);

  const filtered = filters.category !== 'all' || filters.size !== 'all' || filters.query.trim() !== '';
  const clear = () => setFilters({ category: 'all', size: 'all', query: '' });

  return (
    <>
      <div className="space-y-4" role="search" aria-label={t('filters.label')}>
        <div role="radiogroup" aria-label={t('filters.occasion')} className="flex flex-wrap gap-2">
          {(['all', ...TEMPLATE_CATEGORIES] as const).map((c) => (
            <Chip
              key={c}
              checked={filters.category === c}
              onClick={() => setFilters((f) => ({ ...f, category: c }))}
              label={c === 'all' ? t('filters.all') : names.category(c)}
            />
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Select<SizeKey | 'all'>
            className="w-full sm:w-[220px]"
            label={t('filters.size')}
            value={filters.size}
            onChange={(size) => setFilters((f) => ({ ...f, size }))}
            options={[{ value: 'all', label: t('filters.allSizes') }, ...names.sizeOptions]}
          />
          <TextInput
            className="sm:max-w-xs"
            value={filters.query}
            onChange={(v) => setFilters((f) => ({ ...f, query: v }))}
            ariaLabel={t('filters.search')}
            placeholder={t('filters.searchPlaceholder')}
            name="q"
            autoComplete="off"
          />
          <p role="status" className="tabular text-[13px] text-muted sm:ml-auto">
            {t('count', { count: shown.length })}
          </p>
        </div>
      </div>

      {shown.length === 0 ? (
        <div className="card mt-6">
          <EmptyState
            icon={<SearchX className="size-5" />}
            title={t('empty.title')}
            body={t('empty.body')}
            action={filtered && <Button onClick={clear}>{t('filters.clear')}</Button>}
          />
        </div>
      ) : (
        <ul aria-label={t('grid')} className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {shown.map((item) => (
            <LibraryCard
              key={item.id}
              item={item}
              name={names.name(item)}
              line={names.occasion(item) ?? names.name(item)}
              meta={names.describe(item)}
              mineLabel={t('mine')}
              tokens={names.tokens(item.category)}
              views={views}
              onOpen={openPreview}
            />
          ))}
        </ul>
      )}

      <Modal open={open} onClose={closePreview} title={selected ? names.name(selected) : undefined} width="max-w-3xl">
        {selected && (
          <Preview
            key={`${selected.id}:${openings}`}
            item={selected}
            name={names.name(selected)}
            targets={targets}
            views={views}
            onSaved={(saved) => setMine((m) => [saved, ...m])}
            onClose={closePreview}
          />
        )}
      </Modal>
    </>
  );
}

function Chip({ checked, label, onClick }: { checked: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      onClick={onClick}
      className={cx(
        'focus-ring h-8 rounded-full border px-3 text-[13px] font-medium transition-colors',
        checked
          ? 'border-ink bg-ink text-white'
          : 'border-line-strong bg-elev text-muted hover:border-[#c9c6bd] hover:text-fg',
      )}
    >
      {label}
    </button>
  );
}

const LibraryCard = memo(function LibraryCard({
  item,
  name,
  line,
  meta,
  mineLabel,
  tokens,
  views,
  onOpen,
}: {
  item: TemplateSummary;
  name: string;
  line: string;
  meta: string;
  mineLabel: string;
  tokens: TokenContext;
  views: AssetView[];
  onOpen: (item: TemplateSummary) => void;
}) {
  return (
    <li>
      <button
        type="button"
        aria-label={name}
        onClick={() => onOpen(item)}
        className="focus-ring group flex h-full w-full flex-col rounded-xl border border-line bg-elev p-3 text-left transition-colors hover:border-line-strong"
      >
        <span className="grid h-[264px] place-items-center rounded-lg bg-sunken p-3">
          <TemplateThumb
            doc={item.doc}
            tokens={tokens}
            qr={SAMPLE_QR}
            views={views}
            maxWidth={THUMB.width}
            maxHeight={THUMB.height}
            label={name}
            backdrop={item.kind === 'overlay' ? VIDEO_BACKDROP : undefined}
          />
        </span>
        <span className="mt-3 flex items-start justify-between gap-2">
          <span className="min-w-0">
            <span className="block text-sm leading-snug font-semibold">{line}</span>
            {meta && <span className="mt-0.5 block text-[12px] text-muted">{meta}</span>}
          </span>
          {!item.builtIn && <Pill tone="accent">{mineLabel}</Pill>}
        </span>
      </button>
    </li>
  );
});

type Step =
  | { kind: 'info' }
  | { kind: 'use' }
  | { kind: 'save' }
  | { kind: 'applied'; event: DesignTarget }
  | { kind: 'saved'; name: string };

/** The preview: the design large, what it is, and the two things to do with it. */
function Preview({
  item,
  name,
  targets,
  views,
  onSaved,
  onClose,
}: {
  item: TemplateSummary;
  name: string;
  targets: DesignTarget[];
  views: AssetView[];
  onSaved: (saved: TemplateSummary) => void;
  onClose: () => void;
}) {
  const t = useTranslations('studio.templates');
  const names = useTemplateNames();
  const canEdit = useCan({ event: ['update'] });
  const [step, setStep] = useState<Step>({ kind: 'info' });

  const wide = useMediaQuery('(min-width: 640px)', true);
  const docs = useMemo(() => [item.doc], [item.doc]);
  const tokens = useMemo(() => names.tokens(item.category), [names, item.category]);
  const { inputs, redrawKey, fontsReady } = useTemplateInputs({ docs, initialViews: views, tokens, qr: SAMPLE_QR });

  const size = sizeKeyOf(item);
  const isStory = item.printSize === 'story';
  const note =
    item.kind === 'overlay' ? t('preview.overlayNote') : isStory ? t('preview.storyNote') : t('preview.qrNote');

  return (
    <div className="grid sm:grid-cols-[minmax(0,1fr)_340px]">
      <div className="grid min-h-[300px] place-items-center bg-sunken p-4 sm:p-6">
        {fontsReady ? (
          <TemplateCanvas
            doc={item.doc}
            inputs={inputs}
            redrawKey={redrawKey}
            maxWidth={wide ? 420 : 280}
            maxHeight={wide ? 520 : 380}
            label={t('preview.label', { name })}
            backdrop={item.kind === 'overlay' ? VIDEO_BACKDROP : undefined}
          />
        ) : (
          <div aria-hidden className="h-64 w-40 animate-pulse rounded-md bg-line" />
        )}
      </div>

      <div className="space-y-5 p-5 sm:p-6">
        {step.kind === 'info' && (
          <>
            <div className="space-y-3">
              <Pill tone={item.builtIn ? 'neutral' : 'accent'}>
                {item.builtIn ? t('preview.builtIn') : t('preview.mine')}
              </Pill>
              <div className="space-y-1 text-sm">
                {size && <p className="font-semibold">{names.sizeLabel(size)}</p>}
                {item.kind === 'layout' && item.shots !== undefined && (
                  <p className="text-muted">{t('preview.photos', { count: item.shots })}</p>
                )}
              </div>
              <p className="text-[13px] leading-relaxed text-muted">{note}</p>
            </div>
            {canEdit && (
              <div className="flex flex-col gap-2">
                <Button variant="primary" onClick={() => setStep({ kind: 'use' })}>
                  <LayoutTemplate className="size-4" aria-hidden />
                  {t('preview.use')}
                </Button>
                {item.builtIn && <Button onClick={() => setStep({ kind: 'save' })}>{t('preview.save')}</Button>}
              </div>
            )}
          </>
        )}

        {step.kind === 'use' && (
          <UsePanel
            item={item}
            targets={targets}
            onBack={() => setStep({ kind: 'info' })}
            onApplied={(event) => setStep({ kind: 'applied', event })}
          />
        )}

        {step.kind === 'save' && (
          <SavePanel
            item={item}
            suggested={name}
            onBack={() => setStep({ kind: 'info' })}
            onSaved={(saved) => {
              onSaved(saved);
              setStep({ kind: 'saved', name: saved.name });
            }}
          />
        )}

        {step.kind === 'applied' && (
          <div className="space-y-4">
            <p role="status" className="text-sm leading-relaxed">
              {t('use.done', { event: step.event.name })}
            </p>
            <div className="flex flex-wrap gap-2">
              <Link href={`/studio/events/${step.event.id}/branding`} className={buttonClass({ variant: 'primary' })}>
                {t('use.openBranding')}
              </Link>
              <Button variant="ghost" onClick={onClose}>
                {t('close')}
              </Button>
            </div>
          </div>
        )}

        {step.kind === 'saved' && (
          <div className="space-y-4">
            <p role="status" className="text-sm leading-relaxed">
              {t('save.saved', { name: step.name })}
            </p>
            <Button variant="ghost" onClick={onClose}>
              {t('close')}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

/** Choose one of the organisation's events that runs the right booth, and use the design for it. */
function UsePanel({
  item,
  targets,
  onBack,
  onApplied,
}: {
  item: TemplateSummary;
  targets: DesignTarget[];
  onBack: () => void;
  onApplied: (event: DesignTarget) => void;
}) {
  const t = useTranslations('studio.templates');
  const locale = useLocale();
  const names = useTemplateNames();
  const eligible = useMemo(
    () => targets.filter((e) => (item.kind === 'layout' ? e.layout : e.overlay)),
    [targets, item.kind],
  );
  const [eventId, setEventId] = useState(eligible.length === 1 ? eligible[0]!.id : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  /** The page an event designs for, and the template that goes there. */
  const plan = (e: DesignTarget) => {
    const printSize = e.layout?.printSize;
    const aspect = e.overlay?.aspect;
    const page: SizeKey | undefined = item.kind === 'layout' ? printSize : aspect;
    if (!page) return null;
    const same = sizeKeyOf(item) === page;
    // The same style made for the event's own page beats a shrunken copy (and keeps a printed QR at 18 mm).
    const sibling = same ? undefined : siblingFor(item, { printSize, aspect });
    return { page, same, sibling, use: sibling ?? item };
  };

  const chosen = eligible.find((e) => e.id === eventId);

  const submit = async () => {
    const p = chosen && plan(chosen);
    if (!chosen || !p) return;
    setBusy(true);
    setError(false);
    const res = await applyDesignAction(chosen.id, item.kind, p.use.doc);
    setBusy(false);
    if (!res.ok) return setError(true);
    onApplied(chosen);
  };

  return (
    <div className="space-y-4">
      <p className="text-[13px] leading-relaxed text-muted">{t('use.body')}</p>
      {eligible.length === 0 ? (
        <div className="space-y-3">
          <p className="text-sm">{t(item.kind === 'layout' ? 'use.noneLayout' : 'use.noneOverlay')}</p>
          <Link href="/studio/events/new" className={buttonClass({ size: 'sm' })}>
            <Plus className="size-3.5" aria-hidden />
            {t('use.createEvent')}
          </Link>
        </div>
      ) : (
        <fieldset className="space-y-2">
          <legend className="mb-2 text-[13px] font-semibold">{t('use.pick')}</legend>
          <div className="max-h-[260px] space-y-2 overflow-y-auto pr-1">
            {eligible.map((e) => {
              const p = plan(e)!;
              const sizeLabel = names.sizeLabel(p.page);
              const shotsMismatch =
                item.kind === 'layout' && e.layout && p.use.shots !== undefined && p.use.shots !== e.layout.shots;
              return (
                <label
                  key={e.id}
                  className={cx(
                    'flex cursor-pointer gap-3 rounded-xl border p-3 transition-colors has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-accent-soft',
                    eventId === e.id ? 'border-accent bg-accent-soft' : 'border-line hover:border-line-strong',
                  )}
                >
                  <input
                    type="radio"
                    name="event"
                    value={e.id}
                    checked={eventId === e.id}
                    onChange={() => setEventId(e.id)}
                    className="mt-1 size-4 accent-[#2b3fe6]"
                  />
                  <span className="min-w-0 space-y-0.5">
                    <span className="block truncate text-sm font-medium">{e.name}</span>
                    <span className="block text-[12px] text-muted">{formatEventDate(e.date, locale)}</span>
                    <span className="block text-[12px] text-muted">
                      {p.same
                        ? t('use.fits', { size: sizeLabel })
                        : p.sibling
                          ? t('use.sibling', { size: sizeLabel })
                          : t('use.fitted', { size: sizeLabel })}
                    </span>
                    {shotsMismatch && e.layout && p.use.shots !== undefined && (
                      <span className="block text-[12px] text-muted">
                        {t('use.shotsNote', { layout: p.use.shots, event: e.layout.shots })}
                      </span>
                    )}
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>
      )}
      {error && (
        <p role="alert" className="text-[13px] text-bad">
          {t('use.failed')}
        </p>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="ghost" onClick={onBack} disabled={busy}>
          {t('cancel')}
        </Button>
        <Button variant="primary" onClick={() => void submit()} disabled={!chosen || busy}>
          {t('use.apply')}
        </Button>
      </div>
    </div>
  );
}

/** Copy a built-in into the organisation's own templates (it can then be edited, deleted, reused). */
function SavePanel({
  item,
  suggested,
  onBack,
  onSaved,
}: {
  item: TemplateSummary;
  suggested: string;
  onBack: () => void;
  onSaved: (saved: TemplateSummary) => void;
}) {
  const t = useTranslations('studio.templates');
  const [name, setName] = useState(suggested.slice(0, 120));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setBusy(true);
    setError(false);
    const res = await saveToLibraryAction(item.kind, trimmed, item.doc);
    setBusy(false);
    if (!res.ok) return setError(true);
    onSaved({ id: res.data.id, kind: item.kind, name: trimmed, doc: item.doc, builtIn: false, ...sizeFieldsOf(item) });
  };

  return (
    <div className="space-y-4">
      <label className="block space-y-1.5">
        <span className="text-[13px] font-semibold">{t('save.name')}</span>
        <TextInput
          value={name}
          onChange={(v) => setName(v.slice(0, 120))}
          onEnter={() => void submit()}
          ariaLabel={t('save.name')}
          autoFocus
        />
      </label>
      {error && (
        <p role="alert" className="text-[13px] text-bad">
          {t('save.failed')}
        </p>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="ghost" onClick={onBack} disabled={busy}>
          {t('cancel')}
        </Button>
        <Button variant="primary" onClick={() => void submit()} disabled={!name.trim() || busy}>
          {t('save.save')}
        </Button>
      </div>
    </div>
  );
}
