import 'server-only';
import { normalizeShortCode } from '@immersia/shared';
import { allow, clientIp, hasBudget } from './rate-limit';
import { linkIdForCode } from './share';

export type CodeError = 'invalid' | 'not_found' | 'expired' | 'too_many';

/**
 * DL-2/DL-14: a typed short code → its session link. Rate-limited per IP (all lookups), per IP on
 * misses (an IP that keeps guessing is cut off well before it can enumerate 887M codes) and per
 * event (a burst against one event is throttled without affecting others).
 */
export async function resolveCode(input: string): Promise<{ linkId: string } | { error: CodeError }> {
  const code = normalizeShortCode(input);
  if (!code) return { error: 'invalid' };
  const ip = await clientIp();
  if (!(await hasBudget('codeMissPerIp', ip)) || !(await allow('codeLookupPerIp', ip))) return { error: 'too_many' };
  const hit = await linkIdForCode(code);
  if (!hit) {
    await allow('codeMissPerIp', ip);
    return { error: 'not_found' };
  }
  if (!(await allow('codeLookupPerEvent', hit.eventId))) return { error: 'too_many' };
  return hit.expired ? { error: 'expired' } : { linkId: hit.linkId };
}
