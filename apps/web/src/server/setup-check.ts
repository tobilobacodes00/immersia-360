import 'server-only';
import { randomBytes } from 'node:crypto';
import { and, eq, gt, sql } from 'drizzle-orm';
import { db, schema } from '@immersia/db';
import { SETUP_CHECK_QR_TTL_S, type DeviceCapabilities, type SetupCheckReport } from '@immersia/shared';
import type { DeviceRow } from './devices';
import { env } from './env';
import { mintQrToken, verifyQrToken } from './setup-check-token';
import { deleteObjects, objectSize, presignUpload } from './storage';
import { insertRows, toRow } from './analytics';

/**
 * Server side of the setup check (HLP-1, screen 9): the test QR, the upload test and the saved
 * result. Every call is authenticated as the booth device doing the check, except a phone opening
 * the QR, which proves itself with the signed token in the URL.
 */

const { analyticsEvent, device, event } = schema;

// -----------------------------------------------------------------------------------------------
// Test QR

/** A fresh test QR for this device. The token goes in the URL; the nonce is what the booth polls for. */
export function startQr(deviceId: string) {
  return mintQrToken(env().BETTER_AUTH_SECRET, deviceId, SETUP_CHECK_QR_TTL_S);
}

/**
 * A phone opened the QR. The scan is kept as an analytics row (the existing, indexed place for small
 * first-party facts) rather than a new table; the booth finds it by device and nonce. Idempotent: a
 * phone that loads the page twice, or a link preview, is one scan.
 */
export async function recordQrScan(token: string): Promise<'scanned' | 'expired' | 'invalid'> {
  const checked = verifyQrToken(env().BETTER_AUTH_SECRET, token);
  if (!checked.ok) return checked.reason;
  const [dev] = await db()
    .select({ organizationId: device.organizationId, revokedAt: device.revokedAt })
    .from(device)
    .where(eq(device.id, checked.deviceId))
    .limit(1);
  if (!dev || dev.revokedAt) return 'invalid';
  if (await qrScanned(checked.deviceId, checked.nonce)) return 'scanned';
  // Through the shared catalogue like every other analytics row (validated, no guest detail). Not
  // `track()`: that one swallows a failed insert, and a scan the booth never learns of would leave it
  // waiting, so a failure here must reach the phone as an error rather than a false "Scanned".
  const row = toRow(
    { name: 'setup_qr_scanned', nonce: checked.nonce },
    { organizationId: dev.organizationId, deviceId: checked.deviceId },
  );
  if (!row) return 'invalid';
  await insertRows([row]);
  return 'scanned';
}

/** Has a phone opened the QR with this nonce? Looks back only as far as a QR can live. */
export async function qrScanned(deviceId: string, nonce: string): Promise<boolean> {
  const since = new Date(Date.now() - (SETUP_CHECK_QR_TTL_S + 60) * 1000);
  const rows = await db()
    .select({ id: analyticsEvent.id })
    .from(analyticsEvent)
    .where(
      and(
        eq(analyticsEvent.name, 'setup_qr_scanned'),
        eq(analyticsEvent.deviceId, deviceId),
        gt(analyticsEvent.occurredAt, since),
        sql`${analyticsEvent.props} ->> 'nonce' = ${nonce}`,
      ),
    )
    .limit(1);
  return rows.length > 0;
}

// -----------------------------------------------------------------------------------------------
// Upload test

/** Big enough to measure a connection rather than one round trip, small enough to finish in seconds. */
export const UPLOAD_TEST_BYTES = 1024 * 1024;

const testKey = (d: DeviceRow, id: string) => `o/${d.organizationId}/check/${d.id}/${id}`;
const TEST_ID = /^[A-Za-z0-9_-]{16}$/;

/** A presigned PUT for the test object. Throws StorageUnavailableError when storage isn't configured. */
export async function startUploadTest(d: DeviceRow) {
  const id = randomBytes(12).toString('base64url');
  const ticket = await presignUpload(testKey(d, id), 'application/octet-stream', UPLOAD_TEST_BYTES, 600);
  return { id, bytes: UPLOAD_TEST_BYTES, ticket };
}

/** Check the stored object is the size that was signed, then delete it either way. */
export async function finishUploadTest(d: DeviceRow, id: string): Promise<'ok' | 'missing' | 'wrong_size'> {
  if (!TEST_ID.test(id)) return 'missing';
  const key = testKey(d, id);
  const size = await objectSize(key);
  if (size !== null) await deleteObjects([key]);
  if (size === null) return 'missing';
  return size === UPLOAD_TEST_BYTES ? 'ok' : 'wrong_size';
}

// -----------------------------------------------------------------------------------------------
// Result

/**
 * Keep the check on the device record: the Devices screen shows the render path, and support can see
 * how the last check went. The PRD's `setup_check_completed` event is not recorded here: the booth
 * emits it itself (see the results screen), through its offline outbox, as the catalogue says.
 */
export async function saveSetupCheck(d: DeviceRow, report: SetupCheckReport): Promise<void> {
  const [known] = report.eventId
    ? await db()
        .select({ id: event.id })
        .from(event)
        .where(and(eq(event.id, report.eventId), eq(event.organizationId, d.organizationId)))
        .limit(1)
    : [];
  const eventId = known?.id ?? null;
  const at = new Date().toISOString();
  const next: DeviceCapabilities = {
    ...d.capabilities,
    maxCameraResolution: report.cameraResolution ?? d.capabilities.maxCameraResolution,
    maxCameraFps: report.cameraFps > 0 ? Math.round(report.cameraFps) : d.capabilities.maxCameraFps,
    renderPath: report.renderPath,
    renderSpeedMs: report.renderSpeedMs ?? d.capabilities.renderSpeedMs,
    checkedAt: at,
    setupCheck: { at, eventId, results: report.results },
  };
  await db().update(device).set({ capabilities: next }).where(eq(device.id, d.id));
}
