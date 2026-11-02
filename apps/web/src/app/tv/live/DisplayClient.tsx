'use client';

import dynamic from 'next/dynamic';

/**
 * The display is a client-only surface: its token and last feed live in localStorage, its media in
 * Cache Storage, and it plays video and sound; none of that exists on the server, so it is never
 * server-rendered (no hydration mismatch).
 */
const DisplayApp = dynamic(() => import('./DisplayApp').then((m) => m.DisplayApp), {
  ssr: false,
  loading: () => <div className="fixed inset-0 bg-bg" aria-busy="true" />,
});

export function DisplayClient() {
  return <DisplayApp />;
}
