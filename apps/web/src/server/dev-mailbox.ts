import 'server-only';
import type { OutgoingEmail } from './email';

/**
 * In-process mailbox for local development and e2e (no Resend key). Bounded so a long-running dev
 * server can't grow without limit. Never used in production (see sendEmail).
 */
const MAX = 200;
const messages: (OutgoingEmail & { at: number })[] = [];

export const devMailbox = {
  deliver(mail: OutgoingEmail) {
    messages.push({ ...mail, at: Date.now() });
    if (messages.length > MAX) messages.splice(0, messages.length - MAX);
  },
  latestFor(to: string) {
    const addr = to.toLowerCase();
    for (let i = messages.length - 1; i >= 0; i--) if (messages[i]!.to.toLowerCase() === addr) return messages[i];
    return undefined;
  },
};
