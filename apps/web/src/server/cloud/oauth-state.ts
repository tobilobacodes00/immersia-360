import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { isCloudProvider, type CloudProviderId } from './types';

/**
 * The OAuth `state` parameter: a signed, expiring token naming who started the connection (user and
 * organization) and for which provider. The callback accepts a code only with a state that verifies
 * AND matches the signed-in operator, so a link crafted by someone else — a login-CSRF that would
 * attach the attacker's cloud account to the victim's organization — is refused.
 *
 * Pure: the secret is passed in (BETTER_AUTH_SECRET, via a derived key) so it is unit-testable.
 */
export interface OAuthState {
  /** Organization id. */
  org: string;
  /** User id. */
  user: string;
  provider: CloudProviderId;
  /** Expiry, ms since the epoch. */
  exp: number;
  /** Random, so two states for the same operator are never equal. */
  n: string;
}

export const STATE_TTL_MS = 10 * 60_000;

/** A key of its own, derived from the app secret, so the secret itself never signs anything directly. */
const signingKey = (secret: string) =>
  createHmac('sha256', secret).update('immersia/integration-oauth-state/v1').digest();

const sign = (body: string, secret: string) => createHmac('sha256', signingKey(secret)).update(body).digest();

export function signOAuthState(
  claims: Pick<OAuthState, 'org' | 'user' | 'provider'>,
  secret: string,
  now: number = Date.now(),
): string {
  const payload: OAuthState = { ...claims, exp: now + STATE_TTL_MS, n: randomBytes(9).toString('base64url') };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${sign(body, secret).toString('base64url')}`;
}

/** The claims of a genuine, unexpired state; null for anything else (tampered, expired, malformed). */
export function verifyOAuthState(token: string, secret: string, now: number = Date.now()): OAuthState | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [body, signature] = parts as [string, string];
  const given = Buffer.from(signature, 'base64url');
  const expected = sign(body, secret);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  let claims: unknown;
  try {
    claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (typeof claims !== 'object' || claims === null) return null;
  const c = claims as Record<string, unknown>;
  if (
    typeof c.org !== 'string' ||
    typeof c.user !== 'string' ||
    !isCloudProvider(c.provider) ||
    typeof c.exp !== 'number' ||
    typeof c.n !== 'string' ||
    c.exp <= now ||
    // A state minted with a longer life than we ever issue is not ours.
    c.exp > now + STATE_TTL_MS + 60_000
  )
    return null;
  return { org: c.org, user: c.user, provider: c.provider, exp: c.exp, n: c.n };
}
