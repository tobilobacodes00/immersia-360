'use client';

import dynamic from 'next/dynamic';
import type { BoothEvent } from './Booth360';
import type { PhotoBoothEvent } from './PhotoBooth';

/**
 * The booth is a client-only surface: camera, MediaRecorder, OPFS and the device identity in
 * localStorage don't exist on the server, so it is never server-rendered (no hydration mismatch).
 * Each booth is its own chunk: a photo booth never downloads the 360 capture code and vice versa.
 */
const loading = () => <div className="fixed inset-0 bg-g-bg" aria-busy="true" />;
const Booth360 = dynamic(() => import('./Booth360').then((m) => m.Booth360), { ssr: false, loading });
const PhotoBooth = dynamic(() => import('./PhotoBooth').then((m) => m.PhotoBooth), { ssr: false, loading });

export function BoothClient(
  props: { mode: 'video360'; event: BoothEvent } | { mode: 'photo'; event: PhotoBoothEvent },
) {
  return props.mode === 'photo' ? <PhotoBooth event={props.event} /> : <Booth360 event={props.event} />;
}
