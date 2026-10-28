'use client';

import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { BoothHelpLink } from '@/components/BoothHelpLink';
import { formatBytes } from '@/lib/format';
import { HELP_ARTICLES } from '@/lib/help-links';
import { gradeStorage, worst, type Finding, type StorageCode } from '@/lib/setup-check/grading';
import type { StorageProbe } from '../check-session';
import { FindingList, Measurements, StepActions, outcomeOf, type StepProps } from '../check-ui';

type State = { kind: 'checking' } | { kind: 'done'; probe: StorageProbe; findings: Finding<StorageCode>[] };

/** Step 2: will the device keep a day's recordings? Persistence, free space, where takes are written. */
export function StorageStep({ session, onDone }: StepProps) {
  const t = useTranslations('check.storage');
  const locale = useLocale();
  const [state, setState] = useState<State>({ kind: 'checking' });

  useEffect(() => {
    let off = false;
    void session.probeStorage().then((probe) => {
      if (!off) setState({ kind: 'done', probe, findings: gradeStorage(probe) });
    });
    return () => {
      off = true;
    };
  }, [session]);

  const done = state.kind === 'done' ? state : null;
  const text = (f: Finding<StorageCode>) => t(`findings.${f.code}`, f.params ?? {});
  return (
    <div>
      <p className="text-sm leading-relaxed text-muted">{t('intro')}</p>
      {!done && (
        <p role="status" className="mt-4 text-sm text-muted">
          {t('checking')}
        </p>
      )}
      {done && (
        <>
          <Measurements
            rows={[
              {
                label: t('stats.free'),
                value: done.probe.freeBytes === null ? t('stats.unknown') : formatBytes(done.probe.freeBytes, locale),
              },
              { label: t('stats.persisted'), value: done.probe.persisted ? t('stats.yes') : t('stats.no') },
              { label: t('stats.backend'), value: t(`stats.backends.${done.probe.backend}`) },
            ]}
          />
          <div className="mt-4">
            <FindingList
              findings={done.findings}
              text={text}
              help={(f) =>
                f.code === 'notPersistedApple' || f.code === 'notPersisted' ? (
                  <BoothHelpLink slug={HELP_ARTICLES.iosStorage} label={t('help')} />
                ) : null
              }
            />
          </div>
        </>
      )}
      <StepActions
        busy={!done}
        status={done ? worst(done.findings) : null}
        onContinue={() => done && onDone(outcomeOf(done.findings, text))}
      />
    </div>
  );
}
