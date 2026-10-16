export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

/** Motion springs from Immersia Booth (kit.tsx): crisp UI, soft modals, snappy guest taps. */
export const spring = { type: 'spring' as const, stiffness: 420, damping: 34, mass: 0.8 };
export const softSpring = { type: 'spring' as const, stiffness: 220, damping: 28 };
export const tapSpring = { type: 'spring' as const, stiffness: 500, damping: 30 };
export const EASE_OUT_EXPO = [0.16, 1, 0.3, 1] as const;
