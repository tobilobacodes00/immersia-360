/// <reference lib="webworker" />
import { defaultCache } from '@serwist/turbopack/worker';
import {
  CacheFirst,
  ExpirationPlugin,
  NetworkOnly,
  Serwist,
  StaleWhileRevalidate,
  type PrecacheEntry,
  type SerwistGlobalConfig,
} from 'serwist';

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

/** Where Capacitor's WebView serves files and content URIs from the device (the companion app, CAP-14). */
const NATIVE_FILE_PREFIX = '/_capacitor_file_/';
const NATIVE_CONTENT_PREFIX = '/_capacitor_content_/';

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
    // Live Display (LIV-12): a screen keeps its own copy of the feed (localStorage) and of the media
    // bytes (Cache Storage, see app/tv/live/media-cache.ts). The default rule for /api/ would cache
    // the token-authenticated feed by URL alone and copy every video it plays into a second cache.
    {
      matcher: ({ url, sameOrigin }) => sameOrigin && url.pathname.startsWith('/api/live/'),
      handler: new NetworkOnly(),
    },
    // The PHO-9 font library: a booth must draw its event's fonts offline, and the default font rule
    // keeps only a handful of files.
    {
      matcher: ({ url, sameOrigin }) => sameOrigin && url.pathname.startsWith('/fonts/lib/'),
      handler: new StaleWhileRevalidate({
        cacheName: 'font-library',
        plugins: [new ExpirationPlugin({ maxEntries: 600, maxAgeSeconds: 365 * 24 * 60 * 60 })],
      }),
    },
    // CAP-10: the segmentation model and WebAssembly runtime (public/mediapipe/, ~35 MB across the variants,
    // fetched only where a background is set). Cached on first use and then served from the cache for good:
    // the files never change within a deploy, and the loader scripts must stay paired with their .wasm, so the
    // cache is named for the pinned @mediapipe/tasks-vision version (pnpm-workspace.yaml; a test keeps them equal).
    {
      matcher: ({ url, sameOrigin }) => sameOrigin && url.pathname.startsWith('/mediapipe/'),
      handler: new CacheFirst({
        cacheName: 'mediapipe-1.0.1',
        plugins: [new ExpirationPlugin({ maxEntries: 12, maxAgeSeconds: 365 * 24 * 60 * 60 })],
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

// CAP-14: inside the companion app the booth reads the native camera's recordings through Capacitor's file
// URLs (`/_capacitor_file_/...`), which the WebView itself serves from the device's storage. They belong to no
// cache (the default video rule would copy a whole recorded take into Cache Storage) and a service worker's own
// fetch would not reach the WebView's file server at all. Registered before Serwist's listeners, this one stops
// the event there: with no response given, the request goes on as if no service worker were running.
self.addEventListener('fetch', (event) => {
  const { pathname } = new URL(event.request.url);
  if (pathname.startsWith(NATIVE_FILE_PREFIX) || pathname.startsWith(NATIVE_CONTENT_PREFIX)) {
    event.stopImmediatePropagation();
  }
});

serwist.addEventListeners();
