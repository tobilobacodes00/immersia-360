'use client';

import dynamic from 'next/dynamic';
import type { BoothEvent } from './Booth360';

/**
 * The booth is a client-only surface: camera, MediaRecorder, OPFS and the device identity in
 * localStorage don't exist on the server, so it is never server-rendered (no hydration mismatch).
 */
const Booth360 = dynamic(() => import('./Booth360').then((m) => m.Booth360), {
  ssr: false,
  loading: () => <div className="fixed inset-0 bg-g-bg" aria-busy="true" />,
});

export function BoothClient({ event }: { event: BoothEvent }) {
  return <Booth360 event={event} />;
}
