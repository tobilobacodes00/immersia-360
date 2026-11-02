'use client';

import dynamic from 'next/dynamic';
import type { SetupCheckProps } from './SetupCheck';

/**
 * Camera, MediaRecorder, OPFS and the device identity in localStorage don't exist on the server, so
 * the setup check is client-only, like the booth itself (see ../BoothClient.tsx).
 */
const SetupCheck = dynamic(() => import('./SetupCheck').then((m) => m.SetupCheck), {
  ssr: false,
  loading: () => <div className="min-h-dvh" aria-busy="true" />,
});

export function CheckClient(props: SetupCheckProps) {
  return <SetupCheck {...props} />;
}
