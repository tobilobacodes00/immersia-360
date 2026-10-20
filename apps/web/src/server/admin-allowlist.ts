/**
 * The platform-admin allowlist (ADMIN_EMAILS), as pure functions so the rule is testable and the
 * same one runs everywhere: addresses separated by commas, spaces or semicolons, compared
 * case-insensitively. No pattern matching and no domains: an admin is named, in full.
 */

export function parseAdminEmails(raw: string | null | undefined): string[] {
  return (raw ?? '')
    .split(/[,\s;]+/)
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.includes('@'));
}

export function isAdminEmail(email: string | null | undefined, allowlist: readonly string[]): boolean {
  return !!email && allowlist.includes(email.trim().toLowerCase());
}
