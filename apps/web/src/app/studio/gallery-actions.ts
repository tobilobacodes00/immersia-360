'use server';

import { z } from 'zod';
import { fail, ok, withOperator, type ActionResult } from '@/server/action-result';
import { setGalleryPassword } from '@/server/gallery';

/** SHR-5: set, change or remove the client gallery's password (at least 6 characters). */
export async function setGalleryPasswordAction(eventId: string, password: string | null): Promise<ActionResult> {
  return withOperator({ event: ['update'] }, async (op) => {
    const pw = password === null ? null : z.string().min(6).max(200).safeParse(password);
    if (!z.uuid().safeParse(eventId).success || (pw && !pw.success)) return fail('invalid');
    return (await setGalleryPassword(op.organizationId, eventId, pw ? pw.data! : null))
      ? ok(undefined)
      : fail('not_found');
  });
}
