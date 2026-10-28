'use client';

import { useCallback, useEffect, useRef } from 'react';
import { describeUserAgent, uuidv7, type EventFrom } from '@immersia/shared';
import { emitDeviceEvent } from '@/lib/analytics-client';
import { installCrashReporter } from '@/lib/crash-reporter';
import { useAnalyticsFlusher } from '@/lib/use-analytics-flusher';

/** The browser label analytics events carry: "Chrome", "Safari"…, from the user agent, nothing else. */
export const boothBrowser = (): string => describeUserAgent(navigator.userAgent).browser;

/**
 * A booth's analytics (PRD "Tracked events"). While a booth is open it:
 *  - marks the booth session's start and end (events completed without a crash = sessions with no
 *    crash report against those that ended or ran);
 *  - reports window errors and unhandled rejections as `booth_crashed` (error name and a hash of the
 *    code location only);
 *  - buffers every event in the device database and sends them in the background with backoff, so a
 *    booth with no signal still reports, and reporting never gets in front of capture or rendering.
 * Returns `track`, which adds the event it is running.
 */
export function useBoothAnalytics(opts: { eventId: string; mode: 'video360' | 'photo'; token: string | null }) {
  const { eventId, mode, token } = opts;
  const session = useRef<{ id: string; takes: number } | null>(null);

  // Declared before the flusher: on pagehide the session's end must be buffered before it flushes.
  useEffect(() => {
    if (!token) return;
    const id = uuidv7();
    const startedAt = performance.now();
    session.current = { id, takes: 0 };
    emitDeviceEvent(
      {
        name: 'booth_session_started',
        session_id: id,
        mode,
        app_version: process.env.NEXT_PUBLIC_APP_VERSION ?? 'dev',
      },
      eventId,
    );
    let ended = false;
    const end = () => {
      if (ended) return;
      ended = true;
      emitDeviceEvent(
        {
          name: 'booth_session_ended',
          session_id: id,
          duration_s: Math.min(86_400, (performance.now() - startedAt) / 1000),
          takes: Math.min(10_000, session.current?.takes ?? 0),
        },
        eventId,
      );
    };
    const uninstall = installCrashReporter((crash) =>
      emitDeviceEvent({ name: 'booth_crashed', ...crash, session_id: id }, eventId),
    );
    window.addEventListener('pagehide', end);
    return () => {
      window.removeEventListener('pagehide', end);
      uninstall();
      end();
      session.current = null;
    };
  }, [eventId, mode, token]);

  useAnalyticsFlusher('device', token);

  return useCallback(
    (event: EventFrom<'device'>) => {
      if (event.name === 'take_recorded' && session.current) session.current.takes += 1;
      emitDeviceEvent(event, eventId);
    },
    [eventId],
  );
}
