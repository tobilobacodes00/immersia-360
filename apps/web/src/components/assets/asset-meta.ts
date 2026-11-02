import { formatBytes, formatClock } from '@/lib/format';
import type { AssetView } from '@/server/assets';

/** "3.1 MB · 1080 × 1920 · 0:07": what an operator needs to tell similar assets apart. */
export function describeAsset(asset: AssetView, locale: string, prefix?: string): string {
  return [
    prefix,
    formatBytes(asset.bytes, locale),
    asset.width && asset.height ? `${asset.width} × ${asset.height}` : null,
    asset.durationMs !== null ? formatClock(asset.durationMs) : null,
  ]
    .filter(Boolean)
    .join(' · ');
}
