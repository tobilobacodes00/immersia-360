'use client';

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { useTranslations } from 'next-intl';
import {
  Circle,
  Image as ImageIcon,
  Maximize,
  QrCode,
  Redo2,
  Square,
  Type,
  Undo2,
  User,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { MIN_PRINT_QR_PX, printIssues, type RenderInputs } from '@immersia/layout';
import {
  templateAssetIds,
  templateFontFaces,
  type ASPECTS,
  type PRINT_SIZES,
  type TemplateElement,
  type TokenContext,
} from '@immersia/shared';
import { Button, IconButton, Pill, Segmented, cx } from '@immersia/ui';
import { AssetPicker } from '@/components/assets/AssetPicker';
import { saveTemplateAction, templateLatestAction } from '@/app/studio/design-actions';
import { prepareTemplateFonts, type FontResolver, type TemplateFace } from '@/lib/template-fonts';
import type { AssetView } from '@/server/assets';
import type { TemplateSummary } from '@/server/templates';
import { Inspector } from './Inspector';
import { LayersPanel } from './LayersPanel';
import { TemplatesPanel, type Theme } from './TemplatesPanel';
import { editorReducer, initialEditorState, type EditorAction, type EditorDoc } from './state';

const EditorStage = dynamic(() => import('./EditorStage'), {
  ssr: false,
  loading: () => <div className="h-full min-h-[320px] w-full animate-pulse bg-sunken" />,
});

const AUTOSAVE_MS = 800;
/** After a failed save (offline, server error), retry less eagerly. */
const RETRY_MS = 5000;
/** The design system's single accent (light theme only): guides and selection on the canvas. */
const ACCENT = '#2b3fe6';
const NUDGE_IDLE_MS = 500;
const ZOOM_STEP = 1.25;
const IMAGE_TYPES: AssetView['type'][] = ['overlay', 'layout', 'logo', 'background'];
/** A believable preview link and code, so a QR on the canvas looks like the real one. */
const SAMPLE_QR = { url: 'https://immersia.example/s/preview-link-0000000000000000', code: 'K7M2PQ' };

export interface TemplateEditorProps {
  templateId: string;
  kind: 'layout' | 'overlay';
  initialDoc: EditorDoc;
  initialVersion: string;
  event: {
    theme: Theme;
    tokens: TokenContext;
    printSize: (typeof PRINT_SIZES)[number];
    aspect: (typeof ASPECTS)[number];
  };
  /** Assets the design already uses, with signed URLs. */
  assets: AssetView[];
  /** The organisation's uploaded fonts. */
  fonts: AssetView[];
  library: TemplateSummary[];
}

type SaveFailure = null | 'error' | 'conflict';

const newId = () => `el-${crypto.randomUUID().slice(0, 13)}`;

function isTyping(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) ||
    target.closest('[role="dialog"]') !== null
  );
}

/** Screen 6: the layout and overlay editor (PHO-4, PHO-6, PHO-9). */
export function TemplateEditor(p: TemplateEditorProps) {
  const t = useTranslations('studio.editor');
  const [state, dispatch] = useReducer(editorReducer, p.initialDoc, initialEditorState);
  const { doc, selection } = state;
  const W = doc.canvas.width;
  const H = doc.canvas.height;
  const unit = Math.min(W, H);

  // ---- Assets and fonts -------------------------------------------------------------------
  const [views, setViews] = useState(() => new Map([...p.assets, ...p.fonts].map((a) => [a.id, a])));
  const [images, setImages] = useState<Map<string, ImageBitmap>>(() => new Map());
  const [fonts, setFonts] = useState<{ resolve: FontResolver; version: number } | null>(null);
  const loading = useRef(new Set<string>());

  const addView = useCallback((a: AssetView) => setViews((m) => new Map(m).set(a.id, a)), []);
  const assetName = useCallback((id: string) => views.get(id)?.name ?? null, [views]);

  const neededImages = useMemo(
    () => templateAssetIds(doc).filter((id) => views.get(id)?.type !== 'font'),
    [doc, views],
  );
  useEffect(() => {
    for (const id of neededImages) {
      const v = views.get(id);
      if (!v || loading.current.has(id)) continue;
      loading.current.add(id);
      void fetch(v.url)
        .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(String(r.status)))))
        .then((b) => createImageBitmap(b))
        .then((bmp) => setImages((m) => new Map(m).set(id, bmp)))
        .catch(() => loading.current.delete(id));
    }
  }, [neededImages, views]);

  const faceKey = useMemo(() => JSON.stringify(templateFontFaces(doc)), [doc]);
  useEffect(() => {
    let live = true;
    const bytes = async (id: string) => {
      const v = views.get(id);
      if (!v) return null;
      const r = await fetch(v.url);
      return r.ok ? r.arrayBuffer() : null;
    };
    void prepareTemplateFonts(JSON.parse(faceKey) as TemplateFace[], bytes).then((resolve) => {
      if (live) setFonts((f) => ({ resolve, version: (f?.version ?? 0) + 1 }));
    });
    return () => {
      live = false;
    };
  }, [faceKey, views]);

  const inputs = useMemo<RenderInputs>(
    () => ({
      photos: [],
      tokens: p.event.tokens,
      assets: (id) => images.get(id) ?? null,
      qr: SAMPLE_QR,
      placeholders: true,
      fonts: fonts?.resolve,
    }),
    [p.event.tokens, images, fonts],
  );
  const redrawKey = images.size * 1000 + (fonts?.version ?? 0);

  // ---- Autosave with optimistic concurrency ------------------------------------------------
  const [saved, setSaved] = useState({ revision: 0, version: p.initialVersion });
  const [failure, setFailure] = useState<SaveFailure>(null);
  const versionRef = useRef(p.initialVersion);
  const inFlight = useRef<Promise<void> | null>(null);
  const latest = useRef(state);
  useEffect(() => {
    latest.current = state;
  });

  useEffect(() => {
    if (state.revision === saved.revision || failure === 'conflict') return;
    const timer = setTimeout(
      () => {
        const run = async () => {
          if (inFlight.current) await inFlight.current;
          const { doc: d, revision } = latest.current;
          const res = await saveTemplateAction(p.templateId, d, versionRef.current).catch(() => null);
          if (res?.ok) {
            versionRef.current = res.data.version;
            setSaved({ revision, version: res.data.version });
            setFailure(null);
          } else setFailure(res && !res.ok && res.error === 'conflict' ? 'conflict' : 'error');
        };
        inFlight.current = run().finally(() => {
          inFlight.current = null;
        });
      },
      failure === 'error' ? RETRY_MS : AUTOSAVE_MS,
    );
    return () => clearTimeout(timer);
  }, [state.revision, saved.revision, failure, p.templateId]);

  const dirty = state.revision !== saved.revision;
  const status = failure ?? (dirty ? 'saving' : 'saved');
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const resolveConflict = async (keep: 'mine' | 'theirs') => {
    const res = await templateLatestAction(p.templateId);
    if (!res.ok) return;
    versionRef.current = res.data.version;
    if (keep === 'theirs') {
      dispatch({ type: 'load', doc: res.data.doc as EditorDoc });
      setSaved({ revision: 0, version: res.data.version });
    }
    // "Keep mine": the next save is based on their version, so it goes through.
    setFailure(null);
  };

  // ---- Commands ------------------------------------------------------------------------------
  const duplicate = useCallback(
    (ids: string[]) => dispatch({ type: 'duplicate', ids, newIds: ids.map(() => newId()) }),
    [],
  );

  const add = (el: TemplateElement) => dispatch({ type: 'add', element: el });
  const common = { rotation: 0, opacity: 1, locked: false, hidden: false } as const;
  const centred = (w: number, h: number) => ({
    x: Math.round((W - w) / 2),
    y: Math.round((H - h) / 2),
    width: Math.round(w),
    height: Math.round(h),
  });

  const addPhoto = () => {
    const used = new Set(doc.elements.flatMap((e) => (e.type === 'photo' ? [e.shot] : [])));
    const shot = [0, 1, 2, 3].find((s) => !used.has(s)) ?? 0;
    const w = W * 0.6;
    add({
      ...common,
      ...centred(w, w * 0.75),
      id: newId(),
      type: 'photo',
      shot,
      fit: 'cover',
      cornerRadius: 0,
      filterId: null,
    });
  };
  const addText = () => {
    const size = Math.round(unit * 0.08);
    add({
      ...common,
      ...centred(W * 0.8, size * 1.6),
      id: newId(),
      type: 'text',
      text: '{eventName}',
      fontFamily: p.event.theme.font === 'serif' ? 'Instrument Serif' : 'Satoshi',
      fontWeight: p.event.theme.font === 'serif' ? 400 : 700,
      fontStyle: 'normal',
      fontSize: size,
      lineHeight: 1.15,
      letterSpacing: 0,
      color: p.event.theme.ink,
      align: 'center',
      verticalAlign: 'middle',
      uppercase: false,
      autoFit: true,
    });
  };
  const addShape = (shape: 'rect' | 'ellipse') => {
    const s = unit * 0.3;
    add({
      ...common,
      ...centred(s, s),
      id: newId(),
      type: 'shape',
      shape,
      fill: p.event.theme.accent,
      stroke: null,
      strokeWidth: 0,
      cornerRadius: 0,
    });
  };
  const addQr = () => {
    const side = Math.max(MIN_PRINT_QR_PX, Math.round(unit * 0.22));
    add({
      ...common,
      ...centred(side, side / 0.84),
      id: newId(),
      type: 'qr',
      dark: p.event.theme.ink,
      light: '#ffffff',
      showCode: true,
    });
  };
  const [imagePicker, setImagePicker] = useState(false);
  const addImage = (a: AssetView) => {
    addView(a);
    setImagePicker(false);
    const aspect = a.width && a.height ? a.width / a.height : 1;
    const w = Math.min(W * 0.5, H * 0.5 * aspect);
    add({ ...common, ...centred(w, w / aspect), id: newId(), type: 'image', assetId: a.id, fit: 'contain' });
  };

  // ---- Keyboard ------------------------------------------------------------------------------
  const nudgeTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return;
      const mod = e.metaKey || e.ctrlKey;
      const s = latest.current;
      const key = e.key.toLowerCase();
      const act = (a: EditorAction) => {
        e.preventDefault();
        dispatch(a);
      };
      if (mod && key === 'z') return act({ type: e.shiftKey ? 'redo' : 'undo' });
      if (mod && key === 'y') return act({ type: 'redo' });
      if (mod && key === 'a') return act({ type: 'selectAll' });
      if (!s.selection.length) return;
      if (e.key === 'Escape') return act({ type: 'select', ids: [] });
      if (e.key === 'Delete' || e.key === 'Backspace') return act({ type: 'remove', ids: s.selection });
      if (mod && key === 'd') {
        e.preventDefault();
        return duplicate(s.selection);
      }
      if (mod && (e.key === ']' || e.key === '[')) {
        const to = e.key === ']' ? (e.shiftKey ? 'front' : 'forward') : e.shiftKey ? 'back' : 'backward';
        return act({ type: 'arrange', ids: s.selection, to });
      }
      const step = e.shiftKey ? 10 : 1;
      const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
      if (d) {
        const movable = s.doc.elements.filter((el) => s.selection.includes(el.id) && !el.locked);
        act({
          type: 'patch',
          patches: movable.map((el) => ({ id: el.id, patch: { x: el.x + d[0]!, y: el.y + d[1]! } })),
          coalesce: 'nudge',
        });
        // A burst of nudges is one undo step.
        clearTimeout(nudgeTimer.current);
        nudgeTimer.current = setTimeout(() => dispatch({ type: 'commit' }), NUDGE_IDLE_MS);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      clearTimeout(nudgeTimer.current);
    };
  }, [duplicate]);

  // ---- Zoom ----------------------------------------------------------------------------------
  const [zoom, setZoom] = useState<number | 'fit'>('fit');
  const [fitScale, setFitScale] = useState(1);
  const scale = zoom === 'fit' ? fitScale : zoom;
  const zoomBy = (f: number) => setZoom(Math.min(8, Math.max(0.05, scale * f)));

  // ---- Panels --------------------------------------------------------------------------------
  const [left, setLeft] = useState<'layers' | 'templates'>('layers');
  const [mobile, setMobile] = useState<'layers' | 'templates' | 'inspect'>('inspect');
  const [library, setLibrary] = useState(p.library);
  const textFieldId = (id: string) => `text-field-${id}`;
  const editText = (id: string) => {
    dispatch({ type: 'select', ids: [id] });
    setMobile('inspect');
    requestAnimationFrame(() => document.getElementById(textFieldId(id))?.querySelector('textarea')?.focus());
  };
  const issues = p.kind === 'layout' ? printIssues(doc) : [];
  const fontAssets = useMemo(() => [...views.values()].filter((v) => v.type === 'font'), [views]);

  const leftPanel =
    left === 'layers' ? (
      <LayersPanel elements={doc.elements} selection={selection} dispatch={dispatch} assetName={assetName} />
    ) : (
      <TemplatesPanel
        kind={p.kind}
        current={doc}
        canvas={doc.canvas}
        printSize={p.event.printSize}
        aspect={p.event.aspect}
        theme={p.event.theme}
        library={library}
        onLibraryChange={setLibrary}
        dispatch={dispatch}
        inputs={inputs}
        tokens={p.event.tokens}
      />
    );
  const inspector = (
    <Inspector
      kind={p.kind}
      doc={doc}
      selection={selection}
      dispatch={dispatch}
      tokens={p.event.tokens}
      fonts={fontAssets}
      onAsset={addView}
      assetName={assetName}
      textFieldId={textFieldId}
      onDuplicate={duplicate}
    />
  );

  return (
    <div className="flex h-[calc(100dvh-13rem)] min-h-[600px] flex-col overflow-hidden rounded-xl border border-line bg-elev shadow-card">
      <div
        role="toolbar"
        aria-label={t('toolbar')}
        className="flex flex-wrap items-center gap-1 border-b border-line px-2 py-1.5"
      >
        {p.kind === 'layout' && (
          <IconButton
            label={t('add.photo')}
            onClick={addPhoto}
            disabled={doc.elements.filter((e) => e.type === 'photo').length >= 4}
          >
            <User className="size-4" aria-hidden />
          </IconButton>
        )}
        <IconButton label={t('add.text')} onClick={addText}>
          <Type className="size-4" aria-hidden />
        </IconButton>
        <IconButton label={t('add.image')} onClick={() => setImagePicker(true)}>
          <ImageIcon className="size-4" aria-hidden />
        </IconButton>
        <IconButton label={t('add.rect')} onClick={() => addShape('rect')}>
          <Square className="size-4" aria-hidden />
        </IconButton>
        <IconButton label={t('add.ellipse')} onClick={() => addShape('ellipse')}>
          <Circle className="size-4" aria-hidden />
        </IconButton>
        {p.kind === 'layout' && (
          <IconButton label={t('add.qr')} onClick={addQr}>
            <QrCode className="size-4" aria-hidden />
          </IconButton>
        )}
        <span className="mx-1 h-5 w-px bg-line" aria-hidden />
        <IconButton label={t('undo')} onClick={() => dispatch({ type: 'undo' })} disabled={!state.past.length}>
          <Undo2 className="size-4" aria-hidden />
        </IconButton>
        <IconButton label={t('redo')} onClick={() => dispatch({ type: 'redo' })} disabled={!state.future.length}>
          <Redo2 className="size-4" aria-hidden />
        </IconButton>
        <span className="mx-1 h-5 w-px bg-line" aria-hidden />
        <IconButton label={t('zoomOut')} onClick={() => zoomBy(1 / ZOOM_STEP)}>
          <ZoomOut className="size-4" aria-hidden />
        </IconButton>
        <span className="tabular w-12 text-center text-[12px] text-muted" aria-live="polite">
          {Math.round(scale * 100)}%
        </span>
        <IconButton label={t('zoomIn')} onClick={() => zoomBy(ZOOM_STEP)}>
          <ZoomIn className="size-4" aria-hidden />
        </IconButton>
        <IconButton label={t('zoomFit')} onClick={() => setZoom('fit')} active={zoom === 'fit'}>
          <Maximize className="size-4" aria-hidden />
        </IconButton>
        <div className="ml-auto flex items-center gap-2 pr-1">
          {issues.map((i) => (
            <Pill key={i} tone="warn" dot>
              {t(`issues.${i}`)}
            </Pill>
          ))}
          <span
            role="status"
            className={cx('text-[12px]', status === 'error' || status === 'conflict' ? 'text-bad' : 'text-faint')}
          >
            {t(`status.${status}`)}
          </span>
        </div>
      </div>

      {failure === 'conflict' && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-warn/10 px-4 py-2.5 text-[13px]"
        >
          <span>{t('conflict.body')}</span>
          <span className="flex gap-2">
            <Button size="sm" onClick={() => void resolveConflict('theirs')}>
              {t('conflict.theirs')}
            </Button>
            <Button size="sm" variant="primary" onClick={() => void resolveConflict('mine')}>
              {t('conflict.mine')}
            </Button>
          </span>
        </div>
      )}

      <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)_auto] lg:grid-cols-[250px_minmax(0,1fr)_310px] lg:grid-rows-1">
        <aside className="hidden min-h-0 flex-col border-r border-line lg:flex">
          <div className="border-b border-line p-2">
            <Segmented
              size="sm"
              value={left}
              onChange={setLeft}
              label={t('panels.label')}
              options={[
                { value: 'layers', label: t('panels.layers') },
                { value: 'templates', label: t('panels.templates') },
              ]}
            />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">{leftPanel}</div>
        </aside>

        <div className="relative min-h-0">
          <EditorStage
            doc={doc}
            selection={selection}
            dispatch={dispatch}
            inputs={inputs}
            redrawKey={redrawKey}
            zoom={zoom}
            onFitScale={setFitScale}
            transparent={p.kind === 'overlay'}
            guidesColor={ACCENT}
            selectionColor={ACCENT}
            onEditText={editText}
            label={t('canvasLabel')}
          />
        </div>

        <aside className="hidden min-h-0 overflow-y-auto border-l border-line lg:block">{inspector}</aside>

        {/* Narrow screens: one panel at a time under the canvas. */}
        <div className="max-h-[42vh] min-h-0 overflow-y-auto border-t border-line lg:hidden">
          <div className="sticky top-0 z-10 border-b border-line bg-elev p-2">
            <Segmented
              size="sm"
              value={mobile}
              onChange={(v) => {
                setMobile(v);
                if (v !== 'inspect') setLeft(v);
              }}
              label={t('panels.label')}
              options={[
                { value: 'inspect', label: t('panels.inspect') },
                { value: 'layers', label: t('panels.layers') },
                { value: 'templates', label: t('panels.templates') },
              ]}
            />
          </div>
          {mobile === 'inspect' ? inspector : leftPanel}
        </div>
      </div>

      <AssetPicker
        open={imagePicker}
        onClose={() => setImagePicker(false)}
        types={IMAGE_TYPES}
        onPick={addImage}
        title={t('pickImage')}
      />
    </div>
  );
}
