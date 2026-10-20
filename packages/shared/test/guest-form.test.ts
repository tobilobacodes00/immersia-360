import { describe, expect, it } from 'vitest';
import { defaultShareSettings, shareSettingsSchema } from '../src/event';
import {
  buildConsentText,
  cleanName,
  consentFingerprint,
  guestFormCookie,
  guestFormSettingsSchema,
  isGuestFormChoice,
  isSafePolicyUrl,
  normalizeEmail,
  parseGuestContact,
  policyHref,
} from '../src/guest-form';

describe('guest form settings (SHR-6)', () => {
  it('is off by default and has no policy link', () => {
    expect(defaultShareSettings().guestForm).toEqual({
      enabled: false,
      requireName: false,
      consentText: '',
      policyUrl: '',
    });
  });

  it('upgrades settings stored before the policy link existed', () => {
    const old = { enabled: true, requireName: true, consentText: 'Send me the newsletter.' };
    const parsed = shareSettingsSchema.parse({ ...defaultShareSettings(), guestForm: old });
    expect(parsed.guestForm).toEqual({ ...old, policyUrl: '' });
  });

  it('accepts only an https privacy-policy link', () => {
    const ok = (v: string) => guestFormSettingsSchema.safeParse({ policyUrl: v }).success;
    expect(ok('')).toBe(true);
    expect(ok('https://studio.example/privacy')).toBe(true);
    expect(ok('  https://studio.example/privacy  ')).toBe(true);
    expect(ok('http://studio.example/privacy')).toBe(false);
    expect(ok('javascript:alert(1)')).toBe(false);
    expect(ok('data:text/html,<script>1</script>')).toBe(false);
    expect(ok('https://user:pass@studio.example/')).toBe(false);
    expect(ok('not a url')).toBe(false);
    expect(ok(`https://studio.example/${'a'.repeat(500)}`)).toBe(false);
  });

  it('reports a bad link with a stable code the setup screen translates', () => {
    const r = guestFormSettingsSchema.safeParse({ policyUrl: 'ftp://x' });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.message).toBe('policy_url_invalid');
  });

  it('renders a link target only for a safe URL', () => {
    expect(policyHref(' https://studio.example/p ')).toBe('https://studio.example/p');
    expect(policyHref('javascript:alert(1)')).toBeNull();
    expect(policyHref('')).toBeNull();
    expect(isSafePolicyUrl('https://')).toBe(false);
  });
});

describe('consent snapshot', () => {
  it('is the standard wording followed by the operator sentence, whitespace-normalised', () => {
    expect(buildConsentText('I agree that  Studio X may email me.', '  Add me to\nthe newsletter. ')).toBe(
      'I agree that Studio X may email me. Add me to the newsletter.',
    );
    expect(buildConsentText('I agree.', '   ')).toBe('I agree.');
  });

  it('fingerprints exactly what is displayed', async () => {
    const shown = { locale: 'en', text: 'I agree.', policyUrl: 'https://x.example/p' };
    const a = await consentFingerprint(shown);
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(await consentFingerprint({ ...shown })).toBe(a);
    // Any change to what the guest saw changes the fingerprint, so a stale form is refused.
    expect(await consentFingerprint({ ...shown, text: 'I agree!' })).not.toBe(a);
    expect(await consentFingerprint({ ...shown, locale: 'es' })).not.toBe(a);
    expect(await consentFingerprint({ ...shown, policyUrl: '' })).not.toBe(a);
  });
});

describe('guest input validation', () => {
  const ok = { name: 'Ada Lovelace', email: 'ADA@Example.COM ', consent: true };

  it('normalises the address and keeps the name', () => {
    expect(parseGuestContact(ok, { requireName: false })).toEqual({
      ok: true,
      value: { name: 'Ada Lovelace', email: 'ada@example.com' },
    });
    expect(normalizeEmail('  Foo@Bar.com')).toBe('foo@bar.com');
  });

  it('treats an empty optional name as no name', () => {
    expect(parseGuestContact({ ...ok, name: '   ' }, { requireName: false })).toEqual({
      ok: true,
      value: { name: null, email: 'ada@example.com' },
    });
  });

  it('requires the name only when the operator asks for it', () => {
    expect(parseGuestContact({ ...ok, name: '' }, { requireName: true })).toEqual({
      ok: false,
      errors: { name: 'required' },
    });
  });

  it('refuses a missing or malformed address', () => {
    expect(parseGuestContact({ ...ok, email: '' }, { requireName: false })).toEqual({
      ok: false,
      errors: { email: 'required' },
    });
    for (const email of ['ada', 'ada@', '@example.com', 'a b@example.com', 'ada@@example.com'])
      expect(parseGuestContact({ ...ok, email }, { requireName: false }), email).toEqual({
        ok: false,
        errors: { email: 'invalid' },
      });
    const long = `${'a'.repeat(250)}@example.com`;
    expect(parseGuestContact({ ...ok, email: long }, { requireName: false })).toMatchObject({ ok: false });
  });

  it('never accepts without the ticked consent box (it is unticked by default)', () => {
    expect(parseGuestContact({ ...ok, consent: false }, { requireName: false })).toEqual({
      ok: false,
      errors: { consent: 'required' },
    });
  });

  it('reports every problem at once', () => {
    expect(parseGuestContact({ name: '', email: 'x', consent: false }, { requireName: true })).toEqual({
      ok: false,
      errors: { name: 'required', email: 'invalid', consent: 'required' },
    });
  });

  it('cleans names: control characters, runs of spaces and length', () => {
    expect(cleanName('  Ada\u0000 \t Lovelace​ ')).toBe('Ada Lovelace');
    expect(cleanName('x'.repeat(500))).toHaveLength(120);
  });
});

describe('the remembered choice', () => {
  it('is a per-event cookie name and only two values', () => {
    expect(guestFormCookie('0199c8a2-5b3e-7d10-8a4f-0c1d2e3f4a5b')).toBe(
      'immersia_gf_0199c8a25b3e7d108a4f0c1d2e3f4a5b',
    );
    expect(isGuestFormChoice('submitted')).toBe(true);
    expect(isGuestFormChoice('skipped')).toBe(true);
    expect(isGuestFormChoice('1')).toBe(false);
    expect(isGuestFormChoice(undefined)).toBe(false);
  });
});
