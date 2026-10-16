import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import localFont from 'next/font/local';
import { Instrument_Serif } from 'next/font/google';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getTranslations } from 'next-intl/server';
import { ServiceWorker } from '@/components/ServiceWorker';
import './globals.css';

// Satoshi is self-hosted (offline booths, and no third-party requests from guest pages).
const satoshi = localFont({
  src: [
    { path: '../fonts/Satoshi-Variable.woff2', weight: '300 900', style: 'normal' },
    { path: '../fonts/Satoshi-VariableItalic.woff2', weight: '300 900', style: 'italic' },
  ],
  variable: '--font-satoshi',
  display: 'swap',
});

// next/font/google downloads at build time and serves from our origin: no Google request at runtime.
const instrumentSerif = Instrument_Serif({
  weight: '400',
  style: ['normal', 'italic'],
  subsets: ['latin', 'latin-ext'],
  variable: '--font-instrument-serif',
  display: 'swap',
});

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('meta');
  return {
    title: { default: 'Immersia 360', template: '%s · Immersia 360' },
    description: t('description'),
    applicationName: 'Immersia 360',
    appleWebApp: { capable: true, title: 'Immersia 360', statusBarStyle: 'default' },
    formatDetection: { telephone: false, email: false, address: false },
  };
}

export const viewport: Viewport = {
  themeColor: '#f7f6f2',
  colorScheme: 'light',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = await getLocale();
  return (
    <html lang={locale} className={`${satoshi.variable} ${instrumentSerif.variable}`}>
      <body>
        <NextIntlClientProvider>
          <ServiceWorker>{children}</ServiceWorker>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
