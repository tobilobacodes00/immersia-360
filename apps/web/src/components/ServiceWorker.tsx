'use client';

import type { ReactNode } from 'react';
import { SerwistProvider } from '@serwist/turbopack/react';

/** Registers the service worker in production builds only (dev reloads would fight the cache). */
export function ServiceWorker({ children }: { children: ReactNode }) {
  return (
    <SerwistProvider swUrl="/serwist/sw.js" disable={process.env.NODE_ENV !== 'production'} reloadOnOnline={false}>
      {children}
    </SerwistProvider>
  );
}
