'use client';

import { useEffect, useRef, useState } from 'react';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { Clapperboard, Download, Trash2, Upload } from 'lucide-react';
import type { Aspect } from '@immersia/render-engine';
import { Button, Card, Field, Pill, Segmented } from '@immersia/ui';
import { formatBytes, formatClock, formatEventDate } from '@/lib/format';
import type { HighlightPlan, HighlightSummary, ReelLengthS, ReelQuality } from '@/server/highlights-core';
import {
  completeHighlightUploadAction,
  planHighlightAction,
  removeHighlightAction,
  startHighlightUploadAction,
} from '../../highlight-actions';
import type { BuiltReel, ReelProgress } from './reel/reel-build';
import { ReelError, putFile, reelFilename, type ReelErrorCode } from './reel/reel-io';

const LENGTHS: readonly LengthKey[] = ['30', '60', '90'];
const QUALITIES: readonly ReelQuality[] = ['720p', '1080p'];
const FORMATS: readonly Aspect[] = ['9:16', '1:1', '16:9'];

/** Segmented controls hold strings; the lengths are 30, 60 and 90 seconds. */
type LengthKey = `${ReelLengthS}`;

type Phase =
  | { kind: 'idle' }
  | { kind: 'building'; progress: ReelProgress }
  | { kind: 'ready'; reel: BuiltReel; url: string }
  | { kind: 'failed'; error: Exclude<ReelErrorCode, 'cancelled'> };

type Publishing =
  { kind: 'idle' } | { kind: 'uploading'; fraction: number } | { kind: 'done' } | { kind: 'failed'; withheld: boolean };

/**
 * LIV-14 on the event dashboard: build the event's highlight reel in this browser, preview it, download the MP4 and,
 * if wanted, publish it to the top of the client gallery. Only the gallery's own items go in (nothing hidden,
 * opted out, erased or expired), chosen by what guests downloaded, scanned and opened.
 */
export function HighlightReel({
  eventId,
  eventName,
  eventDate,
  aspect,
  items,
  hasMusic,
  existing,
}: {
  eventId: string;
  eventName: string;
  eventDate: string;
  /** The event's own video format: the reel's default. */
  aspect: Aspect;
  /** Captures in the public gallery. */
  items: number;
  hasMusic: boolean;
  existing: HighlightSummary | null;
}) {
  const t = useTranslations('studio.highlightReel');
  const locale = useLocale();
  const format = useFormatter();
  const [length, setLength] = useState<LengthKey>('60');
  const [quality, setQuality] = useState<ReelQuality>('1080p');
  const [shape, setShape] = useState<Aspect>(aspect);
  const [transitions, setTransitions] = useState<'beat' | 'fade'>(hasMusic ? 'beat' : 'fade');
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [publishing, setPublishing] = useState<Publishing>({ kind: 'idle' });
  const [published, setPublished] = useState<HighlightSummary | null>(existing);
  const [notice, setNotice] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  // The preview's object URL is revoked when it is replaced and when the card goes away.
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = abort;
    return () => controller.current?.abort();
  }, []);
  useEffect(() => {
    if (!previewUrl) return;
    return () => URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  const building = phase.kind === 'building';

  const build = async () => {
    const controller = new AbortController();
    abort.current = controller;
    setNotice(null);
    setPublishing({ kind: 'idle' });
    setPreviewUrl(null);
    setPhase({ kind: 'building', progress: { stage: 'downloading', fraction: 0 } });
    try {
      const planned = await planHighlightAction(eventId, { lengthS: Number(length), quality });
      if (!planned.ok) throw new ReelError('failed');
      const plan: HighlightPlan = planned.data;
      // The render engine is only fetched when a reel is actually built.
      const { buildHighlightReel } = await import('./reel/reel-build');
      const reel = await buildHighlightReel({
        plan,
        lengthS: Number(length) as ReelLengthS,
        quality,
        aspect: shape,
        transitions,
        text: {
          introSubtitle: t('card.subtitle'),
          dateLabel: formatEventDate(eventDate, locale, 'long'),
          endHint: t('card.hint'),
        },
        onProgress: (progress) => setPhase({ kind: 'building', progress }),
        signal: controller.signal,
      });
      const url = URL.createObjectURL(reel.mp4);
      setPreviewUrl(url);
      setPhase({ kind: 'ready', reel, url });
    } catch (err) {
      const code: ReelErrorCode = err instanceof ReelError ? err.code : 'failed';
      setPhase(code === 'cancelled' ? { kind: 'idle' } : { kind: 'failed', error: code });
    } finally {
      abort.current = null;
    }
  };

  const save = (reel: BuiltReel, url: string) => {
    const a = document.createElement('a');
    a.href = url;
    a.download = reelFilename(eventName, reel.durationS);
    a.click();
  };

  const publish = async (reel: BuiltReel) => {
    setPublishing({ kind: 'uploading', fraction: 0 });
    try {
      const ticket = await startHighlightUploadAction(eventId, {
        bytes: reel.mp4.size,
        width: reel.width,
        height: reel.height,
        durationMs: Math.round(reel.durationS * 1000),
        sessionIds: reel.sessionIds,
        posterBytes: reel.poster ? reel.poster.size : null,
      });
      if (!ticket.ok) {
        setPublishing({ kind: 'failed', withheld: ticket.issues?.includes('withheld') ?? false });
        return;
      }
      const { id, video, poster } = ticket.data;
      if (poster && reel.poster) await putFile(reel.poster, poster);
      await putFile(reel.mp4, video, (fraction) => setPublishing({ kind: 'uploading', fraction }));
      const done = await completeHighlightUploadAction(eventId, id);
      if (!done.ok) {
        setPublishing({ kind: 'failed', withheld: done.issues?.includes('withheld') ?? false });
        return;
      }
      setPublished(done.data);
      setPublishing({ kind: 'done' });
      setNotice(null);
    } catch {
      setPublishing({ kind: 'failed', withheld: false });
    }
  };

  const remove = async () => {
    setRemoving(true);
    const res = await removeHighlightAction(eventId);
    setRemoving(false);
    if (res.ok) {
      setPublished(null);
      setNotice(t('published.removed'));
    } else setNotice(t('errors.remove'));
  };

  const summary = (durationS: number, clips: number, bytes: number) =>
    t('summary', { duration: formatClock(durationS * 1000), clips, size: formatBytes(bytes, locale) });
  const percent = (v: number) => format.number(v, { style: 'percent', maximumFractionDigits: 0 });

  return (
    <Card title={t('title')} subtitle={t('subtitle')}>
      {published && (
        <div className="space-y-3 py-4">
          <div className="flex flex-wrap items-center gap-2">
            <Pill tone={published.withheld > 0 ? 'warn' : 'ok'} dot>
              {published.withheld > 0 ? t('published.hidden') : t('published.title')}
            </Pill>
            <span className="text-[13px] text-muted">
              {t('published.when', { date: format.dateTime(new Date(published.uploadedAt), { dateStyle: 'medium' }) })}
              {' · '}
              {summary(published.durationS, published.clips, published.bytes)}
            </span>
          </div>
          {published.withheld > 0 && (
            <p role="status" className="text-[13px] leading-relaxed text-muted">
              {t('published.withheld', { count: published.withheld })}
            </p>
          )}
          <video
            src={published.url}
            controls
            playsInline
            preload="metadata"
            aria-label={t('published.preview')}
            className="max-h-[22rem] max-w-full rounded-xl bg-black"
          />
          <div>
            <Button
              size="sm"
              variant="ghost"
              disabled={removing}
              icon={<Trash2 className="size-3.5" aria-hidden />}
              onClick={() => void remove()}
            >
              {t('published.remove')}
            </Button>
          </div>
        </div>
      )}
      {notice && (
        <p role="status" className="py-2 text-[13px] text-muted">
          {notice}
        </p>
      )}

      {items === 0 ? (
        <p className="py-4 text-[13px] leading-relaxed text-muted">{t('empty')}</p>
      ) : (
        <>
          <div className="divide-y divide-line">
            <Field label={t('options.length')} stack>
              <Segmented
                value={length}
                label={t('options.length')}
                onChange={setLength}
                options={LENGTHS.map((s) => ({ value: s, label: t('options.lengthSeconds', { seconds: Number(s) }) }))}
              />
            </Field>
            <Field label={t('options.quality')} help={t('options.qualityHelp')} stack>
              <Segmented
                value={quality}
                label={t('options.quality')}
                onChange={setQuality}
                options={QUALITIES.map((q) => ({ value: q, label: q }))}
              />
            </Field>
            <Field label={t('options.format')} stack>
              <Segmented
                value={shape}
                label={t('options.format')}
                onChange={setShape}
                options={FORMATS.map((f) => ({ value: f, label: f }))}
              />
            </Field>
            <Field label={t('options.transitions')} help={t('options.transitionsHelp')} stack>
              <Segmented
                value={transitions}
                label={t('options.transitions')}
                onChange={setTransitions}
                options={[
                  { value: 'beat', label: t('options.beat') },
                  { value: 'fade', label: t('options.fade') },
                ]}
              />
            </Field>
          </div>
          <p className="py-2 text-[13px] leading-relaxed text-faint">
            {hasMusic ? t('music.with') : t('music.without')}
          </p>

          <div className="flex flex-wrap items-center gap-2 py-3">
            {building ? (
              <Button onClick={() => abort.current?.abort()}>{t('cancel')}</Button>
            ) : (
              <Button
                variant="primary"
                icon={<Clapperboard className="size-4" aria-hidden />}
                onClick={() => void build()}
              >
                {phase.kind === 'ready' ? t('ready.again') : t('build')}
              </Button>
            )}
          </div>
        </>
      )}

      {phase.kind === 'building' && <BuildProgress progress={phase.progress} />}

      {phase.kind === 'failed' && (
        <p role="alert" className="py-3 text-[13px] text-bad">
          {t(`errors.${phase.error}`)}
        </p>
      )}

      {phase.kind === 'ready' && (
        <div className="space-y-3 border-t border-line py-4">
          <h4 className="text-sm font-semibold">{t('ready.title')}</h4>
          <p className="text-[13px] text-muted">
            {summary(phase.reel.durationS, phase.reel.clips, phase.reel.mp4.size)}
            {phase.reel.beatSynced && ` · ${t('ready.beatSynced')}`}
          </p>
          <video
            src={phase.url}
            controls
            playsInline
            preload="metadata"
            aria-label={t('ready.preview')}
            className="max-h-[26rem] max-w-full rounded-xl bg-black"
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="primary"
              icon={<Download className="size-4" aria-hidden />}
              onClick={() => save(phase.reel, phase.url)}
            >
              {t('ready.download')}
            </Button>
            <Button
              icon={<Upload className="size-4" aria-hidden />}
              disabled={publishing.kind === 'uploading'}
              onClick={() => void publish(phase.reel)}
            >
              {publishing.kind === 'uploading'
                ? t('ready.uploading', { percent: percent(publishing.fraction) })
                : t('ready.publish')}
            </Button>
          </div>
          {publishing.kind === 'done' && (
            <p role="status" className="text-[13px] text-muted">
              {t('ready.published')}
            </p>
          )}
          {publishing.kind === 'failed' && (
            <p role="alert" className="text-[13px] text-bad">
              {publishing.withheld ? t('errors.withheld') : t('errors.publish')}
            </p>
          )}
        </div>
      )}
    </Card>
  );
}

function BuildProgress({ progress }: { progress: ReelProgress }) {
  const t = useTranslations('studio.highlightReel.progress');
  const format = useFormatter();
  const percent = Math.round(progress.fraction * 100);
  const text =
    progress.stage === 'downloading'
      ? t('downloading', { done: progress.done ?? 0, total: progress.total ?? 0 })
      : t(progress.stage);
  return (
    <div className="space-y-2 border-t border-line py-4">
      <div
        role="progressbar"
        aria-label={t('label')}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        className="h-1.5 overflow-hidden rounded-full bg-sunken"
      >
        <div className="h-full bg-accent transition-[width] duration-150" style={{ width: `${percent}%` }} />
      </div>
      <p className="text-[13px] text-muted">
        <span role="status">{text}</span>{' '}
        <span aria-hidden className="tabular text-faint">
          {format.number(progress.fraction, { style: 'percent' })}
        </span>
      </p>
    </div>
  );
}
