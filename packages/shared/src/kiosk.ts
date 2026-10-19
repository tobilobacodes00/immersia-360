/**
 * Kiosk PIN (KIO-1). The PIN keeps guests in the booth screen; it is a lock against curious hands,
 * not an account credential. The server stores only this hash, the booth receives it with the event
 * and checks a typed PIN locally, so exiting kiosk mode works with no network. The event id salts
 * the hash, so the same PIN on two events doesn't produce the same value.
 */
export const KIOSK_PIN = /^\d{4,8}$/;

export async function kioskPinHash(eventId: string, pin: string): Promise<string> {
  const bytes = new TextEncoder().encode(`immersia-kiosk:${eventId}:${pin}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Constant-time comparison of two hex digests. */
export function sameDigest(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function checkKioskPin(eventId: string, pin: string, hash: string): Promise<boolean> {
  return KIOSK_PIN.test(pin) && sameDigest(await kioskPinHash(eventId, pin), hash);
}
