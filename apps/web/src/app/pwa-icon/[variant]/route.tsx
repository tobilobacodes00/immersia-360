import { notFound } from 'next/navigation';
import { brandIcon } from '@/lib/brand-icon';

const VARIANTS = {
  '192': { size: 192, maskable: false },
  '512': { size: 512, maskable: false },
  '512-maskable': { size: 512, maskable: true },
} as const;

export const dynamic = 'force-static';
export const dynamicParams = false;

export function generateStaticParams() {
  return Object.keys(VARIANTS).map((variant) => ({ variant }));
}

export async function GET(_: Request, { params }: { params: Promise<{ variant: string }> }) {
  const { variant } = await params;
  const v = VARIANTS[variant as keyof typeof VARIANTS];
  if (!v) notFound();
  return brandIcon(v.size, { maskable: v.maskable });
}
