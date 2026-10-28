/** Pure helpers for the account-level privacy tools (Settings), shared by the screen and the action. */

/** What an owner types to confirm deleting an organization whose name is empty. */
export const DELETE_FALLBACK_PHRASE = 'DELETE';

/** The phrase that confirms deleting this organization: its exact name (a blank name falls back to DELETE). */
export function deletionPhrase(organizationName: string): string {
  return organizationName.normalize('NFC').trim() || DELETE_FALLBACK_PHRASE;
}

/** True when what was typed is the organization's name, exactly (case-sensitive, surrounding spaces ignored). */
export function confirmsDeletion(typed: string, organizationName: string): boolean {
  return typed.normalize('NFC').trim() === deletionPhrase(organizationName);
}

/** `immersia-360-<slug>-2026-10-20.json`: the download name of an organization export. */
export function exportFilename(organizationSlug: string, now: Date): string {
  const slug =
    organizationSlug
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'organization';
  return `immersia-360-${slug}-${now.toISOString().slice(0, 10)}.json`;
}
