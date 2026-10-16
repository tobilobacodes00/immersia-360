'use client';

/**
 * Guest-screen building blocks, ported from Immersia Booth src/booth/screens.tsx. Light and
 * editorial: the event's own background, ink and one accent (--g-* variables on the guest root,
 * used through the g-* colour tokens). Sizes are rem-based and follow `html.booth-active`.
 */
import type { ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { EASE_OUT_EXPO, cx, tapSpring } from './cx';
import { QrCode } from './qr';

export type DisplayFont = 'sans' | 'serif';

export const displayFontClass = (font: DisplayFont) =>
  font === 'serif' ? 'font-serif' : 'font-sans font-bold tracking-[-0.04em]';

export const fade = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
  transition: { duration: 0.3 },
} as const;

export function Headline({
  children,
  font = 'sans',
  className,
}: {
  children: ReactNode;
  font?: DisplayFont;
  className?: string;
}) {
  return <h1 className={cx(displayFontClass(font), 'leading-[0.95] text-balance', className)}>{children}</h1>;
}

/** Guest button: solid accent for the main action, outlined ink otherwise. Big touch targets (≥ 44 px). */
export function GuestButton({
  children,
  onClick,
  primary,
  className,
  disabled,
  ariaLabel,
}: {
  children: ReactNode;
  onClick: () => void;
  primary?: boolean;
  className?: string;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  return (
    <motion.button
      type="button"
      whileTap={{ scale: 0.96 }}
      transition={tapSpring}
      disabled={disabled}
      aria-label={ariaLabel}
      onClick={onClick}
      className={cx(
        'focus-ring flex min-h-[4.25rem] min-w-[44px] items-center justify-center gap-3 rounded-full px-10 text-[1.35rem] font-semibold transition-colors disabled:opacity-40',
        primary ? 'bg-g-accent text-g-on-accent' : 'border-2 border-g-ink/15 bg-g-bg text-g-ink hover:border-g-ink/30',
        className,
      )}
    >
      {children}
    </motion.button>
  );
}

/** Solid countdown disc with a progress ring: reads over any scene without darkening the guests. */
export function CountdownDisc({
  count,
  total,
  font = 'sans',
  label,
}: {
  count: number;
  total: number;
  font?: DisplayFont;
  label: string;
}) {
  const R = 150;
  const C = 2 * Math.PI * R;
  const t = Math.max(total, 1);
  return (
    <div
      className="relative grid size-[min(17rem,46vmin)] place-items-center rounded-full bg-g-bg text-g-ink"
      role="timer"
      aria-live="assertive"
      aria-label={label}
    >
      <svg className="absolute inset-[-6%] -rotate-90" viewBox="0 0 340 340" aria-hidden>
        <circle
          cx="170"
          cy="170"
          r={R}
          fill="none"
          stroke="var(--g-bg, #f7f6f2)"
          strokeOpacity="0.55"
          strokeWidth="10"
        />
        <motion.circle
          key={count}
          cx="170"
          cy="170"
          r={R}
          fill="none"
          stroke="var(--g-accent, #2b3fe6)"
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={C}
          initial={{ strokeDashoffset: C * (1 - count / t) - C / t }}
          animate={{ strokeDashoffset: C * (1 - (count - 1) / t) }}
          transition={{ duration: 1, ease: 'linear' }}
        />
      </svg>
      <AnimatePresence mode="popLayout">
        <motion.span
          key={count}
          initial={{ scale: 1.5, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.6, opacity: 0 }}
          transition={{ duration: 0.35, ease: EASE_OUT_EXPO }}
          className={cx(displayFontClass(font), 'tabular text-[10rem] leading-none')}
        >
          {count}
        </motion.span>
      </AnimatePresence>
    </div>
  );
}

/** White QR card with caption and optional short code, as on Immersia Booth's share screen. */
export function QrCard({
  value,
  caption,
  alt,
  code,
  note,
  className,
}: {
  value: string;
  caption: string;
  alt: string;
  code?: string;
  note?: string;
  className?: string;
}) {
  return (
    <motion.div
      initial={{ scale: 0.94, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ delay: 0.25, duration: 0.5, ease: EASE_OUT_EXPO }}
      className={cx(
        'w-[min(15rem,44vw)] rounded-[1.5rem] border border-black/10 bg-white p-4 text-center text-[#111110]',
        className,
      )}
    >
      <QrCode value={value} label={alt} />
      <div className="mt-2 text-sm font-bold tracking-[0.18em] uppercase">{caption}</div>
      {code && <div className="tabular mt-1 font-mono text-lg font-bold tracking-[0.12em]">{code}</div>}
      {note && <div className="mt-1 text-xs leading-snug text-black/60">{note}</div>}
    </motion.div>
  );
}

/** Output on one side, actions on the other (stacked in portrait). Used by result screens. */
export function OutputLayout({ media, children }: { media: ReactNode; children: ReactNode }) {
  return (
    <motion.div
      {...fade}
      className="absolute inset-0 flex flex-col items-center justify-center gap-10 overflow-y-auto bg-g-bg px-6 py-10 text-g-ink landscape:flex-row landscape:gap-[6vw] landscape:px-[6vw]"
    >
      <div className="max-h-[42vh] max-w-[86vw] landscape:max-h-[80vh] landscape:max-w-[44vw]">{media}</div>
      <motion.div
        initial={{ x: 24, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        transition={{ delay: 0.12, duration: 0.6, ease: EASE_OUT_EXPO }}
        className="relative flex max-w-lg flex-col portrait:items-center portrait:text-center"
      >
        {children}
      </motion.div>
    </motion.div>
  );
}
