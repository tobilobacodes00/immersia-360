'use server';

import { after } from 'next/server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { fail, ok, withOperator, type ActionResult } from '@/server/action-result';
import { dropOpenCopies, processCloudCopies, retryFailedCopies } from '@/server/cloud/copy';
import { chooseFolder, disconnect } from '@/server/cloud/integrations';
import { CLOUD_PROVIDERS } from '@/server/cloud/providers';

const provider = z.enum(CLOUD_PROVIDERS);
const folderName = z.string().trim().min(1).max(80);

/** Copies keep going in the background after the response. */
const kick = () =>
  after(() =>
    processCloudCopies(5).catch((err: unknown) =>
      console.error('[cloud-copy] could not start', err instanceof Error ? err.name : err),
    ),
  );

/** SHR-7: disconnect a cloud. Revokes the grant, deletes the stored token, forgets copies not yet made. */
export async function disconnectIntegrationAction(input: unknown): Promise<ActionResult> {
  return withOperator({ integration: ['disconnect'] }, async (op) => {
    const p = provider.safeParse(input);
    if (!p.success) return fail('invalid');
    if (!(await disconnect(op.organizationId, p.data))) return fail('not_found');
    await dropOpenCopies(op.organizationId, p.data);
    revalidatePath('/studio', 'layout');
    return ok(undefined);
  });
}

/**
 * Point copies at a (new) folder in the operator's cloud. Failed copies whose folder had gone
 * missing are started again; `issues[0]` says why a failure happened (reauth_required, …).
 */
export async function chooseFolderAction(input: unknown, name: unknown): Promise<ActionResult> {
  return withOperator({ integration: ['connect'] }, async (op) => {
    const p = provider.safeParse(input);
    const n = folderName.safeParse(name);
    if (!p.success || !n.success) return fail('invalid');
    const res = await chooseFolder(op.organizationId, p.data, n.data);
    if (!res.ok) return fail(res.error === 'not_connected' ? 'not_found' : 'conflict', [res.error]);
    await retryFailedCopies(op.organizationId, p.data, ['folder_missing', 'folder_inaccessible']);
    kick();
    revalidatePath('/studio', 'layout');
    return ok(undefined);
  });
}

/** Start failed copies again (after freeing space, say). */
export async function retryCopiesAction(input: unknown): Promise<ActionResult<{ requeued: number }>> {
  return withOperator({ integration: ['connect'] }, async (op) => {
    const p = provider.safeParse(input);
    if (!p.success) return fail('invalid');
    const requeued = await retryFailedCopies(op.organizationId, p.data);
    if (requeued > 0) kick();
    revalidatePath('/studio', 'layout');
    return ok({ requeued });
  });
}
