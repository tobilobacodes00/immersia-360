'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { ASSET_TYPES, type AssetType } from '@immersia/shared';
import { fail, ok, withOperator, type ActionResult } from '@/server/action-result';
import {
  completeAssetUpload,
  createAssetUpload,
  deleteAsset,
  listAssets,
  renameAsset,
  type AssetUploadTicket,
  type AssetUsage,
  type AssetView,
} from '@/server/assets';

const id = z.uuid();
const typeFilter = z.array(z.enum(ASSET_TYPES)).max(ASSET_TYPES.length).optional();

export async function listAssetsAction(types?: AssetType[]): Promise<ActionResult<AssetView[]>> {
  return withOperator({ asset: ['read'] }, async (op) => {
    const parsed = typeFilter.safeParse(types);
    if (!parsed.success) return fail('invalid');
    return ok(await listAssets(op.organizationId, parsed.data));
  });
}

/** Step 1 of an upload: validates the file's declared type and size and returns a presigned PUT. */
export async function createAssetUploadAction(input: unknown): Promise<ActionResult<AssetUploadTicket>> {
  return withOperator({ asset: ['create'] }, (op) => createAssetUpload(op, input));
}

/** Step 2: checks the stored object really is what was declared, then makes the asset usable. */
export async function completeAssetUploadAction(assetId: string): Promise<ActionResult<AssetView>> {
  return withOperator({ asset: ['create'] }, async (op) => {
    if (!id.safeParse(assetId).success) return fail('invalid');
    const res = await completeAssetUpload(op, assetId);
    if (res.ok) revalidatePath('/studio/assets');
    return res;
  });
}

export async function renameAssetAction(assetId: string, name: string): Promise<ActionResult> {
  return withOperator({ asset: ['create'] }, async (op) => {
    const n = z.string().trim().min(1).max(120).safeParse(name);
    if (!id.safeParse(assetId).success || !n.success) return fail('invalid');
    const res = await renameAsset(op, assetId, n.data);
    if (res.ok) revalidatePath('/studio/assets');
    return res;
  });
}

/** Refuses (deleted: false) while an event or template still uses the asset, and says which. */
export async function deleteAssetAction(
  assetId: string,
): Promise<ActionResult<{ deleted: boolean; usedBy: AssetUsage[] }>> {
  return withOperator({ asset: ['delete'] }, async (op) => {
    if (!id.safeParse(assetId).success) return fail('invalid');
    const res = await deleteAsset(op, assetId);
    if (res.ok && res.data.deleted) revalidatePath('/studio/assets');
    return res;
  });
}
