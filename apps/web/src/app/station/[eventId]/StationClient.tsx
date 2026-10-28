'use client';

import dynamic from 'next/dynamic';
import type { StationEvent } from './Station';

/** Client-only: the station keeps its feed in localStorage and runs full screen (no server render). */
const Station = dynamic(() => import('./Station').then((m) => m.Station), {
  ssr: false,
  loading: () => <div className="fixed inset-0 bg-g-bg" aria-busy="true" />,
});

export function StationClient({ event }: { event: StationEvent }) {
  return <Station event={event} />;
}
