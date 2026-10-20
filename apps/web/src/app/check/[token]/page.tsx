import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { CheckCircle2, TriangleAlert } from 'lucide-react';
import { BrandMark } from '@immersia/ui';
import { allow, clientIp } from '@/server/rate-limit';
import { recordQrScan } from '@/server/setup-check';

export const metadata: Metadata = { title: 'QR check', robots: { index: false, follow: false } };

/**
 * HLP-1: what a phone sees after scanning the setup check's test QR. Opening the page is the scan:
 * the booth that is waiting for it moves on. No sign-in, nothing about the event or a guest.
 */
export default async function QrCheckPage({ params }: { params: Promise<{ token: string }> }) {
  const [{ token }, t] = await Promise.all([params, getTranslations('check.scan')]);
  const result = (await allow('setupCheckScanPerIp', await clientIp())) ? await recordQrScan(token) : 'invalid';
  const ok = result === 'scanned';
  const Icon = ok ? CheckCircle2 : TriangleAlert;
  return (
    <main id="main" className="grid min-h-dvh place-items-center px-4 py-10">
      <div className="card w-full max-w-sm p-8 text-center">
        <BrandMark size={36} className="mx-auto" />
        <Icon className={`mx-auto mt-6 size-10 ${ok ? 'text-ok' : 'text-warn'}`} aria-hidden />
        <h1 className="mt-4 text-2xl font-bold tracking-[-0.02em]">{t(`${result}.title`)}</h1>
        <p role="status" className="mt-2 text-sm leading-relaxed text-muted">
          {t(`${result}.body`)}
        </p>
      </div>
    </main>
  );
}
