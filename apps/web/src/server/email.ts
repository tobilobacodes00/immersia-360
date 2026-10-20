import 'server-only';
import { createTransport, type Transporter } from 'nodemailer';
import { Resend } from 'resend';
import { getTranslations } from 'next-intl/server';
import { LOCALE_COOKIE, isLocale, negotiateLocale, type Locale } from '@immersia/i18n';
import type { ReportReason } from '@immersia/shared';
import { env, isProduction } from './env';
import { devMailbox } from './dev-mailbox';

export interface OutgoingEmail {
  to: string;
  subject: string;
  html: string;
  text: string;
}

let resend: Resend | undefined;
let smtp: Transporter | undefined;

/** Which sender is configured. SMTP wins when both are set (e.g. reusing Immersia Booth's Gmail). */
export function emailTransport(): 'smtp' | 'resend' | 'dev' {
  const e = env();
  if (e.SMTP_URL) return 'smtp';
  if (e.RESEND_API_KEY) return 'resend';
  return 'dev';
}

/**
 * Pluggable sender: any SMTP server (SMTP_URL, e.g. smtps://user:app-password@smtp.gmail.com:465)
 * or Resend (RESEND_API_KEY). With neither, outside production, mail goes to the in-process dev
 * mailbox and the server log, so sign-in works locally and in e2e without a real inbox.
 */
export async function sendEmail(mail: OutgoingEmail): Promise<void> {
  const e = env();
  switch (emailTransport()) {
    case 'smtp': {
      smtp ??= createTransport(e.SMTP_URL!);
      await smtp.sendMail({ from: e.EMAIL_FROM, ...mail });
      return;
    }
    case 'resend': {
      resend ??= new Resend(e.RESEND_API_KEY!);
      const { error } = await resend.emails.send({ from: e.EMAIL_FROM, ...mail });
      if (error) throw new Error(`Email to ${mail.to} failed: ${error.name}: ${error.message}`);
      return;
    }
    case 'dev': {
      if (isProduction()) throw new Error('No email sender configured: set SMTP_URL or RESEND_API_KEY');
      devMailbox.deliver(mail);
      console.warn(`[dev-mailbox] ${mail.to}: ${mail.subject}\n${mail.text}`);
    }
  }
}

/** The recipient's language for a transactional email: their explicit choice, else the browser's. */
export function localeFromRequest(headers: Headers | undefined): Locale {
  if (!headers) return 'en';
  const cookie = headers.get('cookie') ?? '';
  const chosen = new RegExp(`(?:^|;\\s*)${LOCALE_COOKIE}=([a-z]{2})`).exec(cookie)?.[1];
  if (isLocale(chosen)) return chosen;
  return negotiateLocale(headers.get('accept-language'));
}

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/**
 * One email layout in the Immersia Booth language: paper, ink, a single cobalt action. Table-based
 * and inline-styled because email clients ignore stylesheets.
 */
function layout({
  heading,
  body,
  action,
  url,
  footer,
}: Record<'heading' | 'body' | 'action' | 'url' | 'footer', string>) {
  const html = `<!doctype html><html><body style="margin:0;background:#f7f6f2;font-family:-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;color:#111110">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7f6f2;padding:32px 16px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border:1px solid #e7e5df;border-radius:14px;padding:32px">
<tr><td style="font-size:13px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:#6b6963;padding-bottom:20px">Immersia 360</td></tr>
<tr><td style="font-size:24px;font-weight:700;letter-spacing:-.02em;line-height:1.2;padding-bottom:12px">${escapeHtml(heading)}</td></tr>
<tr><td style="font-size:15px;line-height:1.55;color:#55534e;padding-bottom:24px">${escapeHtml(body)}</td></tr>
<tr><td style="padding-bottom:24px"><a href="${escapeHtml(url)}" style="display:inline-block;background:#111110;color:#ffffff;font-weight:600;font-size:15px;text-decoration:none;padding:12px 20px;border-radius:12px">${escapeHtml(action)}</a></td></tr>
<tr><td style="font-size:13px;line-height:1.5;color:#6b6963">${escapeHtml(footer)}</td></tr>
</table></td></tr></table></body></html>`;
  const text = `${heading}\n\n${body}\n\n${action}: ${url}\n\n${footer}`;
  return { html, text };
}

export async function sendMagicLinkEmail(to: string, url: string, locale: Locale) {
  const t = await getTranslations({ locale, namespace: 'email.magicLink' });
  await sendEmail({
    to,
    subject: t('subject'),
    ...layout({ heading: t('heading'), body: t('body'), action: t('action'), url, footer: t('footer') }),
  });
}

export async function sendInvitationEmail(
  to: string,
  url: string,
  locale: Locale,
  vars: { inviter: string; organization: string; role: string },
) {
  const t = await getTranslations({ locale, namespace: 'email.invitation' });
  const tr = await getTranslations({ locale, namespace: 'roles' });
  const role = tr(vars.role as 'owner' | 'operator' | 'viewer');
  await sendEmail({
    to,
    subject: t('subject', { organization: vars.organization }),
    ...layout({
      heading: t('heading', { organization: vars.organization }),
      body: t('body', { inviter: vars.inviter, role }),
      action: t('action'),
      url,
      footer: t('footer'),
    }),
  });
}

/** SHR-2: the guest's session link, sent from the booth. The address is used for this send only. */
export async function sendGuestLinkEmail(
  to: string,
  url: string,
  locale: Locale,
  vars: { event: string; expiresAt: Date },
) {
  const t = await getTranslations({ locale, namespace: 'email.guestLink' });
  const date = new Intl.DateTimeFormat(locale, { dateStyle: 'long' }).format(vars.expiresAt);
  await sendEmail({
    to,
    subject: t('subject', { event: vars.event }),
    ...layout({
      heading: t('heading', { event: vars.event }),
      body: t('body', { date }),
      action: t('action'),
      url,
      footer: t('footer'),
    }),
  });
}

/**
 * Abuse: tell an event's operator that a guest reported something of theirs. Says which event and
 * why, never what the content is; the page it links to is where they act (hide it, see the reports).
 */
export async function sendReportOperatorEmail(
  to: string,
  url: string,
  locale: Locale,
  vars: { event: string; reason: ReportReason },
) {
  const t = await getTranslations({ locale, namespace: 'email.reportOperator' });
  const tr = await getTranslations({ locale, namespace: 'studio.reports' });
  await sendEmail({
    to,
    subject: t('subject', { event: vars.event }),
    ...layout({
      heading: t('heading', { event: vars.event }),
      body: t('body', { reason: tr(`reasons.${vars.reason}`) }),
      action: t('action'),
      url,
      footer: t('footer'),
    }),
  });
}

/** Abuse: platform admins are told of a new report (English: the admin console is internal). */
export async function sendReportAdminEmail(
  to: string,
  url: string,
  vars: { event: string; organization: string; reason: string; auto?: string },
) {
  await sendEmail({
    to,
    subject: `Report to review: ${vars.reason}`,
    ...layout({
      heading: 'A report needs a decision',
      body: `${vars.auto ?? `A guest reported content from "${vars.event}" (${vars.organization})`} as: ${vars.reason}. Reports are answered within 24 hours.`,
      action: 'Open the queue',
      url,
      footer: 'You get this because you are listed in ADMIN_EMAILS.',
    }),
  });
}

/** Abuse: an escalated report goes to whoever decides legal and trust questions (TRUST_EMAIL). */
export async function sendReportEscalationEmail(
  to: string,
  url: string,
  vars: { event: string; organization: string; reason: string; note: string },
) {
  await sendEmail({
    to,
    subject: `Escalated report: ${vars.reason}`,
    ...layout({
      heading: 'A report was escalated to you',
      body: `Report on "${vars.event}" (${vars.organization}), reason: ${vars.reason}. Note from the admin: ${vars.note || 'none'}.`,
      action: 'Open the report',
      url,
      footer: 'Escalations come from the admin queue and are recorded in the audit log.',
    }),
  });
}
