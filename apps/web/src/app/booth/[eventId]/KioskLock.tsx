'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { AnimatePresence, motion } from 'motion/react';
import { Delete, Maximize } from 'lucide-react';
import { checkKioskPin } from '@immersia/shared/kiosk';

/** Wrong PINs allowed before the keypad pauses. */
const MAX_TRIES = 5;
const LOCKOUT_MS = 30_000;
/** Taps on the hidden corner, within this window, that open the keypad. */
const CORNER_TAPS = 3;
const CORNER_WINDOW_MS = 1500;

const fullscreenEl = () => document.fullscreenElement ?? null;

/**
 * KIO-1 kiosk mode: with a PIN set for the event, the booth runs full screen with the operator's
 * controls hidden until the PIN is entered. A browser can't truly lock a device (Esc always leaves
 * full screen), so leaving full screen shows a tap-to-return screen, and the help centre explains
 * Guided Access / screen pinning / Chrome --kiosk for a hard lock.
 */
export function useKioskLock(pinHash: string | null) {
  const [locked, setLocked] = useState(Boolean(pinHash));
  const [keypad, setKeypad] = useState(false);
  const [outOfFullscreen, setOutOfFullscreen] = useState(false);

  /** Call from a user gesture (Start booth): full screen needs one. */
  const enter = useCallback(async () => {
    if (!pinHash || fullscreenEl()) return;
    await document.documentElement.requestFullscreen?.({ navigationUI: 'hide' }).catch(() => undefined);
  }, [pinHash]);

  useEffect(() => {
    if (!pinHash || !locked) return;
    const onChange = () => setOutOfFullscreen(!fullscreenEl());
    const beforeUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    document.addEventListener('fullscreenchange', onChange);
    window.addEventListener('beforeunload', beforeUnload);
    return () => {
      document.removeEventListener('fullscreenchange', onChange);
      window.removeEventListener('beforeunload', beforeUnload);
    };
  }, [pinHash, locked]);

  const unlock = useCallback(() => {
    setLocked(false);
    setKeypad(false);
    setOutOfFullscreen(false);
    if (fullscreenEl()) void document.exitFullscreen().catch(() => undefined);
  }, []);

  return {
    /** Operator controls are hidden while true. */
    locked: Boolean(pinHash) && locked,
    enter,
    relock: () => setLocked(true),
    keypadOpen: keypad,
    openKeypad: () => setKeypad(true),
    closeKeypad: () => setKeypad(false),
    outOfFullscreen: Boolean(pinHash) && locked && outOfFullscreen,
    unlock,
  };
}

export type KioskLock = ReturnType<typeof useKioskLock>;

/** The hidden corner, the keypad and the tap-to-return screen. Render last, above the booth. */
export function KioskLockLayer({
  eventId,
  pinHash,
  kiosk,
}: {
  eventId: string;
  pinHash: string | null;
  kiosk: KioskLock;
}) {
  const t = useTranslations('booth.kiosk');
  const taps = useRef<number[]>([]);
  if (!pinHash || !kiosk.locked) return null;

  const onCorner = () => {
    const now = performance.now();
    taps.current = [...taps.current.filter((at) => now - at < CORNER_WINDOW_MS), now];
    if (taps.current.length >= CORNER_TAPS) {
      taps.current = [];
      kiosk.openKeypad();
    }
  };

  return (
    <>
      {/* Invisible to guests; operators know to triple-tap the top-left corner. */}
      <button
        type="button"
        aria-label={t('operator')}
        onClick={onCorner}
        className="fixed top-0 left-0 z-40 size-20 opacity-0 focus-visible:opacity-100"
      />
      <AnimatePresence>
        {kiosk.outOfFullscreen && !kiosk.keypadOpen && (
          <motion.button
            type="button"
            key="return"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => void kiosk.enter()}
            className="fixed inset-0 z-30 grid place-items-center bg-g-bg text-g-ink"
          >
            <span className="flex flex-col items-center gap-4 text-[1.5rem] font-semibold">
              <Maximize className="size-10" aria-hidden />
              {t('tapToReturn')}
            </span>
          </motion.button>
        )}
        {kiosk.keypadOpen && (
          <PinPad key="pad" eventId={eventId} pinHash={pinHash} onCancel={kiosk.closeKeypad} onUnlock={kiosk.unlock} />
        )}
      </AnimatePresence>
    </>
  );
}

function PinPad({
  eventId,
  pinHash,
  onCancel,
  onUnlock,
}: {
  eventId: string;
  pinHash: string;
  onCancel: () => void;
  onUnlock: () => void;
}) {
  const t = useTranslations('booth.kiosk');
  const [pin, setPin] = useState('');
  const [wrong, setWrong] = useState(0);
  const [lockedUntil, setLockedUntil] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const pausedFor = Math.max(0, Math.ceil((lockedUntil - now) / 1000));

  useEffect(() => {
    if (!lockedUntil) return;
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [lockedUntil]);

  const submit = async (value: string) => {
    if (await checkKioskPin(eventId, value, pinHash)) return onUnlock();
    const n = wrong + 1;
    setWrong(n);
    setPin('');
    if (n >= MAX_TRIES) {
      setLockedUntil(Date.now() + LOCKOUT_MS);
      setNow(Date.now());
      setWrong(0);
    }
  };

  const press = (d: string) => {
    if (pausedFor > 0) return;
    const next = (pin + d).slice(0, 8);
    setPin(next);
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 grid place-items-center bg-[#111110]/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={t('title')}
      onKeyDown={(e) => {
        if (/^\d$/.test(e.key)) press(e.key);
        else if (e.key === 'Backspace') setPin((p) => p.slice(0, -1));
        else if (e.key === 'Enter' && pin.length >= 4) void submit(pin);
        else if (e.key === 'Escape') onCancel();
      }}
    >
      <div className="w-[min(22rem,100%)] rounded-[1.5rem] bg-bg p-6 text-fg shadow-pop">
        <h2 className="text-center text-lg font-semibold">{t('title')}</h2>
        <p className="mt-1 text-center text-sm text-muted" role="status" aria-live="polite">
          {pausedFor > 0 ? t('paused', { seconds: pausedFor }) : wrong > 0 ? t('wrong') : t('hint')}
        </p>
        <div className="mt-4 flex justify-center gap-2" aria-hidden>
          {Array.from({ length: Math.max(4, pin.length) }, (_, i) => (
            <span key={i} className={`size-3 rounded-full ${i < pin.length ? 'bg-fg' : 'bg-line-strong'}`} />
          ))}
        </div>
        <div className="mt-5 grid grid-cols-3 gap-2">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => press(d)}
              disabled={pausedFor > 0}
              className="focus-ring h-14 rounded-xl bg-elev text-xl font-semibold tabular shadow-card disabled:opacity-40"
            >
              {d}
            </button>
          ))}
          <button
            type="button"
            onClick={onCancel}
            className="focus-ring h-14 rounded-xl text-sm font-semibold text-muted"
          >
            {t('cancel')}
          </button>
          <button
            type="button"
            onClick={() => press('0')}
            disabled={pausedFor > 0}
            className="focus-ring h-14 rounded-xl bg-elev text-xl font-semibold tabular shadow-card disabled:opacity-40"
          >
            0
          </button>
          <button
            type="button"
            aria-label={t('delete')}
            onClick={() => setPin((p) => p.slice(0, -1))}
            className="focus-ring grid h-14 place-items-center rounded-xl text-muted"
          >
            <Delete className="size-5" aria-hidden />
          </button>
        </div>
        <button
          type="button"
          disabled={pin.length < 4 || pausedFor > 0}
          onClick={() => void submit(pin)}
          className="focus-ring mt-3 h-12 w-full rounded-xl bg-ink font-semibold text-white disabled:opacity-40"
        >
          {t('unlock')}
        </button>
      </div>
    </motion.div>
  );
}
