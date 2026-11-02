'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Check, Eye, EyeOff, MonitorSmartphone, Plus, Store, Trash2 } from 'lucide-react';
import { DISPLAY_LAYOUTS, formatShortCode, type DisplayLayout } from '@immersia/shared';
import {
  Button,
  Card,
  EmptyState,
  Field,
  IconButton,
  Modal,
  Pill,
  QrCode,
  Segmented,
  Select,
  Slider,
  TextInput,
  Toggle,
  buttonClass,
} from '@immersia/ui';
import {
  createPairingAction,
  listDisplaysAction,
  moderateAction,
  moderationListsAction,
  removeDisplayAction,
  setLiveOptionsAction,
  updateDisplayAction,
  type DisplaySummary,
} from '@/app/studio/live-actions';
import { useLiveFeed } from '@/lib/live-feed';
import type { QueueEntry } from '@/server/live';

type Lists = { pending: QueueEntry[]; shown: QueueEntry[]; hidden: QueueEntry[] };
type Settings = DisplaySummary['settings'];

/** A thumbnail for any item: its poster, the image itself, or the first frame of the video. */
function Thumb({ item, label }: { item: QueueEntry; label: string }) {
  const still = item.media.poster ?? (item.media.type === 'video' ? null : item.media.url);
  return (
    <div className="grid aspect-square place-items-center overflow-hidden rounded-lg bg-sunken">
      {still ? (
        // eslint-disable-next-line @next/next/no-img-element -- signed same-origin media links
        <img src={still} alt={label} className="size-full object-contain" />
      ) : (
        <video
          src={item.media.url}
          muted
          playsInline
          preload="metadata"
          aria-label={label}
          className="size-full object-contain"
        />
      )}
    </div>
  );
}

function PairingModal({
  eventId,
  origin,
  open,
  onClose,
  paired,
}: {
  eventId: string;
  origin: string;
  open: boolean;
  onClose: () => void;
  paired: boolean;
}) {
  const t = useTranslations('studio.live.pair');
  const [pairing, setPairing] = useState<{ code: string; expiresAt: string } | null>(null);
  const [error, setError] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  // State is only set once the server answers (never synchronously inside the effect).
  const mint = useCallback(
    () =>
      createPairingAction(eventId).then((res) => {
        setError(!res.ok);
        if (res.ok) setPairing(res.data);
      }),
    [eventId],
  );

  useEffect(() => {
    if (!open) return;
    void mint();
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, [open, mint]);

  const left = pairing ? Math.max(0, new Date(pairing.expiresAt).getTime() - now) : 0;
  const tvUrl = `${origin.replace(/^https?:\/\//, '')}/tv`;
  return (
    <Modal open={open} onClose={onClose} title={t('title')} width="max-w-xl">
      {paired ? (
        <div className="flex flex-col items-center gap-3 py-6 text-center" role="status">
          <span className="grid size-12 place-items-center rounded-full bg-ok/10 text-ok">
            <Check className="size-6" aria-hidden />
          </span>
          <p className="text-[15px] font-semibold">{t('paired')}</p>
          <Button variant="primary" onClick={onClose}>
            {t('done')}
          </Button>
        </div>
      ) : (
        <div className="grid gap-6 sm:grid-cols-[1fr_180px] sm:items-center">
          <div className="space-y-3">
            <p className="text-sm leading-relaxed text-muted">{t('steps', { url: tvUrl })}</p>
            {pairing && left > 0 ? (
              <>
                <p
                  className="tabular font-mono text-[44px] leading-none font-bold tracking-[0.12em]"
                  aria-label={t('codeLabel')}
                >
                  {formatShortCode(pairing.code)}
                </p>
                <p className="text-[13px] text-faint">
                  {t('expires', {
                    minutes: Math.floor(left / 60_000),
                    seconds: String(Math.floor((left % 60_000) / 1000)).padStart(2, '0'),
                  })}
                </p>
              </>
            ) : (
              <Button onClick={() => void mint()}>{t('newCode')}</Button>
            )}
            {error && (
              <p role="alert" className="text-[13px] text-bad">
                {t('failed')}
              </p>
            )}
          </div>
          {pairing && left > 0 && (
            <div className="rounded-xl border border-line bg-white p-3">
              <QrCode value={`${origin}/tv?code=${pairing.code}`} label={t('qrLabel')} />
              <p className="mt-2 text-center text-[11px] leading-snug text-faint">{t('qrHint')}</p>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

function DisplayRow({ d, readOnly, onChange }: { d: DisplaySummary; readOnly: boolean; onChange: () => void }) {
  const t = useTranslations('studio.live.displays');
  const [name, setName] = useState(d.name);
  const [layout, setLayout] = useState<DisplayLayout>(d.layout);
  const [settings, setSettings] = useState<Settings>(d.settings);
  const [confirm, setConfirm] = useState(false);
  const save = (patch: { name?: string; layout?: DisplayLayout; settings?: Partial<Settings> }) =>
    void updateDisplayAction(d.id, patch).then(onChange);
  const set = (patch: Partial<Settings>) => {
    setSettings((s) => ({ ...s, ...patch }));
    save({ settings: patch });
  };
  return (
    <li className="py-4">
      <div className="flex flex-wrap items-center gap-3">
        <MonitorSmartphone className="size-4 text-muted" aria-hidden />
        <TextInput
          value={name}
          ariaLabel={t('name')}
          className="w-48"
          disabled={readOnly}
          onChange={setName}
          onEnter={() => name.trim() && save({ name: name.trim() })}
        />
        {name.trim() && name !== d.name && !readOnly && (
          <Button size="sm" onClick={() => save({ name: name.trim() })}>
            {t('rename')}
          </Button>
        )}
        <Pill tone={d.online ? 'ok' : 'neutral'} dot>
          {d.online ? t('online') : t('offline')}
        </Pill>
        {!readOnly && (
          <IconButton label={t('remove', { name: d.name })} className="ml-auto" onClick={() => setConfirm(true)}>
            <Trash2 className="size-4" aria-hidden />
          </IconButton>
        )}
      </div>
      <fieldset disabled={readOnly} className="mt-2 divide-y divide-line">
        <Field label={t('layout')}>
          <Segmented
            value={layout}
            label={t('layout')}
            onChange={(v) => {
              setLayout(v);
              save({ layout: v });
            }}
            options={DISPLAY_LAYOUTS.map((l) => ({ value: l, label: t(`layouts.${l}`) }))}
          />
        </Field>
        <Field label={t('dwell')} help={t('dwellHelp')}>
          <Slider
            value={settings.dwellSeconds}
            min={3}
            max={15}
            unit="s"
            width="w-64 max-w-full"
            label={t('dwell')}
            onChange={(dwellSeconds) => set({ dwellSeconds })}
          />
        </Field>
        <Field label={t('muted')}>
          <Toggle checked={settings.videosMuted} label={t('muted')} onChange={(videosMuted) => set({ videosMuted })} />
        </Field>
        <Field label={t('qrSize')}>
          <Segmented
            value={settings.qrSize}
            label={t('qrSize')}
            onChange={(qrSize) => set({ qrSize })}
            options={(['s', 'm', 'l'] as const).map((s) => ({ value: s, label: t(`qrSizes.${s}`) }))}
          />
        </Field>
        <Field label={t('qrPosition')}>
          <Select
            value={settings.qrPosition}
            label={t('qrPosition')}
            onChange={(qrPosition) => set({ qrPosition })}
            options={(['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const).map((p) => ({
              value: p,
              label: t(`positions.${p}`),
            }))}
          />
        </Field>
        <Field label={t('verticalFill')} help={t('verticalFillHelp')}>
          <Segmented
            value={settings.verticalFill}
            label={t('verticalFill')}
            onChange={(verticalFill) => set({ verticalFill })}
            options={(['blur', 'columns'] as const).map((v) => ({ value: v, label: t(`fills.${v}`) }))}
          />
        </Field>
      </fieldset>
      <Modal open={confirm} onClose={() => setConfirm(false)} title={t('removeTitle', { name: d.name })}>
        <p className="text-sm leading-relaxed text-muted">{t('removeBody')}</p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirm(false)}>
            {t('cancel')}
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              setConfirm(false);
              void removeDisplayAction(d.id).then(onChange);
            }}
          >
            {t('removeConfirm')}
          </Button>
        </div>
      </Modal>
    </li>
  );
}

/** Screen 23: Live Display control. */
export function LiveControl({
  eventId,
  readOnly,
  origin,
  initial,
}: {
  eventId: string;
  readOnly: boolean;
  origin: string;
  initial: { enabled: boolean; moderation: 'auto' | 'approve'; displays: DisplaySummary[]; lists: Lists };
}) {
  const t = useTranslations('studio.live');
  const [enabled, setEnabled] = useState(initial.enabled);
  const [moderation, setModeration] = useState(initial.moderation);
  const [displays, setDisplays] = useState(initial.displays);
  const [lists, setLists] = useState<Lists>(initial.lists);
  const [tab, setTab] = useState<keyof Lists>(initial.moderation === 'approve' ? 'pending' : 'shown');
  const [pairing, setPairing] = useState<{ open: boolean; before: number }>({ open: false, before: 0 });

  const refreshDisplays = useCallback(
    () =>
      listDisplaysAction(eventId).then((res) => {
        if (res.ok) setDisplays(res.data);
      }),
    [eventId],
  );
  const refreshLists = useCallback(
    () =>
      moderationListsAction(eventId).then((res) => {
        if (res.ok) setLists(res.data);
      }),
    [eventId],
  );

  // The hub (or polling) tells us when items or the approval queue change.
  const { items } = useLiveFeed({
    url: `/api/live/events/${eventId}/feed?role=operator`,
    onQueue: () => void refreshLists(),
  });
  useEffect(() => {
    void refreshLists();
  }, [items, refreshLists]);

  // Display online state, and a new TV while the pairing code is up.
  useEffect(() => {
    const id = setInterval(() => void refreshDisplays(), pairing.open ? 3000 : 30_000);
    return () => clearInterval(id);
  }, [pairing.open, refreshDisplays]);
  // Without the hub there are no queue messages: look for new items to approve now and then.
  useEffect(() => {
    if (moderation !== 'approve') return;
    const id = setInterval(() => void refreshLists(), 10_000);
    return () => clearInterval(id);
  }, [moderation, refreshLists]);

  const setOptions = (patch: { enabled?: boolean; moderation?: 'auto' | 'approve' }) => {
    if (patch.enabled !== undefined) setEnabled(patch.enabled);
    if (patch.moderation) setModeration(patch.moderation);
    void setLiveOptionsAction(eventId, patch);
  };

  const act = (sessionId: string, action: 'show' | 'hide') => {
    // Optimistic: the item moves at once; the server's lists follow.
    setLists((l) => {
      const all = [...l.pending, ...l.shown, ...l.hidden];
      const item = all.find((i) => i.id === sessionId);
      const without = (xs: QueueEntry[]) => xs.filter((i) => i.id !== sessionId);
      if (!item) return l;
      const moved = { ...item, status: action === 'show' ? ('shown' as const) : ('hidden' as const) };
      return {
        pending: without(l.pending),
        shown: action === 'show' ? [moved, ...without(l.shown)] : without(l.shown),
        hidden: action === 'hide' ? [moved, ...without(l.hidden)] : without(l.hidden),
      };
    });
    void moderateAction(sessionId, action).then(() => refreshLists());
  };

  const list = lists[tab];
  return (
    <fieldset disabled={readOnly} className="min-w-0 space-y-6">
      <legend className="sr-only">{t('title')}</legend>
      <Card title={t('settings.title')} subtitle={t('settings.subtitle')}>
        <Field label={t('settings.enabled')} help={t('settings.enabledHelp')}>
          <Toggle checked={enabled} label={t('settings.enabled')} onChange={(v) => setOptions({ enabled: v })} />
        </Field>
        <Field label={t('settings.moderation')} help={t('settings.moderationHelp')}>
          <Segmented
            value={moderation}
            label={t('settings.moderation')}
            onChange={(v) => setOptions({ moderation: v })}
            options={[
              { value: 'auto', label: t('settings.auto') },
              { value: 'approve', label: t('settings.approve') },
            ]}
          />
        </Field>
        <div className="flex flex-wrap gap-2 py-4">
          <Link href={`/station/${eventId}`} target="_blank" className={buttonClass({ size: 'sm' })}>
            <Store className="size-3.5" aria-hidden /> {t('settings.station')}
          </Link>
        </div>
      </Card>

      <Card
        title={t('displays.title')}
        subtitle={t('displays.subtitle')}
        action={
          !readOnly && (
            <Button size="sm" variant="primary" onClick={() => setPairing({ open: true, before: displays.length })}>
              <Plus className="size-3.5" aria-hidden /> {t('displays.pair')}
            </Button>
          )
        }
      >
        {displays.length === 0 ? (
          <EmptyState
            icon={<MonitorSmartphone className="size-5" aria-hidden />}
            title={t('displays.emptyTitle')}
            body={t('displays.emptyBody')}
          />
        ) : (
          <ul className="divide-y divide-line">
            {displays.map((d) => (
              <DisplayRow key={d.id} d={d} readOnly={readOnly} onChange={() => void refreshDisplays()} />
            ))}
          </ul>
        )}
      </Card>

      <Card title={t('moderation.title')} subtitle={t('moderation.subtitle')}>
        <div className="py-4">
          <Segmented
            value={tab}
            onChange={setTab}
            label={t('moderation.title')}
            options={[
              { value: 'pending', label: t('moderation.pending', { count: lists.pending.length }) },
              { value: 'shown', label: t('moderation.shown', { count: lists.shown.length }) },
              { value: 'hidden', label: t('moderation.hidden', { count: lists.hidden.length }) },
            ]}
          />
        </div>
        {list.length === 0 ? (
          <p className="pb-6 text-[13px] text-muted">{t(`moderation.empty.${tab}`)}</p>
        ) : (
          <ul className="grid grid-cols-2 gap-3 pb-6 sm:grid-cols-3 lg:grid-cols-5">
            {list.map((item) => (
              <li key={item.id} className="rounded-xl border border-line p-2">
                <Thumb item={item} label={t('moderation.itemLabel', { code: formatShortCode(item.shortCode) })} />
                <div className="mt-2 flex items-center justify-between gap-1">
                  <span className="tabular font-mono text-[12px] text-muted">{formatShortCode(item.shortCode)}</span>
                  {!readOnly && (
                    <span className="flex gap-0.5">
                      {item.status !== 'shown' && (
                        <IconButton
                          label={t(item.status === 'pending' ? 'moderation.approve' : 'moderation.restore')}
                          onClick={() => act(item.id, 'show')}
                        >
                          <Eye className="size-4" aria-hidden />
                        </IconButton>
                      )}
                      {item.status !== 'hidden' && (
                        <IconButton label={t('moderation.hide')} onClick={() => act(item.id, 'hide')}>
                          <EyeOff className="size-4" aria-hidden />
                        </IconButton>
                      )}
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <PairingModal
        eventId={eventId}
        origin={origin}
        open={pairing.open}
        paired={pairing.open && displays.length > pairing.before}
        onClose={() => setPairing({ open: false, before: 0 })}
      />
    </fieldset>
  );
}
