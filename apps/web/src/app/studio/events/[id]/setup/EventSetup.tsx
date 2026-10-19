'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { useTranslations, type Messages } from 'next-intl';
import { AlertCircle, Check, Loader2 } from 'lucide-react';
import {
  ASPECTS,
  PRINT_SIZES,
  QUALITY_PRESETS,
  RESOLUTIONS,
  outputSettingsSchema,
  shareSettingsSchema,
  type OutputSettings,
  type ShareSettings,
} from '@immersia/shared';
import {
  Card,
  Field,
  NumberInput,
  Pill,
  Segmented,
  Select,
  Slider,
  TextInput,
  Toggle,
  useHydrated,
} from '@immersia/ui';
import { updateBasicsAction, updateSectionAction } from '../../../actions';
import { useAutosave, type SaveStatus } from './use-autosave';

/** Codes the shared event schemas emit (see packages/shared/src/event.ts). */
type IssueKey = keyof Messages['studio']['setup']['issues'];

type Mode = 'video360' | 'photo';
type Expiry = 7 | 30 | 90;

interface Basics {
  name: string;
  date: string;
  mode: Mode;
  expiryDays: Expiry;
  filenamePrefixEnabled: boolean;
}

const SPEEDS = ['0.125', '0.25', '0.5', '0.75', '1'] as const;

function SaveIndicator({ statuses }: { statuses: SaveStatus[] }) {
  const t = useTranslations('studio.setup.save');
  const status: SaveStatus = statuses.includes('error')
    ? 'error'
    : statuses.includes('saving')
      ? 'saving'
      : statuses.includes('saved')
        ? 'saved'
        : 'idle';
  if (status === 'idle') return null;
  return (
    <div role="status" aria-live="polite" className="flex items-center gap-1.5 text-[13px]">
      {status === 'saving' && (
        <>
          <Loader2 className="size-3.5 animate-spin text-faint motion-reduce:animate-none" aria-hidden />
          <span className="text-muted">{t('saving')}</span>
        </>
      )}
      {status === 'saved' && (
        <>
          <Check className="size-3.5 text-ok" aria-hidden />
          <span className="text-muted">{t('saved')}</span>
        </>
      )}
      {status === 'error' && (
        <>
          <AlertCircle className="size-3.5 text-bad" aria-hidden />
          <span className="text-bad">{t('error')}</span>
        </>
      )}
    </div>
  );
}

function Issues({ issues }: { issues: string[] }) {
  if (!issues.length) return null;
  return (
    <ul
      role="alert"
      className="mb-3 space-y-1 rounded-lg border border-bad/25 bg-bad/[0.05] px-3 py-2 text-[13px] text-bad"
    >
      {issues.map((i) => (
        <li key={i}>{i}</li>
      ))}
    </ul>
  );
}

function ToggleField({
  label,
  help,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  help?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <Field label={label} help={help}>
      <Toggle checked={checked} onChange={onChange} label={label} disabled={disabled} />
    </Field>
  );
}

function Section({
  title,
  subtitle,
  children,
  id,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  id: string;
}) {
  return (
    <Card id={id} title={title} subtitle={subtitle}>
      <div className="divide-y divide-line">{children}</div>
    </Card>
  );
}

export function EventSetup({
  id,
  readOnly,
  basics: initialBasics,
  output: initialOutput,
  share: initialShare,
}: {
  id: string;
  readOnly: boolean;
  basics: Basics;
  output: OutputSettings;
  share: ShareSettings;
}) {
  const t = useTranslations('studio.setup');
  const te = useTranslations('studio.events');
  const [basics, setBasics] = useState(initialBasics);
  const [output, setOutput] = useState(initialOutput);
  const [share, setShare] = useState(initialShare);
  const hydrated = useHydrated();

  const ti = useTranslations('studio.setup.issues');
  const outputIssues = useMemo(() => {
    const r = outputSettingsSchema.safeParse(output);
    if (r.success) return [];
    // Shared schemas emit stable codes; anything unexpected falls back to a generic message.
    return [
      ...new Set(
        r.error.issues.map((i) => (ti.has(i.message as IssueKey) ? ti(i.message as IssueKey) : ti('generic'))),
      ),
    ];
  }, [output, ti]);

  const basicsStatus = useAutosave(basics, async (b) => (await updateBasicsAction(id, b)).ok, {
    isValid: (b) => b.name.trim().length > 0 && /^\d{4}-\d{2}-\d{2}$/.test(b.date),
  });
  const outputStatus = useAutosave(output, async (o) => (await updateSectionAction(id, 'outputSettings', o)).ok, {
    isValid: (o) => outputSettingsSchema.safeParse(o).success,
  });
  const shareStatus = useAutosave(share, async (s) => (await updateSectionAction(id, 'shareSettings', s)).ok, {
    isValid: (s) => shareSettingsSchema.safeParse(s).success,
  });

  const v = output.video360;
  const p = output.photo;
  const setV = (patch: Partial<OutputSettings['video360']>) =>
    setOutput((o) => ({ ...o, video360: { ...o.video360, ...patch } }));
  const setP = (patch: Partial<OutputSettings['photo']>) =>
    setOutput((o) => ({ ...o, photo: { ...o.photo, ...patch } }));
  const setTriggers = (patch: Partial<OutputSettings['triggers']>) =>
    setOutput((o) => ({ ...o, triggers: { ...o.triggers, ...patch } }));
  const setSlowMo = (patch: Partial<OutputSettings['video360']['slowMotion']>) =>
    setV({ slowMotion: { ...v.slowMotion, ...patch } });

  return (
    <fieldset disabled={readOnly || !hydrated} className="min-w-0 space-y-6">
      <legend className="sr-only">{t('title')}</legend>
      <div className="flex min-h-6 flex-wrap items-center justify-between gap-3">
        {readOnly ? <Pill>{t('readOnly')}</Pill> : <span />}
        <SaveIndicator statuses={[basicsStatus, outputStatus, shareStatus]} />
      </div>

      <Section id="basics" title={t('basics.title')}>
        <Field label={t('basics.name')} htmlFor="setup-name">
          <TextInput
            id="setup-name"
            value={basics.name}
            onChange={(name) => setBasics((b) => ({ ...b, name }))}
            className="w-72 max-w-full"
          />
        </Field>
        <Field label={t('basics.date')} htmlFor="setup-date">
          <input
            id="setup-date"
            type="date"
            value={basics.date}
            onChange={(e) => setBasics((b) => ({ ...b, date: e.target.value }))}
            className="h-9 rounded-[10px] border border-line-strong bg-elev px-3 text-sm outline-none focus:border-accent focus:ring-3 focus:ring-accent-soft"
          />
        </Field>
        <Field label={t('basics.mode')} help={t('basics.modeHelp')}>
          <Segmented<Mode>
            label={t('basics.mode')}
            value={basics.mode}
            onChange={(mode) => setBasics((b) => ({ ...b, mode }))}
            options={[
              { value: 'video360', label: te('modes.video360') },
              { value: 'photo', label: te('modes.photo') },
            ]}
          />
        </Field>
        <Field label={t('basics.expiry')} help={t('basics.expiryHelp')}>
          <Segmented<`${Expiry}`>
            label={t('basics.expiry')}
            value={`${basics.expiryDays}`}
            onChange={(d) => setBasics((b) => ({ ...b, expiryDays: Number(d) as Expiry }))}
            options={(['7', '30', '90'] as const).map((d) => ({ value: d, label: t('days', { count: Number(d) }) }))}
          />
        </Field>
        <ToggleField
          label={t('basics.prefix')}
          help={t('basics.prefixHelp')}
          checked={basics.filenamePrefixEnabled}
          onChange={(filenamePrefixEnabled) => setBasics((b) => ({ ...b, filenamePrefixEnabled }))}
        />
      </Section>

      {basics.mode === 'video360' ? (
        <Section id="video" title={t('video.title')} subtitle={t('video.subtitle')}>
          <Issues issues={outputIssues} />
          <Field label={t('video.resolution')} help={t('video.resolutionHelp')}>
            <Segmented
              label={t('video.resolution')}
              value={v.resolution}
              onChange={(resolution) => setV({ resolution })}
              options={RESOLUTIONS.map((r) => ({ value: r, label: r === '2160p' ? '4K' : r }))}
            />
          </Field>
          <Field label={t('video.fps')} help={t('video.fpsHelp')}>
            <Segmented<'30' | '60'>
              label={t('video.fps')}
              value={`${v.fps}`}
              onChange={(f) => setV({ fps: Number(f) as 30 | 60 })}
              options={[
                { value: '30', label: '30 fps' },
                { value: '60', label: '60 fps' },
              ]}
            />
          </Field>
          <Field label={t('video.aspect')}>
            <Segmented
              label={t('video.aspect')}
              value={v.aspect}
              onChange={(aspect) => setV({ aspect })}
              options={ASPECTS.map((a) => ({ value: a, label: a }))}
            />
          </Field>
          <Field label={t('video.spin')} help={t('video.spinHelp')}>
            <Slider
              label={t('video.spin')}
              value={v.spinSeconds}
              min={3}
              max={20}
              step={0.5}
              unit="s"
              width="w-72 max-w-full"
              onChange={(spinSeconds) => setV({ spinSeconds })}
            />
          </Field>
          <ToggleField
            label={t('video.slowMo')}
            help={t('video.slowMoHelp')}
            checked={v.slowMotion.enabled}
            onChange={(enabled) => setSlowMo({ enabled })}
          />
          {v.slowMotion.enabled && (
            <>
              <Field label={t('video.slowMoRange')} help={t('video.slowMoRangeHelp')}>
                <div className="flex items-center gap-2 text-[13px] text-muted">
                  <NumberInput
                    label={t('video.slowMoStart')}
                    value={v.slowMotion.startS}
                    min={0}
                    max={v.spinSeconds}
                    step={0.5}
                    unit="s"
                    onChange={(startS) => setSlowMo({ startS })}
                  />
                  <span aria-hidden>–</span>
                  <NumberInput
                    label={t('video.slowMoEnd')}
                    value={v.slowMotion.endS}
                    min={0}
                    max={v.spinSeconds}
                    step={0.5}
                    unit="s"
                    onChange={(endS) => setSlowMo({ endS })}
                  />
                </div>
              </Field>
              <Field label={t('video.slowMoSpeed')}>
                <Select<(typeof SPEEDS)[number]>
                  label={t('video.slowMoSpeed')}
                  className="w-32"
                  value={(SPEEDS.find((s) => Number(s) === v.slowMotion.speed) ?? '0.5') as (typeof SPEEDS)[number]}
                  onChange={(s) => setSlowMo({ speed: Number(s) })}
                  options={SPEEDS.map((s) => ({ value: s, label: `${s}×` }))}
                />
              </Field>
            </>
          )}
          <Field label={t('video.reverse')} help={t('video.reverseHelp')}>
            <Segmented
              label={t('video.reverse')}
              value={v.reverse}
              onChange={(reverse) => setV({ reverse })}
              options={(['none', 'boomerang', 'reverse'] as const).map((r) => ({
                value: r,
                label: t(`video.reverseOptions.${r}`),
              }))}
            />
          </Field>
          <Field label={t('video.quality')} help={t(`video.qualityHelp.${v.quality}`)}>
            <Segmented
              label={t('video.quality')}
              value={v.quality}
              onChange={(quality) => setV({ quality })}
              options={QUALITY_PRESETS.map((q) => ({ value: q, label: t(`video.qualityOptions.${q}`) }))}
            />
          </Field>
          <Field label={t('countdown')}>
            <NumberInput
              label={t('countdown')}
              value={v.countdownSeconds}
              min={0}
              max={10}
              unit="s"
              onChange={(countdownSeconds) => setV({ countdownSeconds })}
            />
          </Field>
          <ToggleField
            label={t('video.microphone')}
            help={t('video.microphoneHelp')}
            checked={v.microphone}
            onChange={(microphone) => setV({ microphone })}
          />
        </Section>
      ) : (
        <Section id="photo" title={t('photo.title')} subtitle={t('photo.subtitle')}>
          <Field label={t('photo.shots')}>
            <Segmented<'1' | '2' | '3' | '4'>
              label={t('photo.shots')}
              value={`${p.shots}` as '1' | '2' | '3' | '4'}
              onChange={(s) => setP({ shots: Number(s) })}
              options={(['1', '2', '3', '4'] as const).map((s) => ({ value: s, label: s }))}
            />
          </Field>
          <Field label={t('countdown')}>
            <NumberInput
              label={t('countdown')}
              value={p.countdownSeconds}
              min={0}
              max={10}
              unit="s"
              onChange={(countdownSeconds) => setP({ countdownSeconds })}
            />
          </Field>
          <Field label={t('photo.between')}>
            <NumberInput
              label={t('photo.between')}
              value={p.secondsBetweenShots}
              min={0}
              max={10}
              step={0.5}
              unit="s"
              onChange={(secondsBetweenShots) => setP({ secondsBetweenShots })}
            />
          </Field>
          <ToggleField label={t('photo.retake')} checked={p.retake} onChange={(retake) => setP({ retake })} />
          <Field label={t('photo.size')}>
            <Select
              label={t('photo.size')}
              className="w-44"
              value={p.printSize}
              onChange={(printSize) => setP({ printSize })}
              options={PRINT_SIZES.map((s) => ({ value: s, label: t(`photo.sizes.${s}`) }))}
            />
          </Field>
          <ToggleField
            label={t('photo.gif')}
            checked={p.outputs.gif}
            onChange={(gif) => setP({ outputs: { ...p.outputs, gif } })}
          />
          <ToggleField
            label={t('photo.boomerang')}
            checked={p.outputs.boomerang}
            onChange={(boomerang) => setP({ outputs: { ...p.outputs, boomerang } })}
          />
          <ToggleField
            label={t('photo.shortVideo')}
            help={t('photo.shortVideoHelp')}
            checked={p.outputs.shortVideo}
            onChange={(shortVideo) => setP({ outputs: { ...p.outputs, shortVideo } })}
          />
          <ToggleField
            label={t('photo.print')}
            checked={p.print.enabled}
            onChange={(enabled) => setP({ print: { ...p.print, enabled } })}
          />
          {p.print.enabled && (
            <>
              <ToggleField
                label={t('photo.autoPrint')}
                help={t('photo.autoPrintHelp')}
                checked={p.print.autoPrint}
                onChange={(autoPrint) => setP({ print: { ...p.print, autoPrint } })}
              />
              <Field label={t('photo.copies')}>
                <NumberInput
                  label={t('photo.copies')}
                  value={p.print.copies}
                  min={1}
                  max={10}
                  onChange={(copies) => setP({ print: { ...p.print, copies } })}
                />
              </Field>
              {p.printSize === '2x6' && (
                <ToggleField
                  label={t('photo.doubleStrip')}
                  help={t('photo.doubleStripHelp')}
                  checked={p.print.doubleStrip}
                  onChange={(doubleStrip) => setP({ print: { ...p.print, doubleStrip } })}
                />
              )}
            </>
          )}
          <ToggleField
            label={t('photo.confetti')}
            checked={p.confettiReveal}
            onChange={(confettiReveal) => setP({ confettiReveal })}
          />
        </Section>
      )}

      <Section id="triggers" title={t('triggers.title')} subtitle={t('triggers.subtitle')}>
        <ToggleField label={t('triggers.tap')} checked={output.triggers.tap} onChange={(tap) => setTriggers({ tap })} />
        <ToggleField
          label={t('triggers.keyboard')}
          help={t('triggers.keyboardHelp')}
          checked={output.triggers.keyboard}
          onChange={(keyboard) => setTriggers({ keyboard })}
        />
        <ToggleField
          label={t('triggers.motion')}
          help={t('triggers.motionHelp')}
          checked={output.triggers.motion.enabled}
          onChange={(enabled) => setTriggers({ motion: { ...output.triggers.motion, enabled } })}
        />
        {output.triggers.motion.enabled && (
          <Field label={t('triggers.sensitivity')} help={t('triggers.sensitivityHelp')}>
            <Slider
              label={t('triggers.sensitivity')}
              value={Math.round(output.triggers.motion.threshold * 100)}
              min={1}
              max={60}
              unit="%"
              width="w-72 max-w-full"
              onChange={(n) => setTriggers({ motion: { ...output.triggers.motion, threshold: n / 100 } })}
            />
          </Field>
        )}
      </Section>

      <Section id="sharing" title={t('sharing.title')} subtitle={t('sharing.subtitle')}>
        <ToggleField label={t('sharing.qr')} checked={share.qr} onChange={(qr) => setShare((s) => ({ ...s, qr }))} />
        <ToggleField
          label={t('sharing.email')}
          checked={share.email}
          onChange={(email) => setShare((s) => ({ ...s, email }))}
        />
        <ToggleField
          label={t('sharing.sms')}
          checked={share.sms}
          onChange={(sms) => setShare((s) => ({ ...s, sms }))}
        />
        <ToggleField
          label={t('sharing.whatsapp')}
          checked={share.whatsapp}
          onChange={(whatsapp) => setShare((s) => ({ ...s, whatsapp }))}
        />
        <ToggleField
          label={t('sharing.smaller')}
          help={t('sharing.smallerHelp')}
          checked={share.smallerVersion}
          onChange={(smallerVersion) => setShare((s) => ({ ...s, smallerVersion }))}
        />
        <Field label={t('sharing.contact')} help={t('sharing.contactHelp')} stack>
          <TextInput
            value={share.contact}
            onChange={(contact) => setShare((s) => ({ ...s, contact: contact.slice(0, 200) }))}
            ariaLabel={t('sharing.contact')}
          />
        </Field>
        {basics.mode === 'photo' ? (
          <ToggleField
            label={t('sharing.stripQr')}
            help={t('sharing.stripQrHelp')}
            checked={share.stripQr}
            onChange={(stripQr) => setShare((s) => ({ ...s, stripQr }))}
          />
        ) : (
          <ToggleField
            label={t('sharing.endFrame')}
            help={t('sharing.endFrameHelp')}
            checked={share.endFrameQr}
            onChange={(endFrameQr) => setShare((s) => ({ ...s, endFrameQr }))}
          />
        )}
        <ToggleField
          label={t('sharing.guestForm')}
          help={t('sharing.guestFormHelp')}
          checked={share.guestForm.enabled}
          onChange={(enabled) => setShare((s) => ({ ...s, guestForm: { ...s.guestForm, enabled } }))}
        />
        {share.guestForm.enabled && (
          <>
            <ToggleField
              label={t('sharing.requireName')}
              checked={share.guestForm.requireName}
              onChange={(requireName) => setShare((s) => ({ ...s, guestForm: { ...s.guestForm, requireName } }))}
            />
            <Field label={t('sharing.consent')} help={t('sharing.consentHelp')} stack>
              <TextInput
                value={share.guestForm.consentText}
                onChange={(consentText) =>
                  setShare((s) => ({ ...s, guestForm: { ...s.guestForm, consentText: consentText.slice(0, 500) } }))
                }
                ariaLabel={t('sharing.consent')}
              />
            </Field>
          </>
        )}
      </Section>
    </fieldset>
  );
}
