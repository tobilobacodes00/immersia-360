import { brandIcon } from '@/lib/brand-icon';

export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

export default function AppleIcon() {
  // iOS rounds the corners itself, so the tile fills the square like a maskable icon.
  return brandIcon(180, { maskable: true });
}
