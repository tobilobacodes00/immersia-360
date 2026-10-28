'use client';

import { useEffect } from 'react';
import { backoffMs, boothDb, flushAnalytics, type AnalyticsChannel } from '@immersia/offline';
import { ANALYTICS_WAKE, sendBatch } from './analytics-client';

/** Events buffered within this long of each other leave in one batch. */
const BATCH_WAIT_MS = 3000;
/** The first look at the outbox, after startup: leftovers from a previous visit, never competing with the camera. */
const STARTUP_DELAY_MS = 5000;

/**
 * Sends a channel's buffered analytics events (see lib/analytics-client): a few seconds after they
 * are recorded, when the network returns, when the page is being closed, and again with backoff
 * after a failure. All of it runs off the main flow: a failure only means the events wait.
 * `token` is the device token (booth) or the display token (Live Display); without one nothing is sent.
 */
export function useAnalyticsFlusher(channel: AnalyticsChannel, token: string | null) {
  useEffect(() => {
    if (!token) return;
    const db = boothDb();
    const authorization = channel === 'device' ? `Device ${token}` : `Bearer ${token}`;
    let stopped = false;
    let running = false;
    let attempts = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let pending = false;

    const schedule = (ms: number) => {
      clearTimeout(timer);
      pending = true;
      timer = setTimeout(() => void run(false), ms);
    };

    const run = async (keepalive: boolean) => {
      pending = false;
      if (stopped || running) return;
      if (!keepalive && !navigator.onLine) return; // the 'online' event picks it up
      running = true;
      try {
        for (;;) {
          const step = await flushAnalytics(db, channel, (batch) => sendBatch(authorization, batch, keepalive));
          if (step === 'sent' || step === 'dropped') {
            attempts = 0;
            continue;
          }
          if (step === 'retry') {
            attempts += 1;
            if (!stopped) schedule(backoffMs(attempts));
          }
          // empty: all sent. unauthorized: the credentials are gone; the booth or display says so elsewhere.
          return;
        }
      } finally {
        running = false;
      }
    };

    const onWake = () => {
      if (!pending) schedule(BATCH_WAIT_MS);
    };
    const onOnline = () => void run(false);
    // The page is going away: send what is waiting while the browser still lets a request finish.
    const onHide = () => void run(true);
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') onHide();
    };

    window.addEventListener(ANALYTICS_WAKE, onWake);
    window.addEventListener('online', onOnline);
    window.addEventListener('pagehide', onHide);
    document.addEventListener('visibilitychange', onVisibility);
    schedule(STARTUP_DELAY_MS);
    return () => {
      stopped = true;
      clearTimeout(timer);
      window.removeEventListener(ANALYTICS_WAKE, onWake);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('pagehide', onHide);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [channel, token]);
}
