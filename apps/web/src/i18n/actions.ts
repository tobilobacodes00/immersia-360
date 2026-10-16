'use server';

import { cookies, headers } from 'next/headers';
import { LOCALE_COOKIE, isLocale } from '@immersia/i18n';

/** Persist the language picker choice (screen 1). One year; the app works without it. */
export async function setLocale(locale: string): Promise<void> {
  if (!isLocale(locale)) return;
  // `Secure` follows the actual protocol: over plain http (local runs, CI) a Secure cookie is
  // silently dropped by Safari/WebKit, which treats loopback as insecure.
  const proto = (await headers()).get('x-forwarded-proto') ?? 'http';
  (await cookies()).set(LOCALE_COOKIE, locale, {
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
    sameSite: 'lax',
    secure: proto === 'https',
  });
}
