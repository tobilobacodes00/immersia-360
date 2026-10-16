/**
 * Device storage health (Risks: "Browser evicts local storage mid-event"). Persistence is requested
 * at booth start; iOS/WebKit may still decline (heuristics), so we also watch free space and warn
 * below the PRD's 2 GB line.
 */
export const LOW_STORAGE_BYTES = 2 * 1024 ** 3;

export interface StorageHealth {
  persisted: boolean;
  quota: number | null;
  usage: number | null;
  free: number | null;
  low: boolean;
}

export async function requestPersistence(): Promise<boolean> {
  try {
    if (await navigator.storage?.persisted?.()) return true;
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}

export async function storageHealth(): Promise<StorageHealth> {
  let persisted = false;
  let quota: number | null = null;
  let usage: number | null = null;
  try {
    persisted = (await navigator.storage?.persisted?.()) ?? false;
    const est = await navigator.storage?.estimate?.();
    quota = est?.quota ?? null;
    usage = est?.usage ?? null;
  } catch {
    // Unknown: report nulls, never throw from a health check.
  }
  const free = quota !== null && usage !== null ? Math.max(0, quota - usage) : null;
  return { persisted, quota, usage, free, low: free !== null && free < LOW_STORAGE_BYTES };
}
