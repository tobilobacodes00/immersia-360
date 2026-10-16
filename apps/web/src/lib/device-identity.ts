/**
 * This browser's booth-device identity (id + token), kept in localStorage. The token is the device's
 * credential for booth traffic; revoking the device on the server makes it useless. Reads and
 * writes are wrapped because storage can be unavailable (private mode, blocked site data).
 */
const KEY = 'immersia.device.v1';

export interface DeviceIdentity {
  id: string;
  token: string;
  name: string;
}

export function readDeviceIdentity(): DeviceIdentity | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<DeviceIdentity>;
    return v.id && v.token && v.name ? { id: v.id, token: v.token, name: v.name } : null;
  } catch {
    return null;
  }
}

export function writeDeviceIdentity(identity: DeviceIdentity): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(identity));
    return true;
  } catch {
    return false;
  }
}

export function clearDeviceIdentity(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing to clear when storage is unavailable.
  }
}
