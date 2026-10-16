/**
 * Post-sign-in destination from `?next=`. Only same-origin absolute paths are honoured, so the
 * parameter can't be used as an open redirect (`//evil.com`, `/\evil.com`, `https://…`).
 */
export function safeNext(value: string | null | undefined, fallback = '/studio'): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return fallback;
  try {
    const url = new URL(value, 'http://x');
    return url.origin === 'http://x' ? url.pathname + url.search + url.hash : fallback;
  } catch {
    return fallback;
  }
}
