'use server';

import type { Route } from 'next';
import { redirect } from 'next/navigation';
import { resolveCode } from '@/server/codes';

/** The code form (DL-2): straight to the guest's files, or back to the form with the reason. */
export async function findCode(formData: FormData) {
  const input = String(formData.get('code') ?? '').slice(0, 32);
  const result = await resolveCode(input);
  if ('linkId' in result) redirect(`/s/${result.linkId}?r=code` as Route);
  redirect(`/c?e=${result.error}&code=${encodeURIComponent(input)}` as Route);
}
