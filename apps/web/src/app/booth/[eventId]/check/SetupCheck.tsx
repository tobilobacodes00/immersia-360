'use client';

import { useEffect, useMemo, useReducer, useState, type ReactElement } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import { useTranslations } from 'next-intl';
import { ArrowLeft } from 'lucide-react';
import type { BoothMode, SetupCheckStep } from '@immersia/shared';
import { BrandMark, Pill } from '@immersia/ui';
import { HelpLink } from '@/components/HelpLink';
import { HELP_ARTICLES } from '@/lib/help-links';
import type { CheckPlan } from '@/lib/setup-check/config';
import { readDeviceIdentity, type DeviceIdentity } from '@/lib/device-identity';
import { RegisterDevice } from '../RegisterDevice';
import { checkApi } from './check-api';
import { CheckSession } from './check-session';
import { LineList, StatusPill, type Facts, type Outcome, type StepProps } from './check-ui';
import { Summary } from './Summary';
import { CameraStep } from './steps/CameraStep';
import { NetworkStep } from './steps/NetworkStep';
import { PrinterStep } from './steps/PrinterStep';
import { QrStep } from './steps/QrStep';
import { RenderStep } from './steps/RenderStep';
import { StorageStep } from './steps/StorageStep';
import { TakeStep } from './steps/TakeStep';

export interface SetupCheckProps {
  eventId: string;
  eventName: string;
  mode: BoothMode;
  plan: CheckPlan;
  /** Where "back to the booth" goes (the booth being checked). */
  boothHref: Route;
}

const STEP_COMPONENTS: Record<SetupCheckStep, (props: StepProps) => ReactElement> = {
  camera: CameraStep,
  storage: StorageStep,
  take: TakeStep,
  render: RenderStep,
  qr: QrStep,
  printer: PrinterStep,
  network: NetworkStep,
};

interface State {
  /** Index into the step list; past the end means the summary. */
  index: number;
  outcomes: Partial<Record<SetupCheckStep, Outcome>>;
  facts: Facts;
  /** Bumped on "run again" so every step starts afresh. */
  run: number;
}

type Action = { type: 'done'; step: SetupCheckStep; outcome: Outcome; facts?: Partial<Facts> } | { type: 'restart' };

const INITIAL_FACTS: Facts = {
  cameraFps: 0,
  cameraResolution: null,
  referenceMs: null,
  eventMs: null,
  renderPath: 'server',
  mbps: null,
};

const initialState = (run: number): State => ({ index: 0, outcomes: {}, facts: INITIAL_FACTS, run });

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'done':
      return {
        ...state,
        index: state.index + 1,
        outcomes: { ...state.outcomes, [action.step]: action.outcome },
        facts: { ...state.facts, ...action.facts },
      };
    case 'restart':
      return initialState(state.run + 1);
  }
}

/**
 * Screen 9, "Setup check" (HLP-1): the steps an operator walks through on a booth device before an
 * event, each with a clear pass, warning or failure and what to do about it. Registers the device
 * first when this browser is not one yet.
 */
export function SetupCheck(props: SetupCheckProps) {
  const t = useTranslations('check');
  const tm = useTranslations('studio.events.modes');
  // Client-only page (loaded with ssr: false), so reading storage in the initialiser is safe.
  const [identity, setIdentity] = useState<DeviceIdentity | null>(readDeviceIdentity);

  const header = (
    <header className="mx-auto flex max-w-3xl flex-wrap items-center gap-x-4 gap-y-2 px-4 pt-6 sm:px-6">
      <Link
        href={props.boothHref}
        className="focus-ring inline-flex items-center gap-1.5 rounded-lg py-1 pr-2 text-sm font-medium text-muted hover:text-fg"
      >
        <ArrowLeft className="size-4" aria-hidden /> {t('backToBooth')}
      </Link>
      <HelpLink slug={HELP_ARTICLES.setupCheck} label={t('help')} className="ml-auto" />
    </header>
  );

  const intro = (
    <div className="mx-auto max-w-3xl px-4 pt-6 pb-2 sm:px-6">
      <BrandMark size={34} />
      <h1 className="mt-5 text-[30px] leading-[1.05] font-bold tracking-[-0.03em] sm:text-[38px]">{t('title')}</h1>
      <p className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted">
        <span className="font-medium text-fg">{props.eventName}</span>
        <Pill>{tm(props.mode)}</Pill>
      </p>
      <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-muted">{t('subtitle')}</p>
    </div>
  );

  if (!identity)
    return (
      <div className="min-h-dvh">
        {header}
        {intro}
        <div className="mx-auto h-[26rem] max-w-3xl px-4 sm:px-6">
          <RegisterDevice onRegistered={setIdentity} />
        </div>
      </div>
    );

  return (
    <div className="min-h-dvh pb-20">
      {header}
      {intro}
      <main id="main" className="mx-auto max-w-3xl px-4 pt-4 sm:px-6">
        <Wizard {...props} identity={identity} />
      </main>
    </div>
  );
}

function Wizard({ eventId, plan, boothHref, identity }: SetupCheckProps & { identity: DeviceIdentity }) {
  const t = useTranslations('check');
  const [session] = useState(() => new CheckSession(plan, identity.id, checkApi(identity.token)));
  const [state, dispatch] = useReducer(reducer, 0, initialState);

  // The camera, the render worker and the test take are released when the page goes.
  useEffect(
    () => () => {
      void session.dispose();
    },
    [session],
  );

  const steps = useMemo<SetupCheckStep[]>(
    () => ['camera', 'storage', 'take', 'render', 'qr', ...(plan.print ? (['printer'] as const) : []), 'network'],
    [plan.print],
  );

  if (state.index >= steps.length)
    return (
      <Summary
        key={state.run}
        session={session}
        eventId={eventId}
        steps={steps}
        outcomes={state.outcomes}
        facts={state.facts}
        backHref={boothHref}
        onRestart={() => dispatch({ type: 'restart' })}
      />
    );

  return (
    <ol className="space-y-3" aria-label={t('stepsLabel')}>
      {steps.map((step, i) => {
        const outcome = state.outcomes[step];
        const current = i === state.index;
        const Step = STEP_COMPONENTS[step];
        const headingId = `check-step-${step}`;
        return (
          <li key={`${state.run}-${step}`}>
            <section aria-labelledby={headingId} aria-current={current ? 'step' : undefined} className="card">
              <header className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-4 sm:px-6">
                <span
                  aria-hidden
                  className="grid size-6 place-items-center rounded-full bg-sunken text-xs font-semibold tabular"
                >
                  {i + 1}
                </span>
                <h2 id={headingId} className="min-w-0 flex-1 text-[15px] font-semibold tracking-[-0.01em]">
                  {t(`steps.${step}`)}
                  <span className="sr-only"> ({t('stepOf', { n: i + 1, total: steps.length })})</span>
                </h2>
                <StatusPill status={outcome ? outcome.status : current ? 'current' : 'waiting'} />
              </header>
              {current && (
                <div className="border-t border-line px-5 py-5 sm:px-6">
                  <Step
                    session={session}
                    plan={plan}
                    onDone={(done, facts) => dispatch({ type: 'done', step, outcome: done, facts })}
                  />
                </div>
              )}
              {!current && outcome && outcome.lines.length > 0 && (
                <div className="border-t border-line px-5 py-4 sm:px-6">
                  <LineList lines={outcome.lines} />
                </div>
              )}
            </section>
          </li>
        );
      })}
    </ol>
  );
}
