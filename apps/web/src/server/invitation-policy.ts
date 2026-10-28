import 'server-only';
import { headers } from 'next/headers';
import { APIError } from 'better-auth/api';
import type { Locale } from '@immersia/i18n';
import { localeFromRequest } from './email';
import { allow, hasBudget } from './rate-limit';

/**
 * Abuse limits and request context for invitation emails (ACC-3). Called from the Better Auth
 * organization hooks in `auth.ts`, so they hold for the invite form, a re-send, and a hand-made
 * request to the auth API alike. The hooks run in the inviter's request: their headers carry the
 * language the email is written in and the address the limit is keyed on.
 */

/** Headers of the request that caused this invitation, wherever it came through. */
async function inviterHeaders(request?: Request): Promise<Headers | undefined> {
  if (request) return request.headers;
  try {
    return await headers();
  } catch {
    // Outside a request (a script, a test): English, no address.
    return undefined;
  }
}

export async function inviterLocale(request?: Request): Promise<Locale> {
  return localeFromRequest(await inviterHeaders(request));
}

async function inviterIp(request?: Request): Promise<string> {
  const h = await inviterHeaders(request);
  return h?.get('x-real-ip') ?? h?.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
}

const tooMany = () =>
  new APIError('TOO_MANY_REQUESTS', {
    code: 'INVITATION_RATE_LIMITED',
    message: 'Too many invitations. Please wait a while before sending more.',
  });

async function buckets(inviterId: string, email: string, request?: Request) {
  return [
    ['inviteSendPerUser', inviterId],
    ['inviteSendPerRecipient', email.trim().toLowerCase()],
    ['inviteSendPerIp', await inviterIp(request)],
  ] as const;
}

/** Refuse before anything is created when a limit is already used up. Spends nothing. */
export async function assertInviteBudget(inviterId: string, email: string, request?: Request): Promise<void> {
  for (const [name, key] of await buckets(inviterId, email, request)) {
    if (!(await hasBudget(name, key))) throw tooMany();
  }
}

/** One email is about to go out: count it. */
export async function spendInviteBudget(inviterId: string, email: string, request?: Request): Promise<void> {
  for (const [name, key] of await buckets(inviterId, email, request)) {
    if (!(await allow(name, key))) throw tooMany();
  }
}
