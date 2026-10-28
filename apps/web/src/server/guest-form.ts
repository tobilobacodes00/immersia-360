import 'server-only';
import { eq, sql } from 'drizzle-orm';
import { getLocale, getTranslations } from 'next-intl/server';
import { db, schema } from '@immersia/db';
import {
  buildConsentText,
  consentFingerprint,
  parseGuestContact,
  policyHref,
  shareSettingsSchema,
  uuidv7,
  type GuestFormField,
  type GuestFormFieldError,
  type GuestFormScope,
  type GuestFormSettings,
} from '@immersia/shared';
import { isExpired } from './share-state';

const { captureSession, event, organization, guestContact } = schema;

/**
 * The guest data form (SHR-6), server side. The form is optional and never gates a download
 * (GDPR Art. 7(4)): this module only decides whether a submission is valid and stores it with proof
 * of what the guest agreed to.
 */

/** The most contacts one session's link can collect (a forwarded link, friends each leaving theirs). */
export const CONTACTS_PER_SESSION = 10;

export interface FormTarget {
  scope: GuestFormScope;
  eventId: string;
  organizationId: string;
  /** The business running the event: the controller of what the form collects. */
  operator: string;
  eventName: string;
  gallerySlug: string;
  /** The session whose page the form is on; null on the event gallery. */
  sessionId: string | null;
  settings: GuestFormSettings;
}

export type TargetResult = { ok: true; target: FormTarget } | { ok: false; reason: 'not_found' | 'gone' };

/** The event behind a session link or a gallery slug, with its form settings. */
export async function formTarget(scope: GuestFormScope, ref: string): Promise<TargetResult> {
  const base = {
    eventId: event.id,
    organizationId: event.organizationId,
    eventName: event.name,
    gallerySlug: event.gallerySlug,
    share: event.shareSettings,
    operator: organization.name,
  };
  const parse = (share: unknown) => {
    const parsed = shareSettingsSchema.safeParse(share);
    return parsed.success ? parsed.data.guestForm : shareSettingsSchema.parse({}).guestForm;
  };
  if (scope === 'session') {
    const [row] = await db()
      .select({
        ...base,
        sessionId: captureSession.id,
        expiresAt: captureSession.expiresAt,
        expiredAt: captureSession.expiredAt,
        erasedAt: captureSession.erasedAt,
      })
      .from(captureSession)
      .innerJoin(event, eq(event.id, captureSession.eventId))
      .innerJoin(organization, eq(organization.id, event.organizationId))
      .where(eq(captureSession.linkId, ref))
      .limit(1);
    if (!row) return { ok: false, reason: 'not_found' };
    if (row.erasedAt || isExpired(row)) return { ok: false, reason: 'gone' };
    return { ok: true, target: { ...row, scope, settings: parse(row.share) } };
  }
  const [row] = await db()
    .select(base)
    .from(event)
    .innerJoin(organization, eq(organization.id, event.organizationId))
    .where(eq(event.gallerySlug, ref))
    .limit(1);
  if (!row) return { ok: false, reason: 'not_found' };
  return { ok: true, target: { ...row, scope, sessionId: null, settings: parse(row.share) } };
}

/** What the form shows next to the checkbox, and the fingerprint that proves a submission matches it. */
export interface GuestConsent {
  locale: string;
  /** The exact sentence: the platform's wording naming the operator and event, plus the operator's own. */
  text: string;
  /** The operator's privacy policy (https), or '' to point at Immersia 360's general notice. */
  policyUrl: string;
  fingerprint: string;
}

/** Built in the language of the current request, which is the one the form was rendered in. */
export async function guestConsent(
  target: Pick<FormTarget, 'operator' | 'eventName'> & { settings: GuestFormSettings },
): Promise<GuestConsent> {
  const [t, locale] = await Promise.all([getTranslations('share.form'), getLocale()]);
  const text = buildConsentText(
    t('consent', { operator: target.operator, event: target.eventName }),
    target.settings.consentText,
  );
  const policyUrl = policyHref(target.settings.policyUrl) ?? '';
  return { locale, text, policyUrl, fingerprint: await consentFingerprint({ locale, text, policyUrl }) };
}

export type SubmitResult =
  | { ok: true }
  | { ok: false; error: 'fields'; fields: Partial<Record<GuestFormField, GuestFormFieldError>> }
  | { ok: false; error: 'stale' | 'closed' | 'too_many' };

/**
 * Store a submission. The consent proof is recomputed here from the event's current settings and
 * must match what the form displayed (`fingerprint`): a guest never "agrees" to wording they did not
 * see. One row per person per session (or per person for the gallery); sending again updates it.
 */
export async function submitGuestContact(
  target: FormTarget,
  raw: { name: string; email: string; consent: boolean; fingerprint: string },
): Promise<SubmitResult> {
  if (!target.settings.enabled) return { ok: false, error: 'closed' };
  const consent = await guestConsent(target);
  if (raw.fingerprint !== consent.fingerprint) return { ok: false, error: 'stale' };
  const parsed = parseGuestContact(raw, { requireName: target.settings.requireName });
  if (!parsed.ok) return { ok: false, error: 'fields', fields: parsed.errors };

  const { name, email } = parsed.value;
  if (target.sessionId) {
    const [held] = await db()
      .select({
        total: sql<number>`count(*)`.mapWith(Number),
        same: sql<number>`count(*) filter (where ${guestContact.email} = ${email})`.mapWith(Number),
      })
      .from(guestContact)
      .where(eq(guestContact.sessionId, target.sessionId));
    if ((held?.total ?? 0) >= CONTACTS_PER_SESSION && (held?.same ?? 0) === 0) return { ok: false, error: 'too_many' };
  }
  const now = new Date();
  const proof = {
    name,
    consentAt: now,
    consentText: consent.text,
    consentLocale: consent.locale,
    policyUrl: consent.policyUrl,
  };
  await db()
    .insert(guestContact)
    .values({ id: uuidv7(), eventId: target.eventId, sessionId: target.sessionId, email, ...proof })
    .onConflictDoUpdate({
      target: target.sessionId
        ? [guestContact.sessionId, guestContact.email]
        : [guestContact.eventId, guestContact.email],
      targetWhere: target.sessionId ? sql`session_id is not null` : sql`session_id is null`,
      set: proof,
    });
  return { ok: true };
}
