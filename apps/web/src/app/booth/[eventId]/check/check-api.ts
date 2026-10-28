import type { SetupCheckReport } from '@immersia/shared';

export type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number; code: string };

/** A call to the device-authenticated check routes. Network failures come back as status 0, never throw. */
async function call<T>(token: string, path: string, body: unknown): Promise<ApiResult<T>> {
  try {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Device ${token}` },
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => ({}))) as T & { error?: string };
    if (!res.ok) return { ok: false, status: res.status, code: json.error ?? `http_${res.status}` };
    return { ok: true, data: json };
  } catch {
    return { ok: false, status: 0, code: 'network' };
  }
}

export const checkApi = (token: string) => ({
  startQr: () =>
    call<{ token: string; nonce: string; expiresAt: number }>(token, '/api/devices/check/qr', { action: 'start' }),
  pollQr: (nonce: string) => call<{ scanned: boolean }>(token, '/api/devices/check/qr', { action: 'poll', nonce }),
  startUpload: () =>
    call<{
      id: string;
      bytes: number;
      ticket: { url: string; method: 'PUT'; headers: Record<string, string> };
    }>(token, '/api/devices/check/upload', { action: 'start' }),
  finishUpload: (id: string) =>
    call<{ result: 'ok' | 'missing' | 'wrong_size' }>(token, '/api/devices/check/upload', { action: 'finish', id }),
  report: (report: SetupCheckReport) => call<{ ok: true }>(token, '/api/devices/check', report),
});

export type CheckApi = ReturnType<typeof checkApi>;
