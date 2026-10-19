'use client';

import { useEffect, useRef, useState } from 'react';
import { liveQuery } from 'dexie';
import { UploadQueue, boothDb, topUpCodes, type TakeStore } from '@immersia/offline';
import { createBoothApi } from './booth-api';

export interface UploadStatus {
  /** Sessions with something still to register, email or upload. */
  waiting: number;
  /** Sessions the server refused (the operator should look). */
  failed: number;
  revoked: boolean;
}

/**
 * Drives the booth's upload queue (DL-1, SHR-8): one step at a time while online, waking up when
 * something new is saved or rendered, when the network comes back, or when a backoff ends. Also
 * keeps the device's short-code pool topped up for the event (DL-2).
 */
export function useUploadQueue(opts: { eventId: string; token: string | null; store: TakeStore | null }) {
  const { eventId, token, store } = opts;
  const db = boothDb();
  const [status, setStatus] = useState<UploadStatus>({ waiting: 0, failed: 0, revoked: false });
  const queueRef = useRef<UploadQueue | null>(null);
  const kickRef = useRef<() => void>(() => {});

  // Counts for the header pill.
  useEffect(() => {
    const sub = liveQuery(async () => {
      const sessions = await db.sessions.where('eventId').equals(eventId).toArray();
      return {
        waiting: sessions.filter((s) => s.state === 'local' || s.state === 'registered').length,
        failed: sessions.filter((s) => s.state === 'failed').length,
      };
    }).subscribe({
      next: (c) => setStatus((s) => ({ ...s, ...c })),
      error: (e) => console.error('[uploads]', e),
    });
    return () => sub.unsubscribe();
  }, [db, eventId]);

  useEffect(() => {
    if (!token || !store) return;
    const api = createBoothApi(token);
    const queue = new UploadQueue(db, store, api);
    queueRef.current = queue;
    let stopped = false;
    let wake: (() => void) | null = null;
    const kick = () => wake?.();
    kickRef.current = kick;

    const refillCodes = () => {
      if (navigator.onLine) void topUpCodes(db, api.reserveCodes, eventId).catch(() => undefined);
    };

    const loop = async () => {
      while (!stopped) {
        if (!navigator.onLine) {
          await new Promise<void>((r) => (wake = r));
          continue;
        }
        const step = await queue.runOnce();
        if (step.kind === 'revoked') {
          setStatus((s) => ({ ...s, revoked: true }));
          return;
        }
        if (step.kind !== 'idle' && step.kind !== 'retry') continue;
        // Nothing due: sleep until the next backoff ends or something changes.
        const at = await queue.nextWakeAt();
        await new Promise<void>((resolve) => {
          const timer = at === null ? undefined : setTimeout(resolve, Math.max(250, at - Date.now()));
          wake = () => {
            clearTimeout(timer);
            resolve();
          };
        });
      }
    };

    // New sessions, rendered outputs and queued emails wake the loop.
    const sub = liveQuery(() =>
      Promise.all([db.sessions.where('eventId').equals(eventId).count(), db.outputs.count()]),
    ).subscribe({ next: kick, error: () => undefined });
    const onOnline = () => {
      refillCodes();
      kick();
    };
    window.addEventListener('online', onOnline);
    refillCodes();
    const refill = setInterval(refillCodes, 60_000);
    void loop();

    return () => {
      stopped = true;
      kick();
      sub.unsubscribe();
      window.removeEventListener('online', onOnline);
      clearInterval(refill);
      queueRef.current = null;
      kickRef.current = () => {};
    };
  }, [db, eventId, token, store]);

  return {
    status,
    /** A take finished rendering: let its session upload now. */
    nudge: (takeId: string) => void queueRef.current?.nudge(takeId).then(() => kickRef.current()),
  };
}
