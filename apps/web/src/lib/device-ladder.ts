import { availableRungs, wasmEncoderSupported, type Availability } from '@immersia/render-engine';
import { detectCapabilities } from '@/lib/device-capabilities';
import { workerUrl } from '@/lib/workers';

/**
 * What this device can do on the render ladder, detected once per page (the answer does not change
 * while it is open). `serverRender` says whether the deployment has a render worker.
 */
let detected: ReturnType<typeof detectCapabilities> | null = null;

export async function availability(serverRender: boolean): Promise<Availability> {
  detected ??= detectCapabilities();
  return availableRungs(await detected, { wasm: wasmEncoderSupported(), server: serverRender });
}

/**
 * The encoder for work that has to stay on this device (the photo booth's boomerang and short video):
 * the browser's own, or the WebAssembly one where the browser has none.
 */
export async function localEncoder(): Promise<'native' | 'wasm'> {
  const av = await availability(false);
  return !av.local && av.wasm ? 'wasm' : 'native';
}

/**
 * A device that needs the WebAssembly encoder fetches it now, while it is online: the service worker
 * keeps it, so the booth still renders when the connection is gone.
 */
export async function warmWasmEncoder(serverRender: boolean): Promise<void> {
  const av = await availability(serverRender);
  if (av.local || !av.wasm || !navigator.onLine) return;
  await fetch(workerUrl('h264-encoder'))
    .then((r) => r.arrayBuffer())
    .catch(() => undefined);
}
