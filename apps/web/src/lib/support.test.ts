import { describe, expect, it } from 'vitest';
import {
  SUPPORT_MESSAGE_MAX,
  SUPPORT_RESPONSE_BUSINESS_DAYS,
  buildSupportMail,
  mailboxOf,
  supportRequestSchema,
} from './support';

const request = {
  name: 'Ada',
  email: 'ada@example.com',
  topic: 'printing' as const,
  message: 'The 4x6 print is two millimetres short.\nIt happens on both printers.',
  page: '/help/printing-setup',
};
const ctx = {
  locale: 'en',
  userAgent: 'Mozilla/5.0 (iPad)',
  account: { userId: 'u1', organization: 'Booth Co', role: 'owner' },
};

describe('support', () => {
  it('promises a reply in two business days', () => {
    expect(SUPPORT_RESPONSE_BUSINESS_DAYS).toBe(2);
  });

  it('finds the mailbox in a from address', () => {
    expect(mailboxOf('Immersia 360 <hello@example.com>')).toBe('hello@example.com');
    expect(mailboxOf(' hello@example.com ')).toBe('hello@example.com');
  });

  describe('request', () => {
    it('accepts a normal message and trims it', () => {
      const parsed = supportRequestSchema.parse({ ...request, message: `  ${request.message}  `, name: '  Ada ' });
      expect(parsed.name).toBe('Ada');
      expect(parsed.message).toBe(request.message);
    });

    it('needs a real email address, a known topic and enough words to understand', () => {
      expect(supportRequestSchema.safeParse({ ...request, email: 'not-an-email' }).success).toBe(false);
      expect(supportRequestSchema.safeParse({ ...request, topic: 'sales' }).success).toBe(false);
      expect(supportRequestSchema.safeParse({ ...request, message: 'help' }).success).toBe(false);
      expect(supportRequestSchema.safeParse({ ...request, message: 'x'.repeat(SUPPORT_MESSAGE_MAX + 1) }).success).toBe(
        false,
      );
    });

    it('does not need a name or a page', () => {
      const { name: _name, page: _page, ...rest } = request;
      expect(supportRequestSchema.safeParse(rest).success).toBe(true);
    });
  });

  describe('mail', () => {
    it('leads with the topic and the first words, and carries the sender and the account', () => {
      const mail = buildSupportMail(supportRequestSchema.parse(request), ctx);
      expect(mail.subject).toBe(
        '[Immersia 360 support] printing: The 4x6 print is two millimetres short. It happens on both printers.',
      );
      expect(mail.text).toContain('From: Ada <ada@example.com>');
      expect(mail.text).toContain('Account: u1 · Booth Co · owner');
      expect(mail.text).toContain('Page: /help/printing-setup');
      expect(mail.text.endsWith('It happens on both printers.\n')).toBe(true);
    });

    it('keeps a long message out of the subject and line breaks out of the header', () => {
      const mail = buildSupportMail(
        supportRequestSchema.parse({ ...request, message: `Line one\r\nBcc: attacker@example.com ${'x'.repeat(200)}` }),
        ctx,
      );
      expect(mail.subject).not.toMatch(/[\r\n]/);
      expect(mail.subject.length).toBeLessThan(120);
    });

    it('escapes everything it puts in the HTML', () => {
      const mail = buildSupportMail(
        supportRequestSchema.parse({
          ...request,
          name: '<img src=x onerror=alert(1)>',
          message: '<script>alert(1)</script> & more text',
        }),
        { ...ctx, userAgent: '<b>ua</b>' },
      );
      expect(mail.html).not.toContain('<script>');
      expect(mail.html).not.toContain('<img');
      expect(mail.html).not.toContain('<b>ua');
      expect(mail.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt; &amp; more text');
    });

    it('says when nobody is signed in', () => {
      const mail = buildSupportMail(supportRequestSchema.parse(request), { ...ctx, account: null, userAgent: null });
      expect(mail.text).toContain('Account: (not signed in)');
      expect(mail.text).toContain('Browser: (unknown)');
    });
  });
});
