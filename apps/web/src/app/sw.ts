/// <reference lib="webworker" />
import { defaultCache } from '@serwist/turbopack/worker';
import { ExpirationPlugin, Serwist, StaleWhileRevalidate, type PrecacheEntry, type SerwistGlobalConfig } from 'serwist';

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

/**
 * Offline shell (NFR Installability). Deliberately NO skipWaiting/clientsClaim: a booth must never
 * hot-swap its code in the middle of a guest session. A new version activates when every tab of
 * the app has closed (i.e. between events); the operator UI can prompt for that later.
 */
const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: false,
  clientsClaim: false,
  navigationPreload: true,
  runtimeCaching: [
    // The PHO-9 font library: a booth must draw its event's fonts offline, and the default font rule
    // keeps only a handful of files.
    {
      matcher: ({ url, sameOrigin }) => sameOrigin && url.pathname.startsWith('/fonts/lib/'),
      handler: new StaleWhileRevalidate({
        cacheName: 'font-library',
        plugins: [new ExpirationPlugin({ maxEntries: 600, maxAgeSeconds: 365 * 24 * 60 * 60 })],
      }),
    },
    ...defaultCache,
  ],
  fallbacks: {
    entries: [
      {
        url: '/~offline',
        matcher: ({ request }) => request.destination === 'document',
      },
    ],
  },
});

serwist.addEventListeners();
