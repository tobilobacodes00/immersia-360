import { describe, expect, it } from 'vitest';
import { resolveSupportEmail } from './support-email';

describe('the privacy contact address', () => {
  const origin = 'https://booth.example.org';

  it('prefers SUPPORT_EMAIL', () => {
    expect(
      resolveSupportEmail({
        supportEmail: ' privacy@studio.example ',
        emailFrom: 'Immersia <hello@x.example>',
        origin,
      }),
    ).toBe('privacy@studio.example');
  });

  it('falls back to the sender address of EMAIL_FROM', () => {
    expect(resolveSupportEmail({ emailFrom: 'Immersia 360 <hello@x.example>', origin })).toBe('hello@x.example');
    expect(resolveSupportEmail({ emailFrom: 'hello@x.example', origin })).toBe('hello@x.example');
  });

  it('ignores the shared Resend onboarding sender, which nobody reads', () => {
    expect(resolveSupportEmail({ emailFrom: 'Immersia 360 <onboarding@resend.dev>', origin })).toBe(
      'support@booth.example.org',
    );
  });

  it('ends at support@ the deployment host', () => {
    expect(resolveSupportEmail({ origin: 'https://www.immersia.example/' })).toBe('support@immersia.example');
    expect(resolveSupportEmail({ origin: 'http://localhost:3000' })).toBe('support@localhost');
    expect(resolveSupportEmail({ origin: 'not a url' })).toBe('support@localhost');
  });
});
