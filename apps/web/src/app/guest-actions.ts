'use server';

import type { Route } from 'next';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import {
  guestFormCookie,
  isLinkId,
  parseRoute,
  type GuestFormChoice,
  type GuestFormField,
  type GuestFormFieldError,
  type GuestFormScope,
} from '@immersia/shared';
import { track } from '@/server/analytics';
import { eraseSession } from '@/server/erasure';
import { galleryCookie, galleryEvent, validGalleryPass } from '@/server/gallery';
import { formTarget, guestConsent, submitGuestContact, type FormTarget, type GuestConsent } from '@/server/guest-form';
import { allow, clientIp } from '@/server/rate-limit';

/**
 * The guest-facing server actions: the optional data form (SHR-6) and "delete my photos".
 * They are plain `<form action>` targets, so they work without client JavaScript; the client
 * components only add inline error messages. Holding the session's link is the authority for both
 * (the link is a 128-bit secret), and both are rate-limited.
 */

export interface GuestFormState {
  error: null | 'fields' | 'stale' | 'tooMany' | 'failed';
  fields?: Partial<Record<GuestFormField, GuestFormFieldError>>;
  /** What the guest typed, so a rejected form is not emptied. */
  values?: { name: string; email: string };
  /** Fresh consent text after the wording changed (error 'stale'), so the guest sees the new one. */
  consent?: Pick<GuestConsent, 'text' | 'policyUrl' | 'fingerprint'>;
}

const text = (data: FormData, key: string, max: number) => {
  const v = data.get(key);
  return typeof v === 'string' ? v.slice(0, max) : '';
};

const NINETY_DAYS_S = 90 * 24 * 3600;

/**
 * Remember that this browser has dealt with the form, so it does not ask again. A first-party,
 * httpOnly cookie scoped to the share pages and to this event's gallery only; it carries no
 * identity and nothing depends on it (downloads never check it).
 */
async function rememberChoice(target: FormTarget, choice: GuestFormChoice) {
  const proto = (await headers()).get('x-forwarded-proto') ?? 'http';
  const jar = await cookies();
  const base = { httpOnly: true, sameSite: 'lax' as const, secure: proto === 'https', maxAge: NINETY_DAYS_S };
  const name = guestFormCookie(target.eventId);
  jar.set(name, choice, { ...base, path: '/s' });
  jar.set(name, choice, { ...base, path: `/g/${target.gallerySlug}` });
}

function backTo(scope: GuestFormScope, ref: string, route: string, extra?: Record<string, string>): Route {
  const q = new URLSearchParams(extra);
  const r = parseRoute(route);
  if (r !== 'direct') q.set('r', r);
  const qs = q.toString();
  return `${scope === 'gallery' ? '/g' : '/s'}/${ref}${qs ? `?${qs}` : ''}` as Route;
}

/** Resolve the form's target, or null when the link/slug is malformed or unknown. */
async function resolveTarget(scope: GuestFormScope, ref: string) {
  if (scope === 'session' ? !isLinkId(ref) : !/^[A-Za-z0-9_-]{8,40}$/.test(ref)) return null;
  const found = await formTarget(scope, ref);
  return found.ok ? found.target : null;
}

/** A password-protected gallery's form is only for people who got in. */
async function galleryOpen(slug: string): Promise<boolean> {
  const ev = await galleryEvent(slug);
  if (!ev) return false;
  if (!ev.passwordHash) return true;
  return validGalleryPass(slug, ev.passwordHash, (await cookies()).get(galleryCookie(slug))?.value);
}

export async function submitGuestFormAction(_prev: GuestFormState, formData: FormData): Promise<GuestFormState> {
  const scope: GuestFormScope = formData.get('scope') === 'gallery' ? 'gallery' : 'session';
  const ref = text(formData, 'ref', 64);
  const route = text(formData, 'r', 20);
  const values = { name: text(formData, 'name', 300), email: text(formData, 'email', 400) };

  if (!(await allow('guestFormPerIp', await clientIp()))) return { error: 'tooMany', values };
  const target = await resolveTarget(scope, ref);
  // The link is gone, expired or erased (or unknown): the page says so.
  if (!target) redirect(backTo(scope, ref, route));
  if (scope === 'gallery' && !(await galleryOpen(ref))) return { error: 'failed', values };
  if (
    !(await allow('guestFormPerTarget', target.sessionId ?? target.eventId)) ||
    !(await allow('guestFormPerEvent', target.eventId))
  )
    return { error: 'tooMany', values };

  const result = await submitGuestContact(target, {
    ...values,
    consent: formData.get('consent') === 'on',
    fingerprint: text(formData, 'fp', 64),
  });
  if (!result.ok) {
    // The form was switched off meanwhile: nothing to fill in any more.
    if (result.error === 'closed') redirect(backTo(scope, ref, route));
    if (result.error === 'fields') return { error: 'fields', fields: result.fields, values };
    if (result.error === 'too_many') return { error: 'tooMany', values };
    const fresh = await guestConsent(target);
    return {
      error: 'stale',
      values,
      consent: { text: fresh.text, policyUrl: fresh.policyUrl, fingerprint: fresh.fingerprint },
    };
  }
  await rememberChoice(target, 'submitted');
  track({ name: 'guest_form_submitted', scope }, { eventId: target.eventId, organizationId: target.organizationId });
  redirect(backTo(scope, ref, route, scope === 'session' ? { f: 'sent' } : undefined));
}

/** "Skip: just my files". Stores nothing but the cookie that stops the form from asking again. */
export async function skipGuestFormAction(formData: FormData): Promise<void> {
  const scope: GuestFormScope = formData.get('scope') === 'gallery' ? 'gallery' : 'session';
  const ref = text(formData, 'ref', 64);
  const route = text(formData, 'r', 20);
  const target = await resolveTarget(scope, ref);
  if (target) {
    await rememberChoice(target, 'skipped');
    track({ name: 'guest_form_skipped', scope }, { eventId: target.eventId, organizationId: target.organizationId });
  }
  redirect(backTo(scope, ref, route));
}

export interface EraseState {
  error: null | 'tooMany' | 'failed';
}

/**
 * "Delete my photos and videos": whoever holds the link may erase the session (GDPR Art. 17). Idempotent:
 * asking again, or for a link that is already gone, just lands on the "deleted" page.
 */
export async function eraseSessionAction(_prev: EraseState, formData: FormData): Promise<EraseState> {
  const linkId = text(formData, 'linkId', 40);
  if (!isLinkId(linkId)) return { error: 'failed' };
  if (!(await allow('eraseSessionPerIp', await clientIp())) || !(await allow('eraseSessionPerLink', linkId)))
    return { error: 'tooMany' };
  try {
    await eraseSession({ linkId }, { by: 'guest' });
  } catch (err) {
    console.error('[erasure] failed', err instanceof Error ? err.message : err);
    return { error: 'failed' };
  }
  redirect(`/s/${linkId}` as Route);
}
