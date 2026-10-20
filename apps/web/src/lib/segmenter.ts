import { SEGMENTER_ASSETS, createSegmenter, type Segmenter } from '@immersia/capture/segment';
import type { MaskSource } from '@immersia/render-engine/background';

/**
 * The page's person segmenter (CAP-10), shared by the live preview and the photo stills: the model and the
 * WebAssembly runtime are loaded once, on first use, from our own origin (cached by the service worker, so it
 * works offline), and every frame is segmented on this device. The render worker has its own.
 */
let shared: Promise<Segmenter> | null = null;

function open(): Promise<Segmenter> {
  shared ??= createSegmenter({ ...SEGMENTER_ASSETS, delegate: 'GPU' }).catch((err: unknown) => {
    shared = null; // a later use tries again
    throw err;
  });
  return shared;
}

/** A handle on the shared segmenter. Closing it does nothing: the segmenter lives as long as the page. */
export function pageSegmenter(): Promise<MaskSource> {
  return open().then((s) => ({ mask: (frame, ts) => s.mask(frame, ts), close: () => undefined }));
}
