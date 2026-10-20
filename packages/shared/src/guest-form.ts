/**
 * The guest data form (SHR-6) and its consent proof. Pure and dependency-free (zod aside) so the
 * operator UI, the guest pages and the server all use the same rules.
 *
 * Design rules these helpers encode (GDPR Art. 6/7, NDPA 2023):
 * - Consent is freely given: the form is optional and a guest can always skip it and still get
 *   their files (Art. 7(4)); nothing here gates a download.
 * - Consent is provable: what is stored is the exact sentence the guest saw, its language and the
 *   time, plus the privacy-policy link shown next to it.
 */
import { z } from 'zod';

export const GUEST_NAME_MAX = 120;
export const GUEST_EMAIL_MAX = 254;
export const CONSENT_EXTRA_MAX = 500;
export const POLICY_URL_MAX = 500;

/**
 * A privacy-policy link goes into an href on guest pages, so it must be a plain https URL: no
 * `javascript:` or `data:` schemes, no embedded credentials.
 */
export function isSafePolicyUrl(value: string): boolean {
  if (value.length === 0 || value.length > POLICY_URL_MAX) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname.length > 0 && !url.username && !url.password;
  } catch {
    return false;
  }
}

/** The stored value rendered as a link target: an unsafe or empty value yields null. */
export function policyHref(value: string): string | null {
  const trimmed = value.trim();
  return isSafePolicyUrl(trimmed) ? new URL(trimmed).toString() : null;
}

/** Refinement messages are stable codes: the setup screen translates them (studio.setup.issues.*). */
export const guestFormSettingsSchema = z.object({
  enabled: z.boolean().default(false),
  requireName: z.boolean().default(false),
  /** The operator's own sentence, added after the standard consent wording. */
  consentText: z.string().max(CONSENT_EXTRA_MAX).default(''),
  /** The operator's privacy policy: they, not Immersia, are the controller of this data. */
  policyUrl: z
    .string()
    .trim()
    .max(POLICY_URL_MAX)
    .refine((v) => v === '' || isSafePolicyUrl(v), 'policy_url_invalid')
    .default(''),
});
export type GuestFormSettings = z.infer<typeof guestFormSettingsSchema>;

/**
 * The sentence a guest ticks: the platform's wording (translated, naming the operator and the
 * event) followed by the operator's own sentence, whitespace-normalised so the text that is
 * displayed, hashed and stored is one and the same string.
 */
export function buildConsentText(base: string, extra: string): string {
  const own = extra.replace(/\s+/g, ' ').trim();
  const standard = base.replace(/\s+/g, ' ').trim();
  return own ? `${standard} ${own}` : standard;
}

/**
 * A short fingerprint of what the form displays. It travels in a hidden field and the server
 * recomputes it on submit: if the operator edited the wording (or the guest switched language)
 * between render and submit, the submission is refused and the form re-rendered, so a stored
 * consent never records text the guest did not see.
 */
export async function consentFingerprint(shown: { locale: string; text: string; policyUrl: string }): Promise<string> {
  const data = new TextEncoder().encode(`${shown.locale}\n${shown.text}\n${shown.policyUrl}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest).subarray(0, 8), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Addresses are matched case-insensitively everywhere, so they are stored that way. */
export function normalizeEmail(raw: string): string {
  return raw.normalize('NFKC').trim().toLowerCase();
}

const emailCheck = z.email();

/** Printable, single-spaced, bounded: names end up in spreadsheets and emails. */
export function cleanName(raw: string): string {
  return raw
    .normalize('NFKC')
    .replace(/[\p{Cc}\p{Cf}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, GUEST_NAME_MAX);
}

export type GuestFormField = 'name' | 'email' | 'consent';
export type GuestFormFieldError = 'required' | 'invalid';

export type GuestContactParse =
  | { ok: true; value: { name: string | null; email: string } }
  | { ok: false; errors: Partial<Record<GuestFormField, GuestFormFieldError>> };

/** Validate what a guest typed. `consent` is whether the (unticked-by-default) box was ticked. */
export function parseGuestContact(
  raw: { name: string; email: string; consent: boolean },
  opts: { requireName: boolean },
): GuestContactParse {
  const errors: Partial<Record<GuestFormField, GuestFormFieldError>> = {};
  const name = cleanName(raw.name);
  if (opts.requireName && !name) errors.name = 'required';
  const email = normalizeEmail(raw.email);
  if (!email) errors.email = 'required';
  else if (email.length > GUEST_EMAIL_MAX || !emailCheck.safeParse(email).success) errors.email = 'invalid';
  if (!raw.consent) errors.consent = 'required';
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value: { name: name || null, email } };
}

/** Where the form is shown: one session's page, or the event gallery. */
export type GuestFormScope = 'session' | 'gallery';

/**
 * What the form remembers about a browser, in a first-party cookie scoped to the share and gallery
 * paths: `submitted` or `skipped`. It only stops the form from reappearing; downloads never depend
 * on it.
 */
export type GuestFormChoice = 'submitted' | 'skipped';

/** Cookie name for an event's choice: its compact id keeps events apart without exposing anything. */
export const guestFormCookie = (eventId: string) => `immersia_gf_${eventId.replace(/-/g, '')}`;

export function isGuestFormChoice(value: string | undefined): value is GuestFormChoice {
  return value === 'submitted' || value === 'skipped';
}
