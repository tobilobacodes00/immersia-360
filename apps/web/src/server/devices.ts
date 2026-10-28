import 'server-only';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { db, schema } from '@immersia/db';
import {
  DEVICE_AUTH_SCHEME,
  DEVICE_TOKEN_BYTES,
  uuidv7,
  type DeviceStatus,
  type RegisterDeviceInput,
} from '@immersia/shared';
import { track } from './analytics';
import type { Operator } from './session';

const { device } = schema;

export type DeviceRow = typeof device.$inferSelect;

function toBase64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url');
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Buffer.from(digest).toString('hex');
}

/**
 * ACC-2: register the current browser as a booth device. The token is returned once and only its
 * SHA-256 is stored; a 256-bit random token needs no slow hash (there is nothing to brute-force).
 */
export async function registerDevice(op: Operator, input: RegisterDeviceInput): Promise<{ id: string; token: string }> {
  const token = toBase64Url(crypto.getRandomValues(new Uint8Array(DEVICE_TOKEN_BYTES)));
  const id = uuidv7();
  await db()
    .insert(device)
    .values({
      id,
      organizationId: op.organizationId,
      name: input.name,
      platform: input.platform,
      browser: input.browser,
      capabilities: input.capabilities,
      tokenHash: await sha256(token),
      registeredBy: op.userId,
      lastSeenAt: new Date(),
    });
  // Devices per operator (success metric). The labels are bounded to what the catalogue accepts.
  track(
    {
      name: 'device_registered',
      platform: input.platform.trim().slice(0, 40) || 'Unknown',
      browser: input.browser.trim().slice(0, 40) || 'Unknown',
    },
    { organizationId: op.organizationId, deviceId: id },
  );
  return { id, token };
}

export async function listDevices(organizationId: string): Promise<DeviceRow[]> {
  return db()
    .select()
    .from(device)
    .where(eq(device.organizationId, organizationId))
    .orderBy(asc(device.revokedAt), asc(device.createdAt));
}

export async function renameDevice(organizationId: string, id: string, name: string): Promise<boolean> {
  const rows = await db()
    .update(device)
    .set({ name })
    .where(and(eq(device.id, id), eq(device.organizationId, organizationId)))
    .returning({ id: device.id });
  return rows.length > 0;
}

/** Revocation is immediate: the next request with that token is refused. */
export async function revokeDevice(organizationId: string, id: string): Promise<boolean> {
  const rows = await db()
    .update(device)
    .set({ revokedAt: new Date() })
    .where(and(eq(device.id, id), eq(device.organizationId, organizationId), isNull(device.revokedAt)))
    .returning({ id: device.id });
  return rows.length > 0;
}

/** Resolve `Authorization: Device <token>` to an active device, or null. */
export async function authenticateDevice(request: Request): Promise<DeviceRow | null> {
  const header = request.headers.get('authorization') ?? '';
  const [scheme, token] = header.split(' ');
  if (scheme !== DEVICE_AUTH_SCHEME || !token || token.length > 128) return null;
  const [row] = await db()
    .select()
    .from(device)
    .where(and(eq(device.tokenHash, await sha256(token)), isNull(device.revokedAt)))
    .limit(1);
  return row ?? null;
}

export async function recordHeartbeat(id: string, status: DeviceStatus): Promise<void> {
  await db().update(device).set({ lastSeenAt: new Date(), status }).where(eq(device.id, id));
}
