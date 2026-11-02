import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { SHORT_CODE_LENGTH } from '@immersia/shared/ids';
import { pairingChars } from './pairing';
import { PairingScreen } from './PairingScreen';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('tv.pair');
  // The pairing link carries a one-time code: never send it on to another site.
  return { title: t('metaTitle'), robots: { index: false, follow: false }, referrer: 'no-referrer' };
}

/**
 * Screen 24: pairing a TV (LIV-1). Six characters typed, or `?code=` from the pairing QR on the
 * operator's control page, which pairs at once. No login on the TV.
 */
export default async function TvPage({ searchParams }: { searchParams: Promise<{ code?: string | string[] }> }) {
  const { code } = await searchParams;
  const raw = Array.isArray(code) ? code[0] : code;
  return <PairingScreen initialCode={pairingChars(raw ?? '').slice(0, SHORT_CODE_LENGTH)} />;
}
