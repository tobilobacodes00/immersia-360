'use server';

import { after } from 'next/server';
import { cookies } from 'next/headers';
import type { Route } from 'next';
import { redirect } from 'next/navigation';
import { REPORT_DETAILS_MAX, isLinkId, parseRouteParams, reportInputSchema, reporterHash } from '@immersia/shared';
import { env } from '@/server/env';
import { galleryCookie, galleryEvent, validGalleryPass } from '@/server/gallery';
import { clientIp } from '@/server/rate-limit';
import {
  createReport,
  notifyNewReport,
  reportTargetForGallery,
  reportTargetForLink,
  type ReportTarget,
} from '@/server/reports';

const field = (form: FormData, name: string, max = 200) => String(form.get(name) ?? '').slice(0, max);

/**
 * The report form (Abuse NFR). A plain form posting to a server action, so it works without any
 * client JavaScript and from the slowest phone; the outcome comes back in the URL. The reporter is
 * known only by a salted hash that changes daily (see reporterHash): never an address, never a cookie.
 */
export async function submitReport(form: FormData) {
  const linkId = field(form, 'l', 40);
  const slug = field(form, 'g', 60);
  const route = parseRouteParams({ r: field(form, 'r', 20) });
  const back = new URLSearchParams();
  if (linkId) back.set('l', linkId);
  else if (slug) back.set('g', slug);
  if (route !== 'direct') back.set('r', route);
  const to = (extra: Record<string, string>) =>
    redirect(`/report?${new URLSearchParams({ ...Object.fromEntries(back), ...extra })}` as Route);

  // A field real people never see: anything in it is a script filling in every box. Look thanked.
  if (field(form, 'website')) to({ done: '1' });

  const parsed = reportInputSchema.safeParse({
    reason: field(form, 'reason', 20),
    details: field(form, 'details', REPORT_DETAILS_MAX + 1),
    contact: field(form, 'contact', 255),
  });
  if (!parsed.success) to({ e: parsed.error.issues.some((i) => i.path[0] === 'contact') ? 'contact' : 'invalid' });

  let target: ReportTarget | null = null;
  if (isLinkId(linkId)) target = await reportTargetForLink(linkId);
  else if (slug) {
    const ev = await galleryEvent(slug);
    const open =
      ev &&
      (!ev.passwordHash || validGalleryPass(slug, ev.passwordHash, (await cookies()).get(galleryCookie(slug))?.value));
    if (open) target = await reportTargetForGallery(slug, field(form, 'code', 16));
  }
  if (!target) to({ e: 'not_found' });
  if (!parsed.success || !target) return;

  // One value per reporter per day. Without an address (a server with no proxy headers) the value is
  // per session instead, so the per-session and per-event limits still hold. The same in E2E mode,
  // where every browser shares one address and the suite files many reports.
  const address = await clientIp();
  const reporter = await reporterHash(
    address === 'unknown' || env().E2E === '1' ? `unknown:${target.sessionId}` : address,
    env().BETTER_AUTH_SECRET,
  );
  const result = await createReport(target, parsed.data, reporter);
  switch (result.status) {
    case 'too_many':
      return to({ e: 'too_many' });
    case 'removed':
      return to({ done: 'removed' });
    case 'created': {
      const reportId = result.reportId;
      after(() => notifyNewReport(reportId));
      return to({ done: '1' });
    }
    case 'duplicate':
      return to({ done: '1' });
  }
}
