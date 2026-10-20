import 'server-only';
import { parseKey } from '../crypto-box';
import { appOrigin, env } from '../env';
import { dropbox, googleDrive, type CloudProvider, type CloudProviderId } from './providers';

/**
 * Which cloud providers this server can talk to, from the environment. A provider needs both the
 * token key (refresh tokens are encrypted at rest; without a key there is nowhere safe to keep
 * them) and its own OAuth credentials. Anything less shows as "not configured" in Integrations.
 */

/** The AES-256-GCM key for refresh tokens, or null when INTEGRATION_TOKEN_KEY is not set. */
export function integrationKey(): Buffer | null {
  const raw = env().INTEGRATION_TOKEN_KEY;
  return raw ? parseKey(raw) : null;
}

function credentials(id: CloudProviderId): { a: string; b: string } | null {
  const e = env();
  if (id === 'drive') {
    // The sign-in Google client works for Drive too once the Drive redirect URI is registered on it.
    const a = e.GOOGLE_DRIVE_CLIENT_ID ?? e.GOOGLE_CLIENT_ID;
    const b = e.GOOGLE_DRIVE_CLIENT_SECRET ?? e.GOOGLE_CLIENT_SECRET;
    return a && b ? { a, b } : null;
  }
  return e.DROPBOX_APP_KEY && e.DROPBOX_APP_SECRET ? { a: e.DROPBOX_APP_KEY, b: e.DROPBOX_APP_SECRET } : null;
}

export type Availability = 'available' | 'no_key' | 'no_credentials';

export function availability(id: CloudProviderId): Availability {
  if (!env().INTEGRATION_TOKEN_KEY) return 'no_key';
  return credentials(id) ? 'available' : 'no_credentials';
}

const providers = new Map<CloudProviderId, CloudProvider>();

/** The configured provider, or null when this server is not set up for it. */
export function cloudProvider(id: CloudProviderId): CloudProvider | null {
  if (availability(id) !== 'available') return null;
  let provider = providers.get(id);
  if (!provider) {
    const c = credentials(id)!;
    provider =
      id === 'drive' ? googleDrive({ clientId: c.a, clientSecret: c.b }) : dropbox({ appKey: c.a, appSecret: c.b });
    providers.set(id, provider);
  }
  return provider;
}

/** Where the provider sends the operator back to; registered with the provider's OAuth app. */
export const redirectUri = (id: CloudProviderId) => `${appOrigin()}/api/integrations/${id}/callback`;

/** What signs the OAuth state. */
export const stateSecret = () => env().BETTER_AUTH_SECRET;
