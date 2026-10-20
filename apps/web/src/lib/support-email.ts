/**
 * The address privacy and support requests go to (shown on /privacy and /terms). Operators of a
 * deployment set SUPPORT_EMAIL; without it we fall back to something that is at least the
 * deployment owner's own, never to an address on a domain we only guess:
 *   1. SUPPORT_EMAIL
 *   2. the sender address of EMAIL_FROM, unless it is Resend's shared onboarding sender
 *   3. support@ the deployment's own host
 */
export function resolveSupportEmail(input: {
  supportEmail?: string | undefined;
  emailFrom?: string | undefined;
  origin: string;
}): string {
  const configured = input.supportEmail?.trim();
  if (configured) return configured;
  // "Name <hello@example.com>" or a bare address.
  const sender = /<([^<>\s@]+@[^<>\s@]+)>/.exec(input.emailFrom ?? '')?.[1] ?? input.emailFrom?.trim();
  if (sender && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(sender) && !/@resend\.dev$/i.test(sender)) return sender;
  let host = 'localhost';
  try {
    host = new URL(input.origin).hostname;
  } catch {
    // Keep the placeholder host.
  }
  return `support@${host.replace(/^www\./, '')}`;
}
