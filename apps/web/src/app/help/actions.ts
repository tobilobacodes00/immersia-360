'use server';

import { headers } from 'next/headers';
import { getLocale } from 'next-intl/server';
import { buildSupportMail, supportRequestSchema } from '@/lib/support';
import { sendEmail } from '@/server/email';
import { supportEmail } from '@/server/env';
import { allow, clientIp } from '@/server/rate-limit';
import { getOperator } from '@/server/session';

export type ContactState =
  | { status: 'idle' }
  | { status: 'sent'; email: string }
  | {
      status: 'error';
      code: 'invalid' | 'rate_limited' | 'failed';
      fields: ('email' | 'message')[];
      /** What was typed, so a failed send doesn't empty the form (React resets a form after its action). */
      values: { name: string; email: string; topic: string; message: string };
    };

const text = (data: FormData, key: string) => {
  const v = data.get(key);
  return typeof v === 'string' ? v : '';
};

/**
 * HLP-2: the help centre's contact form. Public (a person locked out of the Studio needs it most), so
 * it is rate limited per address and per sender, carries a hidden field that only a bot fills, and
 * sends one email to the support inbox with Reply-To set to the sender. The reply target is in the
 * form's own wording (SUPPORT_RESPONSE_BUSINESS_DAYS).
 */
export async function submitSupportRequest(_previous: ContactState, data: FormData): Promise<ContactState> {
  const email = text(data, 'email').trim();
  const values = { name: text(data, 'name'), email, topic: text(data, 'topic'), message: text(data, 'message') };
  // Bots fill every field. Say "sent" and send nothing.
  if (text(data, 'website') !== '') return { status: 'sent', email };

  const parsed = supportRequestSchema.safeParse({
    name: text(data, 'name'),
    email,
    topic: text(data, 'topic'),
    message: text(data, 'message'),
    page: text(data, 'page'),
  });
  if (!parsed.success) {
    const fields = new Set<'email' | 'message'>();
    for (const issue of parsed.error.issues) {
      const key = issue.path[0];
      if (key === 'email' || key === 'message') fields.add(key);
    }
    return { status: 'error', code: 'invalid', fields: [...fields], values };
  }

  if (
    !(await allow('supportPerIp', await clientIp())) ||
    !(await allow('supportPerEmail', parsed.data.email.toLowerCase()))
  )
    return { status: 'error', code: 'rate_limited', fields: [], values };

  try {
    // Context for whoever answers; a failure to look it up must not stop the message.
    const operator = await getOperator().catch(() => null);
    const mail = buildSupportMail(parsed.data, {
      locale: await getLocale(),
      userAgent: (await headers()).get('user-agent'),
      account: operator
        ? { userId: operator.userId, organization: operator.organizationName, role: operator.role }
        : null,
    });
    await sendEmail({ to: supportEmail(), replyTo: parsed.data.email, ...mail });
    return { status: 'sent', email: parsed.data.email };
  } catch (err) {
    console.error('[support] could not send', err);
    return { status: 'error', code: 'failed', fields: [], values };
  }
}
