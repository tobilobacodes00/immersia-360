'use client';

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react';
import { useTranslations } from 'next-intl';
import { cx } from '@immersia/ui';
import { MIN_TRIM_MS, formatTime, peakAbs, rebucketPeaks, type Peaks } from './peaks';

/** Distance between waveform bars, in CSS px. */
const BAR_PITCH = 3;
/** Arrow keys move a handle 100 ms; with Shift (or PageUp/PageDown) one second. */
const STEP_MS = 100;
const BIG_STEP_MS = 1_000;
/** Quiet songs are scaled up so the waveform is readable, but silence is not blown up into noise. */
const MIN_FULL_SCALE = 0.05;

interface BoxSize {
  w: number;
  h: number;
  dpr: number;
}

function useElementSize(ref: RefObject<HTMLElement | null>): BoxSize | null {
  const [size, setSize] = useState<BoxSize | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const next = {
        w: Math.round(entry.contentRect.width),
        h: Math.round(entry.contentRect.height),
        dpr: window.devicePixelRatio || 1,
      };
      setSize((prev) => (prev && prev.w === next.w && prev.h === next.h && prev.dpr === next.dpr ? prev : next));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return size;
}

/** Bars for the whole song: accent inside the kept region, dimmed outside it. */
function drawWaveform(
  canvas: HTMLCanvasElement,
  columns: Peaks,
  scale: number,
  startFrac: number,
  endFrac: number,
  dpr: number,
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  // Resolved on every draw, so the canvas follows the design tokens rather than copies of them.
  const css = getComputedStyle(canvas);
  const token = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  const accent = token('--color-accent', '#2b3fe6');
  const wash = token('--color-accent-soft', '#eceefd');
  const dim = token('--color-subtle', '#a3a099');

  const { width, height } = canvas;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = wash;
  ctx.fillRect(startFrac * width, 0, (endFrac - startFrac) * width, height);

  const count = columns.min.length;
  const pitch = width / count;
  const barW = Math.max(1, pitch * 0.66);
  const mid = height / 2;
  const reach = mid - 2 * dpr;
  const minBar = Math.max(1, dpr) * 2;
  for (let i = 0; i < count; i++) {
    const x = i * pitch;
    const centre = (x + barW / 2) / width;
    ctx.fillStyle = centre >= startFrac && centre <= endFrac ? accent : dim;
    let top = mid - Math.min(1, columns.max[i]! * scale) * reach;
    let bottom = mid - Math.max(-1, columns.min[i]! * scale) * reach;
    if (bottom - top < minBar) {
      const c = (top + bottom) / 2;
      top = c - minBar / 2;
      bottom = c + minBar / 2;
    }
    ctx.fillRect(x, top, barW, bottom - top);
  }
}

interface HandleProps {
  side: 'start' | 'end';
  label: string;
  valueMs: number;
  min: number;
  max: number;
  durationMs: number;
  trackRef: RefObject<HTMLElement | null>;
  disabled: boolean;
  onMove: (ms: number) => void;
}

function TrimHandle({ side, label, valueMs, min, max, durationMs, trackRef, disabled, onMove }: HandleProps) {
  // Pointer id and the distance between the pointer and the handle's line at grab time, so grabbing
  // the knob off-centre doesn't make the handle jump.
  const grab = useRef<{ id: number; dx: number } | null>(null);

  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (disabled || e.altKey || e.ctrlKey || e.metaKey) return;
    const step = e.shiftKey ? BIG_STEP_MS : STEP_MS;
    let next: number;
    switch (e.key) {
      case 'ArrowLeft':
      case 'ArrowDown':
        next = valueMs - step;
        break;
      case 'ArrowRight':
      case 'ArrowUp':
        next = valueMs + step;
        break;
      case 'PageDown':
        next = valueMs - BIG_STEP_MS;
        break;
      case 'PageUp':
        next = valueMs + BIG_STEP_MS;
        break;
      case 'Home':
        next = min;
        break;
      case 'End':
        next = max;
        break;
      default:
        return;
    }
    e.preventDefault();
    onMove(next);
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const track = trackRef.current;
    if (disabled || !track || e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const rect = track.getBoundingClientRect();
    grab.current = { id: e.pointerId, dx: e.clientX - (rect.left + (valueMs / durationMs) * rect.width) };
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const g = grab.current;
    const track = trackRef.current;
    if (!g || !track || g.id !== e.pointerId) return;
    const rect = track.getBoundingClientRect();
    if (rect.width <= 0) return;
    onMove(((e.clientX - g.dx - rect.left) / rect.width) * durationMs);
  };

  return (
    <div className="absolute inset-y-0 w-0" style={{ left: `${(valueMs / durationMs) * 100}%` }}>
      <span aria-hidden className="absolute inset-y-0 w-0.5 -translate-x-1/2 bg-accent" />
      <div
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={valueMs}
        aria-valuetext={formatTime(valueMs)}
        aria-disabled={disabled || undefined}
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onLostPointerCapture={() => {
          grab.current = null;
        }}
        // The knob hangs off the outside of its line (start to the left, end to the right) so the two
        // never cover each other, even at the 500 ms minimum. The ::before widens the touch target.
        className={cx(
          'focus-ring absolute top-1/2 flex h-9 w-3.5 -translate-y-1/2 touch-none items-center justify-center gap-[3px] bg-accent select-none before:absolute before:-inset-2',
          side === 'start' ? 'right-0 rounded-l-md' : 'left-0 rounded-r-md',
          disabled ? 'cursor-not-allowed opacity-50' : 'cursor-ew-resize',
        )}
      >
        <span aria-hidden className="h-3 w-px bg-white/80" />
        <span aria-hidden className="h-3 w-px bg-white/80" />
      </div>
    </div>
  );
}

export interface TrimWaveformProps {
  peaks: Peaks;
  durationMs: number;
  startMs: number;
  endMs: number;
  disabled: boolean;
  /** The handle the pointer or key moved and where it asked to put it; the caller applies the limits. */
  onTrim: (handle: 'start' | 'end', ms: number) => void;
}

/** The song's waveform with the two draggable, keyboard-operable trim handles. */
export function TrimWaveform({ peaks, durationMs, startMs, endMs, disabled, onTrim }: TrimWaveformProps) {
  const t = useTranslations('studio.audioEditor');
  const trackRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const size = useElementSize(trackRef);

  const columnCount = size ? Math.max(1, Math.floor(size.w / BAR_PITCH)) : 1;
  const columns = useMemo(() => rebucketPeaks(peaks, columnCount), [peaks, columnCount]);
  const scale = useMemo(() => 1 / Math.max(peakAbs(peaks), MIN_FULL_SCALE), [peaks]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !size) return;
    drawWaveform(canvas, columns, scale, startMs / durationMs, endMs / durationMs, size.dpr);
  }, [size, columns, scale, startMs, endMs, durationMs]);

  const gap = Math.min(MIN_TRIM_MS, durationMs);
  return (
    <div>
      {/* Room at both sides for the knobs, which hang outside the track at 0 and at the song's end. */}
      <div role="group" aria-label={t('waveform')} className="px-4">
        <div ref={trackRef} className="relative h-24 w-full">
          <div className="absolute inset-0 overflow-hidden rounded-lg bg-sunken">
            <canvas
              ref={canvasRef}
              aria-hidden
              width={size ? Math.round(size.w * size.dpr) : 1}
              height={size ? Math.round(size.h * size.dpr) : 1}
              className="block size-full text-subtle"
            />
          </div>
          <TrimHandle
            side="start"
            label={t('trimStart')}
            valueMs={startMs}
            min={0}
            max={Math.max(0, endMs - gap)}
            durationMs={durationMs}
            trackRef={trackRef}
            disabled={disabled}
            onMove={(ms) => onTrim('start', ms)}
          />
          <TrimHandle
            side="end"
            label={t('trimEnd')}
            valueMs={endMs}
            min={Math.min(durationMs, startMs + gap)}
            max={durationMs}
            durationMs={durationMs}
            trackRef={trackRef}
            disabled={disabled}
            onMove={(ms) => onTrim('end', ms)}
          />
        </div>
      </div>
      <div className="tabular mt-2 flex items-center justify-between gap-3 text-[13px] text-muted">
        <span>{t('from', { time: formatTime(startMs) })}</span>
        <span className="font-medium text-fg">{t('length', { time: formatTime(endMs - startMs) })}</span>
        <span>{t('to', { time: formatTime(endMs) })}</span>
      </div>
    </div>
  );
}
