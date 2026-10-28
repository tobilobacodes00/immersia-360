import 'server-only';
import { NextResponse } from 'next/server';
import type { ServerRenderRefusal } from '@immersia/shared';
import { StorageUnavailableError } from './storage';

/** Ids in routes are UUIDs; anything else is refused before it reaches a query. */
export const isUuid = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

const STATUS: Record<ServerRenderRefusal['error'], number> = {
  render_rate_limited: 429,
  server_render_unavailable: 503,
  take_not_registered: 404,
  session_not_found: 404,
  session_gone: 410,
  files_incomplete: 409,
  asset_invalid: 422,
  invalid: 400,
};

/** A refusal as the booth reads it: a stable code, the HTTP status that says whether to retry, a Retry-After for limits. */
export function refusal(r: ServerRenderRefusal): NextResponse {
  const headers: Record<string, string> = {};
  if (r.error === 'render_rate_limited' && r.retryAfterS > 0) headers['retry-after'] = String(r.retryAfterS);
  return NextResponse.json(r, { status: STATUS[r.error], headers });
}

/** Run a route body, turning a missing storage configuration into the 503 the booth already understands. */
export async function withStorage(body: () => Promise<NextResponse>): Promise<NextResponse> {
  try {
    return await body();
  } catch (err) {
    if (err instanceof StorageUnavailableError)
      return NextResponse.json({ error: 'storage_unavailable' }, { status: 503 });
    throw err;
  }
}
