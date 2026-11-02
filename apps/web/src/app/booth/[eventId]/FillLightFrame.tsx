'use client';

import { AnimatePresence, motion } from 'motion/react';
import { fade } from '@immersia/ui/guest';
import type { FillLight } from './camera-choice';
import { fillLightShadow } from './fill-light';

/**
 * The fill-light frame (CAP-6): a glow around the screen edge over the live preview, under every
 * guest control. It takes no taps and is not read out. It is a guest-facing element, so the kiosk lock
 * (which only hides the operator's controls) leaves it on; the lock also keeps anyone from changing
 * it. `active` is whether the camera is live and faces the guest.
 */
export function FillLightFrame({ fill, active }: { fill: FillLight; active: boolean }) {
  const shadow = active ? fillLightShadow(fill) : null;
  return (
    <AnimatePresence>
      {shadow && (
        <motion.div
          {...fade}
          aria-hidden
          data-fill-light={fill.level}
          data-fill-tint={fill.tint}
          // Under the countdown, the result and the controls (all z-10 and up), over the video.
          className="pointer-events-none absolute inset-0 z-[5] transition-[box-shadow] duration-300 motion-reduce:transition-none"
          style={{ boxShadow: shadow }}
        />
      )}
    </AnimatePresence>
  );
}
