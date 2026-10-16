'use client';

import { useEffect, type ReactNode } from 'react';
import { SerwistProvider } from '@serwist/turbopack/react';

/** Registers the service worker in production builds only (dev reloads would fight the cache). */
export function ServiceWorker({ children }: { children: ReactNode }) {
  // Marks the document once React is live: e2e waits on it, and it helps diagnose kiosk issues.
  useEffect(() => {
    document.documentElement.dataset.hydrated = '1';
  }, []);
  return (
    <SerwistProvider swUrl="/serwist/sw.js" disable={process.env.NODE_ENV !== 'production'} reloadOnOnline={false}>
      {children}
    </SerwistProvider>
  );
}
