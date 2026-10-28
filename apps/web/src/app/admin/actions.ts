'use server';

import type { Route } from 'next';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { parseMonthKey } from '@immersia/shared';
import { requirePlatformAdmin } from '@/server/admin';
import { deleteMonthlyBill, saveMonthlyBill } from '@/server/admin-metrics';
import { dismissReport, escalateReport, takeDownReport } from '@/server/reports';

/**
 * Admin actions. Server actions are public HTTP endpoints, so every one starts by checking the
 * ADMIN_EMAILS allowlist on the server: anyone else gets a 404 and nothing runs. Each redirects back
 * with a short notice code the page words ("taken_down", "storage_failed"…).
 */

const note = z
  .string()
  .trim()
  .max(500)
  .transform((v) => (v === '' ? null : v));

const back = (path: string, notice: string): never => redirect(`${path}?notice=${notice}` as Route);

const reportForm = z.object({ id: z.uuid(), note });

/** Take the reported item down: `policy` (410, files deleted) or `legal` (451, files quarantined). */
export async function takeDownAction(form: FormData) {
  const admin = await requirePlatformAdmin();
  const parsed = reportForm.extend({ basis: z.enum(['policy', 'legal']) }).safeParse(Object.fromEntries(form));
  if (!parsed.success) return back('/admin/reports', 'invalid');
  const result = await takeDownReport(admin.userId, parsed.data.id, parsed.data.basis, parsed.data.note);
  revalidatePath('/admin', 'layout');
  return back('/admin/reports', result.ok ? 'taken_down' : result.error);
}

export async function dismissAction(form: FormData) {
  const admin = await requirePlatformAdmin();
  const parsed = reportForm.safeParse(Object.fromEntries(form));
  if (!parsed.success) return back('/admin/reports', 'invalid');
  const result = await dismissReport(admin.userId, parsed.data.id, parsed.data.note);
  revalidatePath('/admin', 'layout');
  return back('/admin/reports', result.ok ? 'dismissed' : result.error);
}

/** Escalate for a legal or trust decision; with "hide meanwhile" the item is taken out of service, files quarantined. */
export async function escalateAction(form: FormData) {
  const admin = await requirePlatformAdmin();
  const parsed = reportForm.safeParse(Object.fromEntries(form));
  if (!parsed.success) return back('/admin/reports', 'invalid');
  const result = await escalateReport(admin.userId, parsed.data.id, parsed.data.note, form.get('hold') === 'on');
  revalidatePath('/admin', 'layout');
  return back('/admin/reports', result.ok ? 'escalated' : result.error);
}

const costForm = z.object({
  month: z.string().transform((v) => parseMonthKey(v)),
  // Dollars, as typed: "1234.56". Stored as whole cents.
  amount: z
    .string()
    .trim()
    .regex(/^\d{1,9}(\.\d{1,2})?$/)
    .transform((v) => Math.round(Number(v) * 100)),
  note,
});

/** The month's cloud bill (no billing integration): the numerator of cost per active operator. */
export async function saveCostAction(form: FormData) {
  const admin = await requirePlatformAdmin();
  const parsed = costForm.safeParse(Object.fromEntries(form));
  if (!parsed.success || !parsed.data.month) return back('/admin', 'cost_invalid');
  await saveMonthlyBill({
    month: parsed.data.month,
    amountCents: parsed.data.amount,
    note: parsed.data.note,
    actorUserId: admin.userId,
  });
  revalidatePath('/admin');
  return back('/admin', 'cost_saved');
}

export async function deleteCostAction(form: FormData) {
  const admin = await requirePlatformAdmin();
  const month = parseMonthKey(String(form.get('month') ?? ''));
  if (!month) return back('/admin', 'cost_invalid');
  await deleteMonthlyBill(month, admin.userId);
  revalidatePath('/admin');
  return back('/admin', 'cost_removed');
}
