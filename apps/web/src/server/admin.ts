import 'server-only';
import { notFound } from 'next/navigation';
import { isAdminEmail as inAllowlist, parseAdminEmails } from './admin-allowlist';
import { env } from './env';
import { getSession } from './session';

/**
 * Platform admins: the people allowed into /admin (success metrics, the reports queue). They are
 * named in the ADMIN_EMAILS environment variable and nowhere else, and the check runs on the server
 * on every admin page and every admin action. A visitor who is not one gets a plain 404, signed in
 * or not, so the pages do not even announce themselves.
 */

/** The configured allowlist, lower-cased. Empty (the default) means nobody is an admin. */
export const adminEmails = (): string[] => parseAdminEmails(env().ADMIN_EMAILS);

export const isAdminEmail = (email: string | null | undefined): boolean => inAllowlist(email, adminEmails());

export interface PlatformAdmin {
  userId: string;
  email: string;
  name: string;
}

/** The signed-in admin, or null. Requires a verified address: an unverified sign-up can't claim an admin's email. */
export async function getPlatformAdmin(): Promise<PlatformAdmin | null> {
  const session = await getSession();
  if (!session) return null;
  const { id, email, name, emailVerified } = session.user;
  if (!emailVerified || !isAdminEmail(email)) return null;
  return { userId: id, email, name };
}

/** For admin pages and actions: the admin, or a 404 for everyone else. */
export async function requirePlatformAdmin(): Promise<PlatformAdmin> {
  const admin = await getPlatformAdmin();
  if (!admin) notFound();
  return admin;
}
