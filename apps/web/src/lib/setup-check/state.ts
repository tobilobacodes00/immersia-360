/**
 * What this browser remembers about the setup check, per device (HLP-1): the first time a device
 * opens a booth it is offered the check; running it or skipping it is remembered, so the offer is
 * made once. Storage can be unavailable (private mode), so every access is guarded, and a browser
 * that can't remember simply offers again.
 */
export const SETUP_CHECK_KEY = 'immersia.setupcheck.v1';
/** Fired on this window when the state changes (the `storage` event only reaches other tabs). */
export const SETUP_CHECK_EVENT = 'immersia:setupcheck';

export interface DeviceCheckState {
  doneAt?: number;
  skippedAt?: number;
}

type Store = Record<string, DeviceCheckState>;

type Reader = Pick<Storage, 'getItem'>;
type Writer = Pick<Storage, 'getItem' | 'setItem'>;

function parse(raw: string | null): Store {
  if (!raw) return {};
  try {
    const v: unknown = JSON.parse(raw);
    if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
    const out: Store = {};
    for (const [id, s] of Object.entries(v)) {
      if (!s || typeof s !== 'object') continue;
      const { doneAt, skippedAt } = s as DeviceCheckState;
      out[id] = {
        ...(typeof doneAt === 'number' ? { doneAt } : {}),
        ...(typeof skippedAt === 'number' ? { skippedAt } : {}),
      };
    }
    return out;
  } catch {
    return {};
  }
}

export function readCheckState(storage: Reader, deviceId: string): DeviceCheckState {
  try {
    return parse(storage.getItem(SETUP_CHECK_KEY))[deviceId] ?? {};
  } catch {
    return {};
  }
}

/** The first-run offer is due until the check has been run or skipped on this device. */
export const checkIsDue = (s: DeviceCheckState) => s.doneAt === undefined && s.skippedAt === undefined;

function write(storage: Writer, deviceId: string, patch: DeviceCheckState): boolean {
  try {
    const store = parse(storage.getItem(SETUP_CHECK_KEY));
    store[deviceId] = { ...store[deviceId], ...patch };
    storage.setItem(SETUP_CHECK_KEY, JSON.stringify(store));
    return true;
  } catch {
    return false;
  }
}

export const markCheckDone = (storage: Writer, deviceId: string, at: number) =>
  write(storage, deviceId, { doneAt: at });
export const markCheckSkipped = (storage: Writer, deviceId: string, at: number) =>
  write(storage, deviceId, { skippedAt: at });
