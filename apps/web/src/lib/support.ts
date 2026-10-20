import { z } from 'zod';

/**
 * Support (HLP-2, HLP-4). The response target is a promise we make on the contact form, the status
 * page and in the help articles, so it lives in one place.
 */
export const SUPPORT_RESPONSE_BUSINESS_DAYS = 2;

export const SUPPORT_TOPICS = ['setup', 'booth', 'printing', 'sharing', 'account', 'other'] as const;
export type SupportTopic = (typeof SUPPORT_TOPICS)[number];

export const SUPPORT_MESSAGE_MIN = 10;
export const SUPPORT_MESSAGE_MAX = 4000;

export const supportRequestSchema = z.object({
  name: z.string().trim().max(100).default(''),
  email: z.email().max(200),
  topic: z.enum(SUPPORT_TOPICS),
  message: z.string().trim().min(SUPPORT_MESSAGE_MIN).max(SUPPORT_MESSAGE_MAX),
  /** The page the form was sent from, for context. */
  page: z.string().max(300).default(''),
});
export type SupportRequest = z.infer<typeof supportRequestSchema>;

export interface SupportContext {
  locale: string;
  userAgent: string | null;
  /** Present when the sender is signed in to the Studio. */
  account: { userId: string; organization: string; role: string } | null;
}

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** One line, no control characters: safe in an email header. */
const oneLine = (s: string, max: number) =>
  s
    .replace(/\p{Cc}+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);

/**
 * The email the support inbox receives (HLP-2): what was asked, who asked and from where, in plain
 * text and escaped HTML. Reply-To is the sender, so answering is just "reply".
 */
export function buildSupportMail(
  req: SupportRequest,
  ctx: SupportContext,
): { subject: string; text: string; html: string } {
  const subject = `[Immersia 360 support] ${req.topic}: ${oneLine(req.message, 70)}`;
  const facts: [string, string][] = [
    ['From', req.name ? `${oneLine(req.name, 100)} <${req.email}>` : req.email],
    ['Topic', req.topic],
    ['Language', ctx.locale],
    ['Page', oneLine(req.page, 300) || '(not given)'],
    [
      'Account',
      ctx.account ? `${ctx.account.userId} · ${ctx.account.organization} · ${ctx.account.role}` : '(not signed in)',
    ],
    ['Browser', ctx.userAgent ? oneLine(ctx.userAgent, 300) : '(unknown)'],
  ];
  const text = `${facts.map(([k, v]) => `${k}: ${v}`).join('\n')}\n\n${req.message}\n`;
  const rows = facts
    .map(
      ([k, v]) =>
        `<tr><td style="padding:2px 12px 2px 0;color:#6b6963">${escapeHtml(k)}</td><td>${escapeHtml(v)}</td></tr>`,
    )
    .join('');
  const html = `<!doctype html><html><body style="font-family:-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5;color:#111110"><table role="presentation" cellpadding="0" cellspacing="0" style="margin-bottom:16px">${rows}</table><p style="white-space:pre-wrap">${escapeHtml(req.message)}</p></body></html>`;
  return { subject, text, html };
}
