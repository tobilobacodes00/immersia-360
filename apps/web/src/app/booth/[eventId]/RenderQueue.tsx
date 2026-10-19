'use client';

import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { AnimatePresence, motion } from 'motion/react';
import { Play, RotateCcw, Trash2, X } from 'lucide-react';
import { boothDb, deleteTakeAndOutputs, outputsForTake, type LocalTake, type TakeStore } from '@immersia/offline';
import { Button, EmptyState, IconButton, Modal, softSpring } from '@immersia/ui';
import type { Messages } from 'next-intl';
import { formatBytes, formatRelative } from '@/lib/format';
import { TakeBadges } from './TakeBadges';
import type { RenderState } from './use-render-queue';

type RenderErrorKey = keyof Messages['booth']['renderErrors'];

/** Screen 14: render queue — progress, retry, open, delete. */
export function RenderQueue({
  open,
  onClose,
  takes,
  current,
  store,
  onRetry,
  onCancel,
}: {
  open: boolean;
  onClose: () => void;
  takes: LocalTake[];
  current: RenderState | null;
  store: TakeStore | null;
  onRetry: (takeId: string) => void;
  onCancel: () => void;
}) {
  const t = useTranslations('booth.renderQueue');
  const te = useTranslations('booth.renderErrors');
  const locale = useLocale();
  const [playing, setPlaying] = useState<{ url: string; takeId: string } | null>(null);
  const [deleting, setDeleting] = useState<LocalTake | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Revoke the object URL when the player closes.
  useEffect(
    () => () => {
      if (playing) URL.revokeObjectURL(playing.url);
    },
    [playing],
  );

  const play = async (take: LocalTake) => {
    if (!store) return;
    const [mp4] = (await outputsForTake(boothDb(), take.id)).filter((o) => o.kind === 'mp4');
    if (!mp4) return;
    const blob = await store.read(mp4.path, mp4.mime);
    setPlaying({ url: URL.createObjectURL(blob), takeId: take.id });
  };

  return (
    <>
      <AnimatePresence>
        {open && (
          <motion.div
            className="fixed inset-0 z-40"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <div className="absolute inset-0 bg-[#111110]/30" onClick={onClose} />
            <motion.aside
              role="dialog"
              aria-modal="true"
              aria-label={t('title')}
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={softSpring}
              className="absolute inset-y-0 right-0 flex w-full max-w-md flex-col bg-bg text-fg shadow-pop"
              style={{ fontSize: 15 }}
            >
              <header className="flex items-center justify-between border-b border-line px-6 py-4">
                <h2 className="text-base font-semibold">{t('title')}</h2>
                <IconButton label={t('close')} onClick={onClose}>
                  <X className="size-4" />
                </IconButton>
              </header>
              <div className="flex-1 overflow-y-auto">
                {takes.length === 0 ? (
                  <EmptyState icon={<Play className="size-5" />} title={t('empty')} />
                ) : (
                  <ul className="divide-y divide-line">
                    {takes.map((tk) => {
                      const active = current?.takeId === tk.id;
                      return (
                        <li key={tk.id} className="px-6 py-3.5">
                          <div className="flex items-center gap-3">
                            <div className="min-w-0 flex-1">
                              <div className="text-sm font-medium">
                                {formatRelative(new Date(tk.capturedAt), locale)}
                              </div>
                              <div className="tabular text-[12px] text-faint">
                                {(tk.durationMs / 1000).toFixed(1)} s · {formatBytes(tk.bytes, locale)}
                                {tk.status === 'failed' && tk.error && (
                                  <>
                                    {' '}
                                    ·{' '}
                                    {te.has(tk.error as RenderErrorKey) ? te(tk.error as RenderErrorKey) : te('failed')}
                                  </>
                                )}
                              </div>
                            </div>
                            <TakeBadges take={tk} />
                            <div className="flex items-center gap-0.5">
                              {tk.status === 'rendered' && (
                                <IconButton label={t('open')} onClick={() => void play(tk)}>
                                  <Play className="size-4" />
                                </IconButton>
                              )}
                              {tk.status === 'failed' && (
                                <IconButton label={t('retry')} onClick={() => onRetry(tk.id)}>
                                  <RotateCcw className="size-4" />
                                </IconButton>
                              )}
                              {active ? (
                                <IconButton label={t('cancel')} onClick={onCancel}>
                                  <X className="size-4" />
                                </IconButton>
                              ) : (
                                tk.status !== 'recording' && (
                                  <IconButton label={t('delete')} onClick={() => setDeleting(tk)}>
                                    <Trash2 className="size-4" />
                                  </IconButton>
                                )
                              )}
                            </div>
                          </div>
                          {active && (
                            <div
                              className="mt-2 h-1.5 overflow-hidden rounded-full bg-sunken"
                              role="progressbar"
                              aria-label={t('progress')}
                              aria-valuemin={0}
                              aria-valuemax={100}
                              aria-valuenow={Math.round(current.progress * 100)}
                            >
                              <div
                                className="h-full bg-accent transition-[width]"
                                style={{ width: `${current.progress * 100}%` }}
                              />
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </motion.aside>
          </motion.div>
        )}
      </AnimatePresence>

      <Modal open={Boolean(playing)} onClose={() => setPlaying(null)} title={t('preview')} width="max-w-md">
        {playing && (
          // Guest output, muted autoplay so it plays everywhere without a gesture.
          <video
            src={playing.url}
            controls
            autoPlay
            muted
            playsInline
            className="block max-h-[75dvh] w-full bg-black"
          />
        )}
      </Modal>

      <Modal open={Boolean(deleting)} onClose={() => setDeleting(null)} title={t('deleteTitle')}>
        <div className="space-y-4 p-6">
          <p className="text-sm leading-relaxed text-muted">{t('deleteBody')}</p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setDeleting(null)}>
              {t('keep')}
            </Button>
            <Button
              variant="danger"
              onClick={async () => {
                if (deleting && store) await deleteTakeAndOutputs(boothDb(), store, deleting.id);
                setDeleting(null);
              }}
            >
              {t('delete')}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
