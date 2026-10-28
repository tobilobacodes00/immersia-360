import { NextResponse, type NextRequest } from 'next/server';
import { getSessionCookie } from 'better-auth/cookies';
import { LOCALE_COOKIE, isLocale, negotiateLocale, type Locale } from '@immersia/i18n';
import en from '@immersia/i18n/messages/en';
import es from '@immersia/i18n/messages/es';
import pt from '@immersia/i18n/messages/pt';
import { isLinkId } from '@immersia/shared/ids';
import { contactHref, isServed, sessionState, stateHttpStatus } from '@/server/share-state';

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

interface GonePage {
  expired: { title: string; body: string };
  erased: { title: string; body: string };
  /** Hidden by the operator or taken down by the platform (410). */
  removed: { title: string; body: string };
  /** Taken down as illegal content (451). */
  removedLegal: { title: string; body: string };
  contact: string;
  privacy: string;
  terms: string;
}

/** What the self-contained 410/451 pages say, per language (small slices of the catalogues). */
const COPY: Record<Locale, GonePage> = {
  en: gonePage(en),
  es: gonePage(es),
  pt: gonePage(pt),
};

function gonePage(m: typeof en): GonePage {
  return {
    expired: { title: m.share.endedTitle, body: m.share.endedBody },
    erased: { title: m.share.erasedTitle, body: m.share.erasedBody },
    removed: { title: m.share.removedTitle, body: m.share.removedBody },
    removedLegal: { title: m.share.removedLegalTitle, body: m.share.removedLegalBody },
    contact: m.share.endedContact,
    privacy: m.common.privacy,
    terms: m.common.terms,
  };
}

const escape = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

/**
 * DL-9: a session that is not served answers with a self-contained page and the right status, per
 * the session-state model in share-state.ts: 410 Gone with "this event has ended" (expired), "deleted
 * at your request" (erased by the guest) or "no longer available" (hidden by the operator), and for a
 * takedown by the platform 451 (illegal content) or 410 "removed". Done here because a page can't set
 * its own status once it streams. One indexed lookup; anything else (unknown or pending or live link
 * ids, a database hiccup) falls through to the page, which handles it.
 */
async function shareGate(request: NextRequest) {
  const linkId = request.nextUrl.pathname.split('/')[2] ?? '';
  if (!isLinkId(linkId)) return NextResponse.next();
  const state = await sessionState(linkId).catch(() => null);
  if (!state || isServed(state.state)) return NextResponse.next();

  const cookie = request.cookies.get(LOCALE_COOKIE)?.value;
  const locale = isLocale(cookie) ? cookie : negotiateLocale(request.headers.get('accept-language'));
  const copy = COPY[locale];
  const removed = state.state === 'removed' || state.state === 'hidden';
  const legal = state.removal === 'legal';
  const { title, body } =
    state.state === 'erased'
      ? copy.erased
      : removed
        ? {
            title: legal ? copy.removedLegal.title : copy.removed.title,
            body: legal ? copy.removedLegal.body : copy.removed.body,
          }
        : copy.expired;
  // DL-12: the operator's contact, linked when it is an email address or phone number. Shown for an
  // ended event and for a deleted session too (copies the organizer saved elsewhere are theirs to
  // remove), not on a page for something that was removed.
  let contactLine = '';
  if (!removed && state.contact) {
    const href = contactHref(state.contact);
    const who = href ? `<a href="${escape(href)}">${escape(state.contact)}</a>` : escape(state.contact);
    const [before, after = ''] = copy.contact.split('{contact}');
    contactLine = `<p class="contact">${escape(before ?? '')}${who}${escape(after)}</p>`;
  }
  // Self-contained (no app chrome or scripts): Booth tokens inline, light only.
  const html = `<!doctype html><html lang="${locale}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>${escape(title)}</title><style>
body{margin:0;min-height:100dvh;display:grid;place-items:center;background:#f7f6f2;color:#111110;
font:15px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;padding:24px;box-sizing:border-box}
main{max-width:28rem;text-align:center}h1{font-size:clamp(1.75rem,6vw,2.5rem);line-height:1.05;letter-spacing:-0.03em;margin:0 0 12px}
p{color:#55534e;margin:0}.contact{margin-top:16px}a{color:#2b3fe6;font-weight:600}
footer{margin-top:24px;font-size:14px}footer a{display:inline-block;padding:8px;font-weight:500}</style></head><body><main><h1>${escape(title)}</h1><p>${escape(body)}</p>${contactLine}<footer><a href="/privacy">${escape(copy.privacy)}</a><a href="/terms">${escape(copy.terms)}</a></footer></main></body></html>`;
  return new NextResponse(html, {
    // 451 Unavailable For Legal Reasons for illegal content; 410 Gone for everything else.
    status: stateHttpStatus(state.state, state.removal),
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex' },
  });
}

export const config = {
  matcher: ['/studio/:path*', '/s/:linkId'],
};
