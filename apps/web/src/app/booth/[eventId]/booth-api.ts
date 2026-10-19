import { BoothApiError, type BoothApi } from '@immersia/offline';
import type { RegisterSessionResult, UploadTicket } from '@immersia/shared';

/** Server answers worth retrying: overloaded, rate-limited, timed out, or a 5xx. */
const retryable = (status: number) => status === 408 || status === 429 || status >= 500;

/**
 * The booth's calls to the server, authenticated with the device token. Network failures surface
 * as plain errors (the queue retries those); HTTP errors as BoothApiError with a retry verdict.
 */
export function createBoothApi(token: string): BoothApi & {
  reserveCodes(eventId: string, count: number): Promise<string[]>;
} {
  const call = async <T>(path: string, body: unknown): Promise<T> => {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Device ${token}` },
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => ({}))) as T & { error?: string };
    if (!res.ok) throw new BoothApiError(res.status, json.error ?? `http_${res.status}`, retryable(res.status));
    return json;
  };

  return {
    async reserveCodes(eventId, count) {
      return (await call<{ codes: string[] }>('/api/booth/codes', { eventId, count })).codes;
    },

    registerSession(input) {
      return call<RegisterSessionResult>('/api/booth/sessions', input);
    },

    async put(ticket: UploadTicket, body: Blob) {
      const res = await fetch(ticket.url, { method: ticket.method, headers: ticket.headers, body });
      if (res.ok) return;
      // 403 is an expired or mismatched signature: a fresh registration brings a new ticket.
      throw new BoothApiError(res.status, `storage_${res.status}`, res.status === 403 || retryable(res.status));
    },

    async complete(outputId) {
      try {
        return (await call<{ result: 'ok' }>(`/api/booth/outputs/${outputId}/complete`, {})).result;
      } catch (err) {
        // 409 (stored object missing or the wrong size) and 404 are answers, not failures: the
        // queue decides (re-upload after a backoff).
        if (err instanceof BoothApiError && err.status === 409) return 'incomplete';
        if (err instanceof BoothApiError && err.status === 404) return 'not_found';
        throw err;
      }
    },

    async sendEmail(sessionId, to) {
      try {
        await call(`/api/booth/sessions/${sessionId}/email`, { email: to });
      } catch (err) {
        // Over the per-session or per-device cap: drop this address rather than retry for hours.
        if (err instanceof BoothApiError && err.status === 429) return;
        throw err;
      }
    },
  };
}
