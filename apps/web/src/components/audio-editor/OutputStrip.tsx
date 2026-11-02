'use client';

import type { RefObject } from 'react';
import { useTranslations } from 'next-intl';
import { formatTime } from './peaks';

/** Drawing space of the SVG; it stretches to the container, strokes stay hairline. */
const W = 1000;
const TOP = 6;
const BASE = 96;

export interface OutputStripProps {
  /** `gainEnvelope` points: [seconds on the video, gain]. Empty when the music never sounds. */
  envelope: readonly (readonly [number, number])[];
  outputSeconds: number;
  volume: number;
  /** The song would run past the end of the video and is cut there. */
  clipped: boolean;
  playing: boolean;
  /** Mounted only while playing; the preview moves it directly. */
  playheadRef: RefObject<HTMLDivElement | null>;
}

function tickEvery(seconds: number): number {
  if (seconds <= 20) return 1;
  if (seconds <= 60) return 5;
  return 10;
}

/**
 * The video's timeline with the music block and its gain envelope drawn from the same
 * `gainEnvelope` points the renderer mixes with.
 */
export function OutputStrip({ envelope, outputSeconds, volume, clipped, playing, playheadRef }: OutputStripProps) {
  const t = useTranslations('studio.audioEditor');
  const first = envelope[0];
  const last = envelope[envelope.length - 1];

  const x = (seconds: number) => (seconds / outputSeconds) * W;
  const y = (gain: number) => BASE - gain * (BASE - TOP);
  const line = envelope.map(([s, g]) => `${x(s)},${y(g)}`).join(' ');

  const step = tickEvery(outputSeconds);
  const ticks: number[] = [];
  for (let s = step; s < outputSeconds; s += step) ticks.push(s);

  return (
    <div>
      {/* Decorative: the caption below says the same in words. */}
      <div aria-hidden className="relative h-16 overflow-hidden rounded-lg bg-sunken">
        <svg viewBox={`0 0 ${W} 100`} preserveAspectRatio="none" className="absolute inset-0 size-full">
          {ticks.map((s) => (
            <line
              key={s}
              x1={x(s)}
              x2={x(s)}
              y1={0}
              y2={100}
              className="stroke-line-strong"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
              opacity={0.6}
            />
          ))}
          {first && last && (
            <>
              <polygon points={`${x(first[0])},${BASE} ${line} ${x(last[0])},${BASE}`} className="fill-accent-soft" />
              <polyline
                points={line}
                fill="none"
                className="stroke-accent"
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
            </>
          )}
        </svg>
        {playing && (
          <div ref={playheadRef} className="absolute inset-y-0 w-0.5 -translate-x-1/2 bg-fg" style={{ left: '0%' }} />
        )}
      </div>
      <div aria-hidden className="tabular mt-1.5 flex justify-between text-xs text-faint">
        <span>{formatTime(0)}</span>
        <span>{formatTime(outputSeconds * 1000)}</span>
      </div>
      <p className="mt-2 text-[13px] leading-relaxed text-muted">
        {first && last
          ? t('stripLabel', {
              from: formatTime(first[0] * 1000),
              to: formatTime(last[0] * 1000),
              volume: Math.round(volume * 100),
            })
          : t('stripEmpty')}
        {clipped && ` ${t('clipped')}`}
      </p>
    </div>
  );
}
