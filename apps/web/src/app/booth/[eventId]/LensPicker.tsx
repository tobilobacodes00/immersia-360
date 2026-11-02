'use client';

import { useId, useRef, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Check } from 'lucide-react';
import {
  groupLenses,
  nativeLensClass,
  type GroupedLens,
  type HighSpeedLens,
  type Lens,
  type LensFacing,
} from '@immersia/capture';
import { Pill, cx } from '@immersia/ui';
import { useSettler } from './settle';

/** How long the operator rests on a camera before the booth switches to it. */
const SETTLE_MS = 600;

export const DEFAULT_CAMERA = '__default__';
export const SIMULATOR = '__simulator__';

/** A native high-speed lens (CAP-14) in the picker's one string value: `native:<lens id>`. */
const NATIVE_PREFIX = 'native:';
export const nativeValue = (lensId: string) => `${NATIVE_PREFIX}${lensId}`;
/** The lens id in a picker value, or null when the value is not a native lens. */
export const nativeLensId = (value: string) =>
  value.startsWith(NATIVE_PREFIX) ? value.slice(NATIVE_PREFIX.length) : null;

/** The native lenses as the picker's own lens type, so they are named and ordered the way browser lenses are. */
function nativeLensRows(lenses: readonly HighSpeedLens[]): { lens: GroupedLens; maxFps: number }[] {
  const asLenses: Lens[] = lenses.map((l, i) => ({
    deviceId: l.id,
    label: l.label,
    position: i + 1,
    ...nativeLensClass(l),
  }));
  const maxFps = new Map(lenses.map((l) => [l.id, Math.max(0, ...l.formats.map((f) => f.fps))]));
  return groupLenses(asLenses).flatMap((g) =>
    g.lenses.map((lens) => ({ lens, maxFps: maxFps.get(lens.deviceId) ?? 0 })),
  );
}

/** CAP-2: the human name of a lens, in the operator's language rather than the phone's. */
function LensName({ lens }: { lens: GroupedLens }) {
  const t = useTranslations('booth.settings.lenses');
  const n = lens.ordinal ? ` ${lens.ordinal}` : '';
  if (lens.facing === 'front') return `${t('front')}${n}`;
  if (lens.facing === 'back') {
    switch (lens.kind) {
      case 'wide':
        return `${t('backWide')}${n}`;
      case 'ultra-wide':
        return `${t('backUltraWide')}${n}`;
      case 'telephoto':
        return `${t('backTelephoto')}${n}`;
      case 'dual':
        return `${t('backDual')}${n}`;
      case 'triple':
        return `${t('backTriple')}${n}`;
      default:
        return `${t('back')}${n}`;
    }
  }
  // Webcams, capture cards and anything the browser did not name keep their own name.
  return lens.label || t('numbered', { n: lens.position });
}

function GroupTitle({ facing }: { facing: LensFacing }) {
  const t = useTranslations('booth.settings.lenses');
  return {
    back: t('groupBack'),
    front: t('groupFront'),
    external: t('groupExternal'),
    unknown: t('groupOther'),
  }[facing];
}

/**
 * The cameras to choose from, grouped by which way they face, with the one in use marked. Plain radio
 * inputs underneath, so arrow keys, screen readers and the form focus ring all come for free.
 */
export function LensPicker({
  lenses,
  selected,
  inUse,
  simulatorInUse,
  highSpeed,
  disabled,
  onSelect,
}: {
  lenses: readonly Lens[];
  /** `DEFAULT_CAMERA`, `SIMULATOR`, a device id, or `nativeValue(lens id)`. */
  selected: string;
  /** The device id the open camera is really using. */
  inUse: string | null;
  /** The open camera is the simulator (which has no device id). */
  simulatorInUse: boolean;
  /** CAP-14: the companion's native high-speed lenses, and the one in use; absent in a browser. */
  highSpeed?: { lenses: readonly HighSpeedLens[]; inUse: string | null };
  disabled: boolean;
  onSelect: (value: string) => void;
}) {
  const t = useTranslations('booth.settings');
  const name = useId();
  const groups = groupLenses(lenses);
  const highSpeedRows = highSpeed ? nativeLensRows(highSpeed.lenses) : [];
  // Arrowing through the cameras previews each one; the camera reopens for the one the operator rests on
  // (after a short pause, at once on a click, Enter or leaving the list).
  const [preview, setPreview] = useState<string | null>(null);
  const byPointer = useRef(false);
  const settler = useSettler<string>((value) => {
    setPreview(null);
    onSelect(value);
  }, SETTLE_MS);
  const shown = preview ?? selected;

  const option = (value: string, label: ReactNode, used = false) => (
    <label
      key={value}
      onPointerDown={() => {
        byPointer.current = true;
      }}
      className={cx(
        'flex min-h-11 cursor-pointer items-center gap-3 rounded-[10px] border border-line-strong bg-elev px-3 py-2 text-sm transition-colors hover:border-[#c9c6bd]',
        'has-[:checked]:border-accent has-[:checked]:bg-accent-soft has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-accent-soft',
        'has-[[aria-disabled=true]]:cursor-not-allowed has-[[aria-disabled=true]]:opacity-50',
      )}
    >
      <input
        type="radio"
        name={name}
        value={value}
        checked={shown === value}
        // aria-disabled, not disabled: a disabled radio drops keyboard focus, and the list is disabled
        // while the camera reopens, which is exactly after a choice was made with the keyboard.
        aria-disabled={disabled || undefined}
        onChange={() => {
          if (disabled) return;
          setPreview(value);
          // A tap or click is a decision; an arrow key is a stop on the way.
          settler.choose(value, byPointer.current);
        }}
        onKeyDown={(e) => {
          byPointer.current = false;
          if (e.key === 'Enter') {
            e.preventDefault(); // a radio has no use for Enter, and it must not submit anything around it
            settler.flush();
          }
        }}
        className="sr-only"
      />
      <span
        aria-hidden
        className={cx(
          'grid size-4 shrink-0 place-items-center rounded-full border',
          shown === value ? 'border-accent bg-accent text-white' : 'border-line-strong bg-elev',
        )}
      >
        {shown === value && <Check className="size-3" strokeWidth={3} />}
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {used && (
        <Pill tone="info" dot>
          {t('lenses.inUse')}
        </Pill>
      )}
    </label>
  );

  // Names (and ids) arrive with camera permission; until then the list may be empty or unnamed.
  const unnamed = lenses.length === 0 || lenses.some((l) => l.label === '');
  const savedButNotListed =
    selected !== DEFAULT_CAMERA &&
    selected !== SIMULATOR &&
    nativeLensId(selected) === null &&
    !lenses.some((l) => l.deviceId === selected);

  return (
    <div
      role="radiogroup"
      aria-label={t('camera')}
      className="space-y-3"
      onBlur={(e) => {
        // Leaving the list settles the choice.
        if (!e.currentTarget.contains(e.relatedTarget)) settler.flush();
      }}
    >
      {option(DEFAULT_CAMERA, t('defaultCamera'))}
      {savedButNotListed && option(selected, t('lenses.saved'))}
      {groups.map((g) => (
        <div key={g.facing} role="group" aria-labelledby={`${name}-${g.facing}`} className="space-y-1.5">
          <p id={`${name}-${g.facing}`} className="text-[11px] font-semibold tracking-wider text-faint uppercase">
            <GroupTitle facing={g.facing} />
          </p>
          {g.lenses.map((l) => option(l.deviceId, <LensName lens={l} />, inUse === l.deviceId))}
        </div>
      ))}
      {highSpeedRows.length > 0 && (
        <div role="group" aria-labelledby={`${name}-hfr`} className="space-y-1.5">
          <p id={`${name}-hfr`} className="text-[11px] font-semibold tracking-wider text-faint uppercase">
            {t('hfr.group')}
          </p>
          {highSpeedRows.map(({ lens, maxFps }) =>
            option(
              nativeValue(lens.deviceId),
              <>
                <LensName lens={lens} />
                <span className="text-faint"> · {t('hfr.maxFps', { fps: maxFps })}</span>
              </>,
              highSpeed?.inUse === lens.deviceId,
            ),
          )}
        </div>
      )}
      {option(SIMULATOR, t('simulator'), simulatorInUse)}
      {unnamed && <p className="text-[13px] text-faint">{t('lenses.namesLater')}</p>}
    </div>
  );
}
