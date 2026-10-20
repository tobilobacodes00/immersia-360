'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Printer } from 'lucide-react';
import { browserPrint } from '@immersia/layout/print';
import { PRINT_SIZE_INCHES } from '@immersia/shared';
import { Button } from '@immersia/ui';
import { HelpLink } from '@/components/HelpLink';
import { HELP_ARTICLES } from '@/lib/help-links';
import { renderCalibrationSheet } from '@/lib/setup-check/calibration-render';
import { gradePrinter, type PrintAnswer, type PrinterCode, type Finding } from '@/lib/setup-check/grading';
import { FindingList, SKIPPED, StepActions, outcomeOf, type StepProps } from '../check-ui';

type State =
  | { kind: 'idle' }
  | { kind: 'printing' }
  | { kind: 'printed' }
  | { kind: 'unavailable' }
  | { kind: 'done'; findings: Finding<PrinterCode>[] };

const ANSWERS: PrintAnswer[] = ['matches', 'off', 'cropped', 'nothing'];

/**
 * Step 6 (photo booths): print the calibration sheet at the event's print size through the same
 * code as a guest's print, then check it with a ruler. The PRD asks for prints within 1 mm.
 */
export function PrinterStep({ plan, onDone }: StepProps) {
  const t = useTranslations('check.printer');
  const ts = useTranslations('studio.setup.photo.sizes');
  const [state, setState] = useState<State>({ kind: 'idle' });
  const print = plan.print;
  const inches = print ? PRINT_SIZE_INCHES[print.size] : null;

  const sendSheet = async () => {
    if (!print || !inches) return;
    setState({ kind: 'printing' });
    try {
      await browserPrint({
        image: await renderCalibrationSheet(print.size),
        widthIn: inches[0],
        heightIn: inches[1],
        copies: 1,
        twoUp: print.twoUp,
      });
      setState({ kind: 'printed' });
    } catch (err) {
      console.warn('[setup check] print', err);
      setState({ kind: 'unavailable' });
    }
  };

  // The 9:16 story is for screens: there is no paper to check.
  if (!print || !inches)
    return (
      <div>
        <p className="text-sm leading-relaxed text-muted">{t('notApplicable')}</p>
        <StepActions busy={false} status="pass" onContinue={() => onDone(SKIPPED)} />
      </div>
    );

  const done = state.kind === 'done' ? state : null;
  const text = (f: Finding<PrinterCode>) => t(`findings.${f.code}`);
  return (
    <div>
      <p className="text-sm leading-relaxed text-muted">
        {t('intro', { size: ts(print.size), width: inches[0], height: inches[1] })}
      </p>
      {!print.enabled && <p className="mt-2 text-[13px] leading-relaxed text-faint">{t('printingOff')}</p>}
      {print.twoUp && <p className="mt-2 text-[13px] leading-relaxed text-faint">{t('twoUp')}</p>}

      <ol className="mt-4 list-decimal space-y-1.5 pl-5 text-sm leading-relaxed">
        <li>{t('how.print')}</li>
        <li>{t('how.ruler')}</li>
        <li>{t('how.marks')}</li>
        <li>{t('how.circle')}</li>
        <li>{t('how.frames')}</li>
      </ol>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button variant="primary" disabled={state.kind === 'printing'} onClick={() => void sendSheet()}>
          <Printer className="size-4" aria-hidden /> {state.kind === 'idle' ? t('print') : t('printAgain')}
        </Button>
        <HelpLink slug={HELP_ARTICLES.printing} label={t('help')} />
      </div>
      {state.kind === 'unavailable' && (
        <p role="alert" className="mt-3 text-sm text-bad">
          {t('unavailable')}
        </p>
      )}

      {state.kind === 'printed' && (
        <fieldset className="mt-5 space-y-2">
          <legend className="text-sm font-semibold">{t('question')}</legend>
          <div className="flex flex-wrap gap-2">
            {ANSWERS.map((a) => (
              <Button key={a} onClick={() => setState({ kind: 'done', findings: gradePrinter(a) })}>
                {t(`answers.${a}`)}
              </Button>
            ))}
          </div>
        </fieldset>
      )}

      {done && (
        <div className="mt-4">
          <FindingList
            findings={done.findings}
            text={text}
            help={(f) =>
              f.status !== 'pass' ? <HelpLink slug={HELP_ARTICLES.kioskPrinting} label={t('helpKiosk')} /> : null
            }
          />
        </div>
      )}

      <StepActions
        busy={state.kind === 'printing'}
        status={done ? done.findings[0]!.status : null}
        onRetry={done ? () => setState({ kind: 'printed' }) : undefined}
        retryLabel={t('answerAgain')}
        onContinue={() => done && onDone(outcomeOf(done.findings, text))}
        onSkip={() => onDone(SKIPPED)}
      />
    </div>
  );
}
