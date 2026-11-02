import 'server-only';
import type { OutgoingEmail } from './email';

type DevMail = OutgoingEmail & { at: number };

/**
 * In-process mailbox for local development and e2e (no Resend key). Bounded so a long-running dev
 * server can't grow without limit. Never used in production (see sendEmail).
 *
 * The messages live on `globalThis`, not in this module's scope. Next.js bundles route handlers and
 * server actions as separate entries, and a module-level array can end up as one copy per entry: a
 * sign-in link sent from the auth route was visible to the mailbox route, but an invitation sent from
 * the team page's server action was delivered into a copy the route never reads (it answered "no
 * mail" for mail the server had just logged). `globalThis` is one object for the whole process.
 */
const MAX = 200;
const KEY = Symbol.for('immersia360.devMailbox');

function messages(): DevMail[] {
  const slot = globalThis as unknown as Record<symbol, DevMail[] | undefined>;
  return (slot[KEY] ??= []);
}

export const devMailbox = {
  deliver(mail: OutgoingEmail) {
    const all = messages();
    all.push({ ...mail, at: Date.now() });
    if (all.length > MAX) all.splice(0, all.length - MAX);
  },
  latestFor(to: string) {
    const all = messages();
    const addr = to.toLowerCase();
    for (let i = all.length - 1; i >= 0; i--) if (all[i]!.to.toLowerCase() === addr) return all[i];
    return undefined;
  },
};
