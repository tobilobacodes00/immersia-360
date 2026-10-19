/**
 * URLs of the app's Web Workers (built by scripts/build-workers.mjs into public/workers). The build
 * id busts the cache on every deploy while the service worker precaches them for offline booths.
 */
const BUILD = process.env.NEXT_PUBLIC_BUILD_ID ?? 'dev';

export const workerUrl = (name: 'opfs' | 'render') => `/workers/${name}.js?v=${BUILD}`;
