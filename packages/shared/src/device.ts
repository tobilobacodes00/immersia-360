/**
 * Booth devices (ACC-2): unlimited per account, each named ("Booth A iPad") and revocable. A device
 * authenticates booth traffic with its own long-lived token (`Authorization: Device <token>`), so a
 * kiosk keeps uploading for an entire event even if the operator's browser session ends, and
 * revoking it cuts it off immediately.
 */
import { z } from 'zod';
import { SETUP_CHECK_STATUSES, SETUP_CHECK_STEPS, deviceCapabilitiesSchema } from './event';

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

/**
 * HLP-1: what the setup check sends when it finishes. `renderSpeedMs` is the measured speed
 * extrapolated to the PRD's reference clip (15 s of 1080p), so devices compare on one scale.
 */
export const setupCheckReportSchema = z.object({
  eventId: z.uuid().nullable(),
  renderSpeedMs: z.number().int().min(0).max(86_400_000).nullable(),
  cameraFps: z.number().min(0).max(1000),
  /** What the camera delivered, e.g. "1920x1080". */
  cameraResolution: z
    .string()
    .regex(/^\d{2,5}x\d{2,5}$/)
    .nullable(),
  renderPath: z.enum(['local', 'wasm', 'server']),
  browser: z.string().max(60),
  results: z.array(z.object({ step: z.enum(SETUP_CHECK_STEPS), status: z.enum(SETUP_CHECK_STATUSES) })).max(10),
});
export type SetupCheckReport = z.infer<typeof setupCheckReportSchema>;

/** The test QR is short-lived: an abandoned check leaves nothing behind. */
export const SETUP_CHECK_QR_TTL_S = 10 * 60;

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
