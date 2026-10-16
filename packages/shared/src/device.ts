/**
 * Booth devices (ACC-2): unlimited per account, each named ("Booth A iPad") and revocable. A device
 * authenticates booth traffic with its own long-lived token (`Authorization: Device <token>`), so a
 * kiosk keeps uploading for an entire event even if the operator's browser session ends, and
 * revoking it cuts it off immediately.
 */
import { z } from 'zod';
import { deviceCapabilitiesSchema } from './event';

export const DEVICE_TOKEN_BYTES = 32;
export const DEVICE_AUTH_SCHEME = 'Device';

export const registerDeviceSchema = z.object({
  name: z.string().trim().min(1).max(60),
  platform: z.string().max(60),
  browser: z.string().max(60),
  capabilities: deviceCapabilitiesSchema,
});
export type RegisterDeviceInput = z.infer<typeof registerDeviceSchema>;

export const deviceStatusSchema = z.object({
  eventId: z.uuid().nullable(),
  renderQueue: z.number().int().min(0).max(10_000),
  uploadQueue: z.number().int().min(0).max(100_000),
  freeStorageBytes: z.number().int().min(0).nullable(),
  appVersion: z.string().max(40),
  at: z.iso.datetime(),
});
export type DeviceStatus = z.infer<typeof deviceStatusSchema>;

/** Rough platform/browser labels from a user agent, for the device list only (never for logic). */
export function describeUserAgent(ua: string): { platform: string; browser: string } {
  const platform = /iPad/.test(ua)
    ? 'iPad'
    : /iPhone/.test(ua)
      ? 'iPhone'
      : /Android/.test(ua)
        ? 'Android'
        : /CrOS/.test(ua)
          ? 'ChromeOS'
          : /Mac OS X|Macintosh/.test(ua)
            ? 'macOS'
            : /Windows/.test(ua)
              ? 'Windows'
              : /Linux/.test(ua)
                ? 'Linux'
                : 'Unknown';
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /Firefox\//.test(ua)
      ? 'Firefox'
      : /Chrome\/|CriOS\//.test(ua)
        ? 'Chrome'
        : /Safari\//.test(ua)
          ? 'Safari'
          : 'Browser';
  return { platform, browser };
}
