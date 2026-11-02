import { NextResponse } from 'next/server';
import { STATUS_CACHE_S, getStatus } from '@/server/status';

/**
 * HLP-4: the status page's data as JSON, for uptime monitors. Public, and no more than the page
 * shows: each service's state and how long its check took. Shares the page's short cache.
 */
export async function GET() {
  const report = await getStatus();
  return NextResponse.json(report, {
    // 503 for an outage lets a plain HTTP monitor alert without parsing the body.
    status: report.overall === 'outage' ? 503 : 200,
    headers: { 'cache-control': `public, max-age=0, s-maxage=${STATUS_CACHE_S}` },
  });
}
