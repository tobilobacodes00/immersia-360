/**
 * Create the OPFS writer from a URL the app serves (apps/web bundles it to /workers/opfs.js at
 * build time — see apps/web/scripts/build-workers.mjs for why it isn't a bundler worker).
 */
export function createOpfsWorker(url: string): Worker {
  return new Worker(url, { type: 'module' });
}
