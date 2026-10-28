/**
 * What guest pages may learn from a user agent: a browser family, and whether it is a link-preview
 * robot. The user agent string itself is never stored; only the family leaves this function, so
 * analytics can say "downloads fail on Safari" without holding anything that identifies a visitor.
 */
import type { BrowserFamily } from './analytics';

export function browserFamily(ua: string | null | undefined): BrowserFamily {
  if (!ua) return 'other';
  if (/EdgA?\/|Edge\//.test(ua)) return 'edge';
  if (/SamsungBrowser\//.test(ua)) return 'samsung';
  if (/Firefox\/|FxiOS\//.test(ua)) return 'firefox';
  if (/Chrome\/|CriOS\/|Chromium\//.test(ua)) return 'chrome';
  if (/Safari\//.test(ua)) return 'safari';
  return 'other';
}

/**
 * Link-preview fetchers and crawlers. WhatsApp, iMessage and Slack open a link the moment it is
 * pasted, long before any guest taps it; counting those as share-page loads would make the
 * download-success metric look worse than it is. (Automated test browsers announce themselves as
 * ordinary Chrome and are deliberately not matched.)
 */
const BOT =
  /bot\b|crawl|spider|slurp|preview|facebookexternalhit|whatsapp|telegram|discord|slack|skype|linkedin|pinterest|embedly|quora link|vkshare|redditbot|applebot|bingpreview|google-read-aloud|lighthouse|curl\/|wget\/|python-requests|go-http-client|okhttp|axios\//i;

export function isLinkPreviewBot(ua: string | null | undefined): boolean {
  return !!ua && BOT.test(ua);
}
