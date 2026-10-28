/**
 * Which stored assets an event's media settings may point at (screen 5, the editor). The server checks
 * every reference against the organization's own library before saving (apps/web/src/server/events.ts);
 * the rules live here, free of the database, so they are one definition that is also tested on its own.
 */
import { assetMediaKind } from './asset';
import type { Background, BoothMode } from './event';

/** An asset as the database returns it for the check. */
export interface AssetRow {
  id: string;
  type: string;
  mime: string;
}

/** One reference in a patch: the asset, the field it came from (reported on failure) and what it accepts. */
export interface AssetRef {
  id: string;
  field: string;
  accepts: (asset: AssetRow) => boolean;
}

/**
 * CAP-10: an asset can be a booth's background if it is a `background` asset that the booth can draw. A
 * photo booth composites stills, so it takes pictures only; the 360 booth also takes video, which plays
 * behind the guest in step with the take.
 */
export function backgroundAssetFits(booth: BoothMode, asset: Pick<AssetRow, 'type' | 'mime'>): boolean {
  if (asset.type !== 'background') return false;
  const kind = assetMediaKind(asset.mime);
  return kind === 'image' || (booth === 'video360' && kind === 'video');
}

/** The fields of a media patch that refer to assets. */
export interface MediaRefsPatch {
  introAssetId?: string | null | undefined;
  outroAssetId?: string | null | undefined;
  music?: { assetId: string } | null | undefined;
  /** The 360 booth's background. */
  background?: Background | undefined;
  /** The photo booth's background. */
  photoBackground?: Background | undefined;
}

const ofType =
  (...types: string[]) =>
  (asset: AssetRow) =>
    types.includes(asset.type);

/** Every asset reference a patch makes, with the kind of asset each must be. Unset and null make none. */
export function mediaAssetRefs(patch: MediaRefsPatch): AssetRef[] {
  const refs: AssetRef[] = [];
  if (patch.introAssetId) refs.push({ id: patch.introAssetId, field: 'introAssetId', accepts: ofType('intro') });
  if (patch.outroAssetId) refs.push({ id: patch.outroAssetId, field: 'outroAssetId', accepts: ofType('outro') });
  if (patch.music) refs.push({ id: patch.music.assetId, field: 'music', accepts: ofType('audio') });
  if (patch.background && 'assetId' in patch.background)
    refs.push({
      id: patch.background.assetId,
      field: 'background',
      accepts: (a) => backgroundAssetFits('video360', a),
    });
  if (patch.photoBackground && 'assetId' in patch.photoBackground)
    refs.push({
      id: patch.photoBackground.assetId,
      field: 'photoBackground',
      accepts: (a) => backgroundAssetFits('photo', a),
    });
  return refs;
}

/**
 * The fields whose asset is not acceptable. `rows` are the assets found for the organization (ready and
 * not deleted); a reference with no row, someone else's asset included, fails like a wrong type does.
 */
export function unmetAssetRefs(refs: readonly AssetRef[], rows: readonly AssetRow[]): string[] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  return refs
    .filter((ref) => {
      const row = byId.get(ref.id);
      return !row || !ref.accepts(row);
    })
    .map((ref) => ref.field);
}
