/**
 * Download routes (DL-13). Every guest-facing link carries `?r=<route>` so analytics can show which
 * of the eight routes guests actually use. Unknown or missing values are recorded as `direct`.
 */
export const DOWNLOAD_ROUTES = [
  'booth',
  'display',
  'print',
  'outro',
  'code',
  'station',
  'message',
  'event_qr',
  'nfc',
] as const;

export type DownloadRoute = (typeof DOWNLOAD_ROUTES)[number] | 'direct';

export function parseRoute(value: string | null | undefined): DownloadRoute {
  return (DOWNLOAD_ROUTES as readonly string[]).includes(value ?? '') ? (value as DownloadRoute) : 'direct';
}

/**
 * The route of a guest-page request. Links carry `?r=` (see sessionUrl); `?route=` is accepted as
 * well, so a link written by hand or by an integration that spells it out still counts.
 */
export function parseRouteParams(params: { r?: string | null; route?: string | null }): DownloadRoute {
  const short = parseRoute(params.r);
  return short !== 'direct' ? short : parseRoute(params.route);
}

/** Absolute session URL for a QR/link, tagged with its route. */
export function sessionUrl(origin: string, linkId: string, route: DownloadRoute): string {
  const url = new URL(`/s/${linkId}`, origin);
  if (route !== 'direct') url.searchParams.set('r', route);
  return url.toString();
}

/** Absolute event-gallery URL, tagged with its route. */
export function galleryUrl(origin: string, gallerySlug: string, route: DownloadRoute): string {
  const url = new URL(`/g/${gallerySlug}`, origin);
  if (route !== 'direct') url.searchParams.set('r', route);
  return url.toString();
}

/** Short URL a guest types a code into (DL-2). The short domain is configured per deployment. */
export function shortCodeUrl(shortOrigin: string, code?: string): string {
  return new URL(code ? `/${code}` : '/', shortOrigin).toString();
}
