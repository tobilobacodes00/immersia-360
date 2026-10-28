import 'server-only';

/**
 * Hash matching of hosted media against known illegal content (PRD Abuse NFR).
 *
 * What exists today: nothing that scans. Cloudflare's CSAM Scanning Tool covers images served
 * through Cloudflare's cache and is configured at the CDN (see SECURITY.md); it does not see video,
 * and does not see a file that is never fetched. Video hash matching needs a vendor and a legal
 * decision (who the reporting obligations fall on, which lists, which jurisdictions), and that
 * decision has not been made. So this file defines the seam and ships the honest default: a scanner
 * that scans nothing and says so. It is NOT a stand-in that pretends to check.
 *
 * To connect a vendor: implement `MediaScanner`, then call `setMediaScanner(yours)` once at startup
 * (for example from `instrumentation.ts`). `completeUpload` hands every verified upload to the
 * active scanner after the response is sent; a `flagged` verdict takes the session down as illegal
 * (451, files quarantined) and puts it in the admin queue (server/reports.ts `flagSession`).
 */

export interface MediaScanInput {
  outputId: string;
  sessionId: string;
  eventId: string;
  organizationId: string;
  /** Where the object is in the bucket; read it with a presigned URL or a ranged GET. */
  objectKey: string;
  mime: string;
  bytes: number;
}

export type MediaScanVerdict =
  | { verdict: 'clean' }
  /** A match against a list of known illegal content. `detail` is a vendor reference, never the content. */
  | { verdict: 'flagged'; detail: string };

export interface MediaScanner {
  /** Shown in the audit log and the admin queue ("Flagged by …"). */
  readonly name: string;
  scan(input: MediaScanInput): Promise<MediaScanVerdict>;
}

/** The default: no scanner is configured, nothing is checked. */
export const noScanner: MediaScanner = {
  name: 'none',
  scan: () => Promise.resolve({ verdict: 'clean' }),
};

let active: MediaScanner = noScanner;

export function setMediaScanner(scanner: MediaScanner): void {
  active = scanner;
}

export const mediaScanner = (): MediaScanner => active;

/** True when a real scanner is connected (the admin metrics page says so, so nobody assumes coverage). */
export const scannerConfigured = (): boolean => active !== noScanner;
