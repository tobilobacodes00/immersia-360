import { Clapperboard, Images, Layers, Music, Stamp, Type, type LucideIcon } from 'lucide-react';
import { ASSET_RULES, type AssetType } from '@immersia/shared';

export type AssetGroupId = 'overlays' | 'intros' | 'music' | 'fonts' | 'logos' | 'backgrounds';

export interface AssetGroup {
  id: AssetGroupId;
  /** The library tab: the asset types it lists. Groups with two types ask which one on upload. */
  types: readonly [AssetType, ...AssetType[]];
  icon: LucideIcon;
}

export const ASSET_GROUPS: Record<AssetGroupId, AssetGroup> = {
  overlays: { id: 'overlays', types: ['overlay', 'layout'], icon: Layers },
  intros: { id: 'intros', types: ['intro', 'outro'], icon: Clapperboard },
  music: { id: 'music', types: ['audio'], icon: Music },
  fonts: { id: 'fonts', types: ['font'], icon: Type },
  logos: { id: 'logos', types: ['logo'], icon: Stamp },
  backgrounds: { id: 'backgrounds', types: ['background'], icon: Images },
};

export const ASSET_GROUP_ORDER: readonly AssetGroupId[] = [
  'overlays',
  'intros',
  'music',
  'fonts',
  'logos',
  'backgrounds',
];

/** File extensions to offer in the picker: operating systems don't map every MIME type (fonts, m4a). */
const EXTENSIONS: Record<string, string[]> = {
  'image/png': ['.png'],
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/webp': ['.webp'],
  'video/mp4': ['.mp4', '.m4v'],
  'video/quicktime': ['.mov'],
  'video/webm': ['.webm'],
  'audio/mpeg': ['.mp3'],
  'audio/mp4': ['.m4a'],
  'audio/aac': ['.aac'],
  'audio/wav': ['.wav'],
  'font/woff2': ['.woff2'],
  'font/woff': ['.woff'],
  'font/ttf': ['.ttf'],
  'font/otf': ['.otf'],
};

/** The `accept` attribute for a file input. Only a hint: the bytes decide what is really accepted. */
export function acceptFor(types: readonly AssetType[]): string {
  const mimes = new Set(types.flatMap((t) => ASSET_RULES[t].mimes));
  return [...mimes].flatMap((m) => [m, ...(EXTENSIONS[m] ?? [])]).join(',');
}
