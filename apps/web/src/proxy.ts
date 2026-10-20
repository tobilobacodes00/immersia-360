import { NextResponse, type NextRequest } from 'next/server';
import { getSessionCookie } from 'better-auth/cookies';
import { LOCALE_COOKIE, isLocale, negotiateLocale, type Locale } from '@immersia/i18n';
import en from '@immersia/i18n/messages/en';
import es from '@immersia/i18n/messages/es';
import pt from '@immersia/i18n/messages/pt';
import { isLinkId } from '@immersia/shared/ids';
import { removalHttpStatus } from '@immersia/shared/reports';
import { contactHref, sessionState } from '@/server/share-state';

export function proxy(request: NextRequest) {
  if (request.nextUrl.pathname.startsWith('/s/')) return shareGate(request);
  return studioGate(request);
}

/**
 * Optimistic gate for the operator console: no session cookie → straight to sign-in, keeping the
 * destination. This only checks that a cookie exists; every page and action still validates the
 * session and role on the server (src/server/session.ts).
 */
function studioGate(request: NextRequest) {
  if (getSessionCookie(request)) return NextResponse.next();
  const url = request.nextUrl.clone();
  url.pathname = '/sign-in';
  url.search = '';
  url.searchParams.set('next', request.nextUrl.pathname + request.nextUrl.search);
  return NextResponse.redirect(url);
}

const ENDED: Record<Locale, { title: string; body: string; contact: string }> = {
  en: { title: en.share.endedTitle, body: en.share.endedBody, contact: en.share.endedContact },
  es: { title: es.share.endedTitle, body: es.share.endedBody, contact: es.share.endedContact },
  pt: { title: pt.share.endedTitle, body: pt.share.endedBody, contact: pt.share.endedContact },
};

const REMOVED: Record<Locale, Record<'title' | 'body' | 'legalTitle' | 'legalBody', string>> = {
  en: {
    title: en.share.removedTitle,
    body: en.share.removedBody,
    legalTitle: en.share.removedLegalTitle,
    legalBody: en.share.removedLegalBody,
  },
  es: {
    title: es.share.removedTitle,
    body: es.share.removedBody,
    legalTitle: es.share.removedLegalTitle,
    legalBody: es.share.removedLegalBody,
  },
  pt: {
    title: pt.share.removedTitle,
    body: pt.share.removedBody,
    legalTitle: pt.share.removedLegalTitle,
    legalBody: pt.share.removedLegalBody,
  },
};

const escape = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

/**
 * DL-9: an expired session answers 410 Gone with an "event has ended" page; a session removed after a
 * report answers 451 (illegal content) or 410 with a "removed" page. Done here because a
 * page can't set its own status once it streams. One indexed lookup; anything else (unknown or
 * pending link ids, a database hiccup) falls through to the page, which handles it.
 */
async function shareGate(request: NextRequest) {
  const linkId = request.nextUrl.pathname.split('/')[2] ?? '';
  if (!isLinkId(linkId)) return NextResponse.next();
  const state = await sessionState(linkId).catch(() => null);
  if (!state || (state.state !== 'expired' && state.state !== 'removed')) return NextResponse.next();

  const cookie = request.cookies.get(LOCALE_COOKIE)?.value;
  const locale = isLocale(cookie) ? cookie : negotiateLocale(request.headers.get('accept-language'));
  const removed = state.state === 'removed';
  const legal = state.removal === 'legal';
  const { title, body, contact } = removed
    ? {
        title: legal ? REMOVED[locale].legalTitle : REMOVED[locale].title,
        body: legal ? REMOVED[locale].legalBody : REMOVED[locale].body,
        contact: '',
      }
    : ENDED[locale];
  // DL-12: the operator's contact, linked when it is an email address or phone number (not on a removed page).
  let contactLine = '';
  if (!removed && state.contact) {
    const href = contactHref(state.contact);
    const who = href ? `<a href="${escape(href)}">${escape(state.contact)}</a>` : escape(state.contact);
    const [before, after = ''] = contact.split('{contact}');
    contactLine = `<p class="contact">${escape(before ?? '')}${who}${escape(after)}</p>`;
  }
  // Self-contained (no app chrome or scripts): Booth tokens inline, light only.
  const html = `<!doctype html><html lang="${locale}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>${escape(title)}</title><style>
body{margin:0;min-height:100dvh;display:grid;place-items:center;background:#f7f6f2;color:#111110;
font:15px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;padding:24px;box-sizing:border-box}
main{max-width:28rem;text-align:center}h1{font-size:clamp(1.75rem,6vw,2.5rem);line-height:1.05;letter-spacing:-0.03em;margin:0 0 12px}
p{color:#55534e;margin:0}.contact{margin-top:16px}a{color:#2b3fe6;font-weight:600}</style></head><body><main><h1>${escape(title)}</h1><p>${escape(body)}</p>${contactLine}</main></body></html>`;
  return new NextResponse(html, {
    // 451 Unavailable For Legal Reasons for illegal content; 410 Gone for everything else.
    status: removed ? removalHttpStatus(state.removal ?? 'policy') : 410,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex' },
  });
}

export const config = {
  matcher: ['/studio/:path*', '/s/:linkId'],
};
