'use client';

import { useEffect, useRef, useState } from 'react';
import type { AssetType } from '@immersia/shared';
import { AssetUploadError, isAbort, uploadAsset, type AssetUploadErrorCode } from '@/lib/asset-upload';
import type { AssetView } from '@/server/assets';

export interface UploadItem {
  key: number;
  file: File;
  type: AssetType;
  /** 0 while the file is being checked, then the share of bytes sent. */
  fraction: number;
  error: { code: AssetUploadErrorCode; limit?: number } | null;
}

/** Two at a time: enough to keep a connection busy without starving the page of bandwidth. */
const CONCURRENCY = 2;

/**
 * The upload queue behind the library and the picker: per-file progress, cancel, retry. Finished
 * uploads leave the list and arrive through `onUploaded`; failed ones stay until dismissed.
 */
export function useAssetUploads(onUploaded: (asset: AssetView) => void) {
  const [items, setItems] = useState<UploadItem[]>([]);
  const controllers = useRef(new Map<number, AbortController>());
  const cancelledWhileQueued = useRef(new Set<number>());
  const lastKey = useRef(0);

  // Leaving the page stops what is still sending.
  useEffect(() => {
    const live = controllers.current;
    return () => {
      for (const controller of live.values()) controller.abort();
    };
  }, []);

  const patch = (key: number, change: Partial<UploadItem>) =>
    setItems((prev) => prev.map((item) => (item.key === key ? { ...item, ...change } : item)));
  const remove = (key: number) => setItems((prev) => prev.filter((item) => item.key !== key));

  const run = async (item: UploadItem) => {
    if (cancelledWhileQueued.current.delete(item.key)) return;
    const controller = new AbortController();
    controllers.current.set(item.key, controller);
    patch(item.key, { fraction: 0, error: null });
    try {
      const asset = await uploadAsset(
        item.file,
        item.type,
        (fraction) => patch(item.key, { fraction }),
        controller.signal,
      );
      remove(item.key);
      onUploaded(asset);
    } catch (err) {
      if (isAbort(err)) remove(item.key);
      else
        patch(item.key, {
          error: err instanceof AssetUploadError ? { code: err.code, limit: err.limit } : { code: 'failed' },
        });
    } finally {
      controllers.current.delete(item.key);
    }
  };

  const start = (files: File[], type: AssetType) => {
    const fresh: UploadItem[] = files.map((file) => ({ key: ++lastKey.current, file, type, fraction: 0, error: null }));
    setItems((prev) => [...prev, ...fresh]);
    const queue = [...fresh];
    const worker = async () => {
      for (let next = queue.shift(); next; next = queue.shift()) await run(next);
    };
    void Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker));
  };

  const cancel = (key: number) => {
    const controller = controllers.current.get(key);
    if (controller) controller.abort();
    else {
      cancelledWhileQueued.current.add(key);
      remove(key);
    }
  };

  return { items, start, cancel, dismiss: remove, retry: (item: UploadItem) => void run(item) };
}
