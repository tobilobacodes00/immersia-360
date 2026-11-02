'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { AnimatePresence, motion } from 'motion/react';
import { FileArchive, Images, Upload, X } from 'lucide-react';
import {
  boothDb,
  takeStore,
  type BoothDB,
  type LocalOutput,
  type LocalSession,
  type TakeStore,
} from '@immersia/offline';
import { createOpfsWorker } from '@immersia/offline/opfs-worker';
import { Button, EmptyState, IconButton, Modal, Segmented, cx, softSpring } from '@immersia/ui';
import { formatBytes } from '@/lib/format';
import { workerUrl } from '@/lib/workers';
import { CAPTURE_KEYS, useLiveQuery } from './booth-hooks';
import {
  exportZip,
  isAbort,
  openSaveDestination,
  saveBlob,
  saveFilePicker,
  type ExportProgress,
  type ExportResult,
} from './gallery-export';
import { ViewObserver } from './gallery-media';
import {
  GALLERY_FILTERS,
  applyFilter,
  buildGalleryItems,
  countByFilter,
  needsMemoryWarning,
  outputFilename,
  totalBytes,
  zipEntries,
  zipFilename,
  type GalleryFilter,
  type GalleryItem,
} from './gallery-model';
import { GalleryCard } from './GalleryCard';
import { GalleryDetail } from './GalleryDetail';
import type { ImportResult } from './import-originals';

interface GallerySource {
  outputs: LocalOutput[];
  sessions: LocalSession[];
}

/** Everything this device holds for the event; live, so uploads and new captures show as they happen. */
async function loadSource(db: BoothDB, eventId: string): Promise<GallerySource> {
  const [outputs, sessions] = await Promise.all([
    db.outputs.where('[eventId+createdAt]').between([eventId, 0], [eventId, Infinity]).toArray(),
    db.sessions.where('[eventId+capturedAt]').between([eventId, 0], [eventId, Infinity]).toArray(),
  ]);
  return { outputs, sessions };
}

type ExportState =
  | { kind: 'idle' }
  | { kind: 'running'; filename: string; progress: ExportProgress }
  | { kind: 'done'; filename: string; via: ExportResult['via']; missing: number }
  | { kind: 'cancelled' }
  | { kind: 'failed' };

export interface GalleryProps {
  open: boolean;
  onClose: () => void;
  eventId: string;
  eventName: string;
  /** A countdown or recording is under way: exports and imports wait, pictures stop loading. */
  capturing: boolean;
  /** 360 booth only (the photo booth has no takes to import): add video files as takes. */
  onImport?: (files: File[], opts: { waitForIdle: () => Promise<void> }) => Promise<ImportResult>;
}

/**
 * Screen 15: the operator's event gallery. Everything this device captured and rendered for the
 * event, from its own database, so it works with no network: filter, open one to reshare its QR or
 * save it, import original videos, and export a ZIP of all of it or of a selection.
 */
export function Gallery({ open, ...panel }: GalleryProps) {
  return <AnimatePresence>{open && <GalleryPanel {...panel} />}</AnimatePresence>;
}

function GalleryPanel({ onClose, eventId, eventName, capturing, onImport }: Omit<GalleryProps, 'open'>) {
  const t = useTranslations('booth.gallery');
  const locale = useLocale();
  const db = boothDb();
  const source = useLiveQuery<GallerySource | null>(() => loadSource(db, eventId), [db, eventId], null);
  const [store, setStore] = useState<TakeStore | null>(null);
  const [viewer] = useState(() => new ViewObserver());
  const [filter, setFilter] = useState<GalleryFilter>('all');
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const [detailId, setDetailId] = useState<string | null>(null);
  const [saveFailed, setSaveFailed] = useState(false);
  const [exportState, setExportState] = useState<ExportState>({ kind: 'idle' });
  const [memoryWarn, setMemoryWarn] = useState<{ list: GalleryItem[]; bytes: number } | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importNote, setImportNote] = useState<ImportResult | null>(null);

  const panel = useRef<HTMLElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const abort = useRef<AbortController | null>(null);
  // Capture comes first: while it runs, exports and imports park between files (like the render queue).
  const gate = useRef({ paused: capturing, waiters: [] as (() => void)[] });

  const items = useMemo(() => (source ? buildGalleryItems(source.outputs, source.sessions) : null), [source]);
  const counts = useMemo(() => countByFilter(items ?? []), [items]);
  const shown = useMemo(() => applyFilter(items ?? [], filter), [items, filter]);
  const chosen = useMemo(() => (items ?? []).filter((i) => selected.has(i.id)), [items, selected]);
  const detail = detailId ? (items?.find((i) => i.id === detailId) ?? null) : null;
  const running = exportState.kind === 'running';

  // The take store is a singleton the booth opens too; asking here works before "Start booth" as well.
  useEffect(() => {
    let cancelled = false;
    takeStore(() => createOpfsWorker(workerUrl('opfs')))
      .then((s) => {
        if (!cancelled) setStore(s);
      })
      .catch((err) => console.error('[gallery] storage', err));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => () => viewer.dispose(), [viewer]);

  useEffect(() => {
    gate.current.paused = capturing;
    if (!capturing) for (const resume of gate.current.waiters.splice(0)) resume();
  }, [capturing]);

  // Closing the gallery (or leaving the booth) stops an export in progress.
  useEffect(() => () => abort.current?.abort(), []);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const frame = requestAnimationFrame(() => panel.current?.focus());
    return () => {
      cancelAnimationFrame(frame);
      previous?.focus?.();
    };
  }, []);

  const setScroller = useCallback((el: HTMLDivElement | null) => viewer.setRoot(el), [viewer]);

  const waitForIdle = useCallback(
    () =>
      gate.current.paused ? new Promise<void>((resolve) => gate.current.waiters.push(resolve)) : Promise.resolve(),
    [],
  );

  const closeDetail = useCallback(() => {
    setDetailId(null);
    setSaveFailed(false);
  }, []);

  const requestClose = useCallback(() => {
    if (abort.current) setConfirmClose(true);
    else onClose();
  }, [onClose]);

  // The gallery sits over the live booth, whose own window key handlers start and stop recordings
  // (Space, Enter, arrows, End, Escape). Intercept first: Escape closes the top layer here, and none
  // of those keys reach the booth while the gallery is open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopImmediatePropagation();
        if (confirmClose) setConfirmClose(false);
        else if (memoryWarn) setMemoryWarn(null);
        else if (detailId) closeDetail();
        else requestClose();
      } else if (CAPTURE_KEYS.has(e.key) || e.key === 'End') e.stopImmediatePropagation();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [confirmClose, memoryWarn, detailId, closeDetail, requestClose]);

  const onActivate = useCallback(
    (id: string) => {
      if (!selecting) {
        setDetailId(id);
        return;
      }
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    },
    [selecting],
  );

  const toggleSelecting = () => {
    setSelecting((on) => !on);
    setSelected(new Set());
  };

  const saveOne = async (item: GalleryItem) => {
    if (!store) return;
    setSaveFailed(false);
    try {
      saveBlob(await store.read(item.path, item.mime), outputFilename(item));
    } catch (err) {
      console.warn('[gallery] save', item.path, err);
      setSaveFailed(true);
    }
  };

  const runImport = async (files: File[]) => {
    if (!onImport || files.length === 0) return;
    setImporting(true);
    setImportNote(null);
    try {
      setImportNote(await onImport(files, { waitForIdle }));
    } catch (err) {
      console.error('[gallery] import', err);
      setImportNote({ imported: 0, skipped: 0, failed: files.length });
    } finally {
      setImporting(false);
    }
  };

  /**
   * Must be called straight from a click: the save dialog needs the gesture, so it opens before
   * anything slow happens.
   */
  const startExport = async (list: readonly GalleryItem[], confirmed = false) => {
    if (!store || list.length === 0 || capturing || abort.current) return;
    const controller = new AbortController();
    abort.current = controller;
    try {
      const entries = zipEntries(list);
      const bytes = totalBytes(entries);
      const filename = zipFilename(eventName, new Date());
      const picker = saveFilePicker();
      let destination: WritableStream<Uint8Array> | null = null;
      if (picker) {
        try {
          destination = await openSaveDestination(picker, filename);
        } catch (err) {
          if (isAbort(err)) return; // the operator closed the dialog
          console.warn('[gallery export] no save dialog, downloading instead', err);
        }
      }
      if (!destination && !confirmed && needsMemoryWarning(bytes)) {
        setMemoryWarn({ list: [...list], bytes });
        return;
      }
      controller.signal.addEventListener('abort', () => gate.current.waiters.splice(0).forEach((r) => r()), {
        once: true,
      });
      setExportState({
        kind: 'running',
        filename,
        progress: { doneBytes: 0, totalBytes: bytes, fileIndex: 0, fileCount: entries.length },
      });
      const result = await exportZip({
        entries,
        filename,
        destination,
        signal: controller.signal,
        read: (entry) => store.read(entry.source.path, entry.source.mime),
        onProgress: (progress) => setExportState((s) => (s.kind === 'running' ? { ...s, progress } : s)),
        waitForIdle,
      });
      setExportState({ kind: 'done', filename, via: result.via, missing: result.missing });
    } catch (err) {
      if (controller.signal.aborted || isAbort(err)) setExportState({ kind: 'cancelled' });
      else {
        console.error('[gallery export]', err);
        setExportState({ kind: 'failed' });
      }
    } finally {
      abort.current = null;
    }
  };

  const exportBlocked = !store || capturing || running;
  const percent =
    exportState.kind === 'running' && exportState.progress.totalBytes > 0
      ? Math.min(100, Math.round((exportState.progress.doneBytes / exportState.progress.totalBytes) * 100))
      : 0;

  return (
    <motion.div className="fixed inset-0 z-40" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <div className="absolute inset-0 bg-[#111110]/30" onClick={requestClose} />
      <motion.section
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={t('title')}
        tabIndex={-1}
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        exit={{ x: '100%' }}
        transition={softSpring}
        className="absolute inset-y-0 right-0 flex w-full max-w-5xl flex-col bg-bg text-fg shadow-pop outline-none"
        style={{ fontSize: 15 }}
      >
        <header className="flex items-center justify-between gap-3 border-b border-line px-6 py-4">
          <div className="min-w-0">
            <h2 className="text-base font-semibold">{t('title')}</h2>
            <p className="tabular text-[13px] text-muted">
              {items ? t('summary', { count: items.length }) : t('loading')}
            </p>
          </div>
          <IconButton label={t('close')} onClick={requestClose}>
            <X className="size-4" />
          </IconButton>
        </header>

        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-6 py-3">
          <Segmented
            label={t('filters')}
            value={filter}
            onChange={setFilter}
            options={GALLERY_FILTERS.map((f) => ({
              value: f,
              label: (
                <>
                  {t(`filter.${f}`)} <span className="tabular text-faint">{counts[f]}</span>
                </>
              ),
            }))}
          />
          <div className="flex flex-wrap items-center gap-2">
            {onImport && (
              <>
                <input
                  ref={fileInput}
                  type="file"
                  accept="video/*"
                  multiple
                  className="sr-only"
                  aria-hidden
                  tabIndex={-1}
                  onChange={(e) => {
                    void runImport(Array.from(e.target.files ?? []));
                    e.target.value = '';
                  }}
                />
                <Button
                  icon={<Upload className="size-4" aria-hidden />}
                  disabled={importing || capturing}
                  onClick={() => fileInput.current?.click()}
                >
                  {importing ? t('importing') : t('importOriginals')}
                </Button>
              </>
            )}
            <Button
              variant={selecting ? 'subtle' : 'secondary'}
              aria-pressed={selecting}
              onClick={toggleSelecting}
              disabled={!items?.length}
            >
              {t('select')}
            </Button>
            {selecting ? (
              <Button
                variant="primary"
                icon={<FileArchive className="size-4" aria-hidden />}
                disabled={exportBlocked || chosen.length === 0}
                onClick={() => void startExport(chosen)}
              >
                {t('exportSelected', { count: chosen.length })}
              </Button>
            ) : (
              <Button
                variant="primary"
                icon={<FileArchive className="size-4" aria-hidden />}
                disabled={exportBlocked || !items?.length}
                onClick={() => void startExport(items ?? [])}
              >
                {t('exportAll', { count: items?.length ?? 0 })}
              </Button>
            )}
          </div>
        </div>

        {selecting && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-line bg-elev px-6 py-2 text-[13px]">
            <span className="tabular font-medium" aria-live="polite">
              {t('selected', { count: chosen.length })}
            </span>
            <button
              type="button"
              className="focus-ring rounded font-medium text-accent"
              onClick={() => setSelected(new Set(shown.map((i) => i.id)))}
            >
              {t('selectAll')}
            </button>
            <button
              type="button"
              className="focus-ring rounded font-medium text-muted"
              onClick={() => setSelected(new Set())}
            >
              {t('clearSelection')}
            </button>
          </div>
        )}

        <div aria-live="polite">
          {exportState.kind === 'running' && (
            <div className="border-b border-line bg-elev px-6 py-3">
              <div className="flex items-center justify-between gap-3 text-[13px]">
                <span className="tabular min-w-0">
                  {capturing
                    ? t('exportPaused')
                    : t('exporting', {
                        done: formatBytes(exportState.progress.doneBytes, locale),
                        total: formatBytes(exportState.progress.totalBytes, locale),
                        index: exportState.progress.fileIndex,
                        count: exportState.progress.fileCount,
                      })}
                </span>
                <Button size="sm" onClick={() => abort.current?.abort()}>
                  {t('cancel')}
                </Button>
              </div>
              <div
                role="progressbar"
                aria-label={t('exportProgress')}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={percent}
                className="mt-2 h-1.5 overflow-hidden rounded-full bg-sunken"
              >
                <div className="h-full bg-accent transition-[width]" style={{ width: `${percent}%` }} />
              </div>
            </div>
          )}
          {exportState.kind === 'done' && (
            <Notice tone="ok" dismissLabel={t('dismiss')} onDismiss={() => setExportState({ kind: 'idle' })}>
              {t(exportState.via === 'file' ? 'exportSaved' : 'exportDownloaded', { name: exportState.filename })}
              {exportState.missing > 0 && ` ${t('exportMissing', { count: exportState.missing })}`}
            </Notice>
          )}
          {exportState.kind === 'cancelled' && (
            <Notice dismissLabel={t('dismiss')} onDismiss={() => setExportState({ kind: 'idle' })}>
              {t('exportCancelled')}
            </Notice>
          )}
          {exportState.kind === 'failed' && (
            <Notice
              tone="bad"
              role="alert"
              dismissLabel={t('dismiss')}
              onDismiss={() => setExportState({ kind: 'idle' })}
            >
              {t('exportFailed')}
            </Notice>
          )}
          {importNote && (
            <Notice
              tone={importNote.failed > 0 ? 'bad' : importNote.imported > 0 ? 'ok' : 'neutral'}
              dismissLabel={t('dismiss')}
              onDismiss={() => setImportNote(null)}
            >
              {[
                importNote.imported > 0 && t('importDone', { count: importNote.imported }),
                importNote.skipped > 0 && t('importSkipped', { count: importNote.skipped }),
                importNote.failed > 0 && t('importFailed', { count: importNote.failed }),
              ]
                .filter(Boolean)
                .join(' ')}
            </Notice>
          )}
          {capturing && exportState.kind !== 'running' && (
            <Notice dismissLabel={t('dismiss')}>{t('capturingNote')}</Notice>
          )}
        </div>

        <div ref={setScroller} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {!items ? (
            <p role="status" className="p-6 text-muted">
              {t('loading')}
            </p>
          ) : items.length === 0 ? (
            <EmptyState icon={<Images className="size-5" />} title={t('empty')} body={t('emptyBody')} />
          ) : shown.length === 0 ? (
            <EmptyState icon={<Images className="size-5" />} title={t('emptyFilter')} />
          ) : (
            <ul className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3 p-4 sm:p-6">
              {shown.map((item) => (
                <GalleryCard
                  key={item.id}
                  item={item}
                  store={store}
                  viewer={viewer}
                  paused={capturing}
                  selecting={selecting}
                  selected={selected.has(item.id)}
                  onActivate={onActivate}
                />
              ))}
            </ul>
          )}
        </div>
      </motion.section>

      <Modal
        open={detail !== null}
        onClose={closeDetail}
        title={detail ? t(`kinds.${detail.kind}`) : undefined}
        width="max-w-3xl"
      >
        {detail && store && (
          <GalleryDetail item={detail} store={store} onSave={() => void saveOne(detail)} saveFailed={saveFailed} />
        )}
      </Modal>

      <Modal open={memoryWarn !== null} onClose={() => setMemoryWarn(null)} title={t('memoryTitle')}>
        <div className="space-y-4 p-6" style={{ fontSize: 15 }}>
          <p className="leading-relaxed text-muted">
            {t('memoryBody', { size: formatBytes(memoryWarn?.bytes ?? 0, locale) })}
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setMemoryWarn(null)}>
              {t('cancel')}
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                const list = memoryWarn?.list ?? [];
                setMemoryWarn(null);
                void startExport(list, true);
              }}
            >
              {t('exportAnyway')}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal open={confirmClose} onClose={() => setConfirmClose(false)} title={t('stopTitle')}>
        <div className="space-y-4 p-6" style={{ fontSize: 15 }}>
          <p className="leading-relaxed text-muted">{t('stopBody')}</p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirmClose(false)}>
              {t('keepExporting')}
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                abort.current?.abort();
                onClose();
              }}
            >
              {t('stopAndClose')}
            </Button>
          </div>
        </div>
      </Modal>
    </motion.div>
  );
}

function Notice({
  tone = 'neutral',
  role = 'status',
  children,
  onDismiss,
  dismissLabel,
}: {
  tone?: 'neutral' | 'ok' | 'bad';
  role?: 'status' | 'alert';
  children: ReactNode;
  onDismiss?: () => void;
  dismissLabel: string;
}) {
  return (
    <div
      role={role}
      className={cx(
        'flex items-start justify-between gap-3 border-b border-line px-6 py-2.5 text-[13px]',
        tone === 'ok' && 'bg-ok/[0.06] text-ok',
        tone === 'bad' && 'bg-bad/[0.06] text-bad',
        tone === 'neutral' && 'bg-elev text-muted',
      )}
    >
      <span className="min-w-0 break-words">{children}</span>
      {onDismiss && (
        <button type="button" className="focus-ring shrink-0 rounded font-semibold" onClick={onDismiss}>
          {dismissLabel}
        </button>
      )}
    </div>
  );
}
