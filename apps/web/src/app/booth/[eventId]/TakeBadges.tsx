'use client';

import { useTranslations } from 'next-intl';
import type { LocalTake } from '@immersia/offline';
import { Pill, type PillTone } from '@immersia/ui';

/**
 * Where a take came from. Kept apart from its render status so it survives the render: a recovered
 * take is still worth flagging to the operator after it has been rendered.
 */
export function takeOrigin(take: LocalTake): 'recovered' | 'imported' | null {
  if (take.recoveredAt) return 'recovered';
  if (take.trigger === 'import') return 'imported';
  return null;
}

/** The render stage as the operator reads it: recovered and imported takes waiting are "Ready to render". */
export function takeStage(take: LocalTake): LocalTake['status'] {
  return take.status === 'interrupted' || take.status === 'imported' ? 'recorded' : take.status;
}

const STAGE_TONE: Partial<Record<LocalTake['status'], PillTone>> = {
  rendered: 'ok',
  rendering: 'info',
  failed: 'bad',
};

/** Origin (if notable) and render stage of a take. */
export function TakeBadges({ take }: { take: LocalTake }) {
  const ts = useTranslations('booth.takeStatus');
  const to = useTranslations('booth.takeOrigin');
  const origin = takeOrigin(take);
  const stage = takeStage(take);
  return (
    <span className="flex shrink-0 items-center gap-1.5">
      {origin && <Pill tone={origin === 'recovered' ? 'warn' : 'neutral'}>{to(origin)}</Pill>}
      <Pill tone={STAGE_TONE[stage] ?? 'neutral'}>{ts(stage)}</Pill>
    </span>
  );
}
