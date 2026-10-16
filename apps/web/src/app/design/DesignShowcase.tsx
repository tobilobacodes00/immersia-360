'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Camera, Plus, Printer } from 'lucide-react';
import { THEME_PRESETS, guestThemeVars } from '@immersia/shared/theme';
import {
  Button,
  Card,
  CheckItem,
  Field,
  PageHeader,
  Pill,
  Segmented,
  Select,
  Slider,
  Stat,
  TextInput,
  Toggle,
  TokenField,
} from '@immersia/ui';
import { CountdownDisc, GuestButton, Headline, QrCard } from '@immersia/ui/guest';

const QUALITIES = ['small', 'balanced', 'original'] as const;
type Quality = (typeof QUALITIES)[number];

export function DesignShowcase() {
  const t = useTranslations('design');
  const [toggle, setToggle] = useState(true);
  const [spin, setSpin] = useState(8);
  const [quality, setQuality] = useState<Quality>('balanced');
  const [name, setName] = useState('Golden Hour Gala');
  const [title, setTitle] = useState('{upper,{eventName}} · %d %B %Y');
  const [preset, setPreset] = useState(THEME_PRESETS[0]!.name);
  const theme = THEME_PRESETS.find((p) => p.name === preset)!.theme;

  return (
    <main className="mx-auto max-w-5xl px-4 py-12 sm:px-8">
      <PageHeader eyebrow="Immersia 360" title={t('title')} subtitle={t('subtitle')} />

      <div className="grid gap-6">
        <Card title={t('buttons')}>
          <div className="flex flex-wrap items-center gap-2 py-4">
            <Button variant="primary" icon={<Plus className="size-4" />}>
              Primary
            </Button>
            <Button>Secondary</Button>
            <Button variant="subtle">Subtle</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="danger">Danger</Button>
            <Button size="sm">Small</Button>
            <Button size="lg" variant="primary">
              Large
            </Button>
            <Button disabled>Disabled</Button>
          </div>
        </Card>

        <Card title={t('controls')}>
          <Field label={t('sampleToggle')}>
            <Toggle checked={toggle} onChange={setToggle} label={t('sampleToggle')} />
          </Field>
          <Field label={t('sampleSlider')}>
            <Slider
              value={spin}
              min={3}
              max={20}
              step={0.5}
              unit="s"
              onChange={setSpin}
              label={t('sampleSlider')}
              width="w-72"
            />
          </Field>
          <Field label={t('sampleSelect')}>
            <Segmented<Quality>
              label={t('sampleSelect')}
              value={quality}
              onChange={setQuality}
              options={QUALITIES.map((q) => ({ value: q, label: q }))}
            />
          </Field>
          <Field label={t('sampleText')}>
            <TextInput value={name} onChange={setName} ariaLabel={t('sampleText')} className="w-72" />
          </Field>
          <Field label={t('sampleTitle')} stack>
            <TokenField
              label={t('sampleTitle')}
              value={title}
              onChange={setTitle}
              ctx={{ eventName: name, __date: new Date(2026, 9, 11) }}
            />
          </Field>
        </Card>

        <Card title={t('status')}>
          <div className="flex flex-wrap gap-2 py-4">
            <Pill tone="ok" dot>
              {t('ready')}
            </Pill>
            <Pill tone="info">{t('rendering')}</Pill>
            <Pill tone="warn">{t('queued')}</Pill>
            <Pill tone="bad">{t('failed')}</Pill>
          </div>
          <div className="grid gap-4 pb-4 sm:grid-cols-3">
            <Stat label={t('statLabel')} value="128" hint={t('statHint')} />
            <Stat label="Renders" value="0" tone="ok" />
            <Stat label="Uploads" value="3" tone="warn" />
          </div>
          <CheckItem done>Camera</CheckItem>
          <CheckItem done={false}>Printer</CheckItem>
        </Card>

        <Card
          title={t('guest')}
          action={
            <Select
              label={t('presets')}
              value={preset}
              onChange={setPreset}
              options={THEME_PRESETS.map((p) => ({ value: p.name, label: p.name }))}
              className="w-44"
            />
          }
          pad={false}
        >
          <div
            className="booth-preview grid gap-8 bg-g-bg p-8 text-g-ink sm:grid-cols-[1fr_auto]"
            style={guestThemeVars(theme)}
          >
            <div className="flex flex-col items-start gap-6">
              <Headline font={theme.font} className="text-5xl">
                Strike a pose
              </Headline>
              <div className="flex flex-wrap gap-3">
                <GuestButton primary onClick={() => {}}>
                  <Camera className="size-6" /> {t('start')}
                </GuestButton>
                <GuestButton onClick={() => {}}>
                  <Printer className="size-6" /> Print
                </GuestButton>
              </div>
              <CountdownDisc count={3} total={3} font={theme.font} label={t('countdown', { count: 3 })} />
            </div>
            <QrCard
              value="https://immersia.app/s/AAAAAAAAAAAAAAAAAAAAAA?r=booth"
              caption={t('scan')}
              alt={t('qrAlt')}
              code="K7M-2QX"
            />
          </div>
        </Card>
      </div>
    </main>
  );
}
