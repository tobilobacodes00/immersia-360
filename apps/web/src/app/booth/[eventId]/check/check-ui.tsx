'use client';

import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { CheckCircle2, CircleX, TriangleAlert } from 'lucide-react';
import type { SetupCheckStatus } from '@immersia/shared';
import { Button, Pill, cx, type PillTone } from '@immersia/ui';
import { worst, type Finding, type Graded } from '@/lib/setup-check/grading';
import type { CheckSession } from './check-session';
import type { CheckPlan } from '@/lib/setup-check/config';

/** One finding as the operator reads it: already in their language, so later screens need no step knowledge. */
export interface Line {
  status: Graded;
  text: string;
}

/** What a finished step leaves behind. */
export interface Outcome {
  status: SetupCheckStatus;
  lines: Line[];
}

export const outcomeOf = <C extends string>(
  findings: readonly Finding<C>[],
  text: (finding: Finding<C>) => string,
): Outcome => ({ status: worst(findings), lines: findings.map((f) => ({ status: f.status, text: text(f) })) });

export const SKIPPED: Outcome = { status: 'skipped', lines: [] };

/** What the summary and the report need from several steps. */
export interface Facts {
  cameraFps: number;
  cameraResolution: string | null;
  referenceMs: number | null;
  eventMs: number | null;
  renderPath: 'local' | 'wasm' | 'server';
  mbps: number | null;
}

export interface StepProps {
  session: CheckSession;
  plan: CheckPlan;
  /** The step is finished (the operator pressed Continue, or skipped it). */
  onDone: (outcome: Outcome, facts?: Partial<Facts>) => void;
}

const TONE: Record<SetupCheckStatus | 'current' | 'waiting', PillTone> = {
  pass: 'ok',
  warn: 'warn',
  fail: 'bad',
  skipped: 'neutral',
  current: 'info',
  waiting: 'neutral',
};

export function StatusPill({ status }: { status: SetupCheckStatus | 'current' | 'waiting' }) {
  const t = useTranslations('check.status');
  return <Pill tone={TONE[status]}>{t(status)}</Pill>;
}

const ICONS: Record<Graded, { Icon: typeof CheckCircle2; className: string }> = {
  pass: { Icon: CheckCircle2, className: 'text-ok' },
  warn: { Icon: TriangleAlert, className: 'text-warn' },
  fail: { Icon: CircleX, className: 'text-bad' },
};

/** One line per finding: an icon (with a text alternative), what was found and what to do about it. */
export function FindingList<C extends string>({
  findings,
  text,
  help,
}: {
  findings: readonly Finding<C>[];
  text: (finding: Finding<C>) => string;
  help?: (finding: Finding<C>) => ReactNode;
}) {
  const t = useTranslations('check.findingLabel');
  return (
    <ul className="space-y-2.5">
      {findings.map((f) => {
        const { Icon, className } = ICONS[f.status];
        return (
          <li key={f.code} className="flex items-start gap-3 text-sm leading-relaxed">
            <Icon className={cx('mt-0.5 size-4 shrink-0', className)} aria-hidden />
            <div className="min-w-0">
              <span className="sr-only">{t(f.status)}: </span>
              {text(f)}
              {help?.(f) && <div className="mt-1">{help(f)}</div>}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** Findings already turned into words (a finished step, the summary). */
export function LineList({ lines }: { lines: readonly Line[] }) {
  const t = useTranslations('check.findingLabel');
  return (
    <ul className="space-y-2">
      {lines.map((l) => {
        const { Icon, className } = ICONS[l.status];
        return (
          <li key={l.text} className="flex items-start gap-3 text-[13px] leading-relaxed">
            <Icon className={cx('mt-0.5 size-4 shrink-0', className)} aria-hidden />
            <span>
              <span className="sr-only">{t(l.status)}: </span>
              {l.text}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** Retry / Continue / Skip, the same three everywhere. */
export function StepActions({
  busy,
  status,
  onRetry,
  onContinue,
  onSkip,
  retryLabel,
}: {
  busy: boolean;
  /** Worst status of the findings, or null while there are none yet. */
  status: Graded | null;
  onRetry?: () => void;
  onContinue: () => void;
  onSkip?: () => void;
  retryLabel?: string;
}) {
  const t = useTranslations('check.actions');
  return (
    <div className="mt-5 flex flex-wrap items-center gap-2">
      <Button variant="primary" disabled={busy || status === null} onClick={onContinue}>
        {status === 'fail' ? t('continueAnyway') : t('continue')}
      </Button>
      {onRetry && (
        <Button disabled={busy} onClick={onRetry}>
          {retryLabel ?? t('retry')}
        </Button>
      )}
      {onSkip && (
        <Button variant="ghost" disabled={busy} onClick={onSkip}>
          {t('skip')}
        </Button>
      )}
    </div>
  );
}

/** A thin progress bar with a text alternative. */
export function Progress({ share, label }: { share: number; label: string }) {
  const pct = Math.round(Math.min(1, Math.max(0, share)) * 100);
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      className="h-1.5 w-full overflow-hidden rounded-full bg-sunken"
    >
      <div className="h-full rounded-full bg-accent transition-[width] duration-150" style={{ width: `${pct}%` }} />
    </div>
  );
}

/** Small "label  value" rows for the measurements behind a verdict. */
export function Measurements({ rows }: { rows: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 rounded-lg bg-sunken px-4 py-3 text-[13px]">
      {rows.map((r) => (
        <div key={r.label} className="contents">
          <dt className="text-muted">{r.label}</dt>
          <dd className="tabular font-medium text-fg">{r.value}</dd>
        </div>
      ))}
    </dl>
  );
}
