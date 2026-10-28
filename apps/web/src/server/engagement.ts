import 'server-only';
import { after } from 'next/server';
import { eq, sql } from 'drizzle-orm';
import { db, schema } from '@immersia/db';
import type { DownloadRoute } from '@immersia/shared';

const { captureSession } = schema;

/**
 * Count one open of a guest's share page against its session (LIV-14): how often the page was opened, and how
 * often that was through the QR the Live Display shows (route `display`). These two numbers, with the downloads
 * each output already counts, are what the highlight reel ranks by. They are plain counters on the session: no
 * visitor is identified, and the first-party analytics (which is deliberately not keyed by session) is untouched.
 *
 * Recorded after the response is sent, like `track`, so a slow write never delays a guest's page; a failure is
 * logged and costs one count.
 */
export function countSessionView(linkId: string, route: DownloadRoute) {
  after(async () => {
    try {
      await db()
        .update(captureSession)
        .set({
          viewCount: sql`${captureSession.viewCount} + 1`,
          ...(route === 'display' ? { displayScans: sql`${captureSession.displayScans} + 1` } : {}),
        })
        .where(eq(captureSession.linkId, linkId));
    } catch (err) {
      console.error('[engagement] could not count a view', err instanceof Error ? err.message : err);
    }
  });
}
