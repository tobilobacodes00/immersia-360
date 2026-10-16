import type { NextConfig } from 'next';
import { withSerwist } from '@serwist/turbopack';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Frame-Options', value: 'DENY' },
  // Camera/mic only for our own origin (booth capture); everything else off.
  {
    key: 'Permissions-Policy',
    value:
      'camera=(self), microphone=(self), fullscreen=(self), screen-wake-lock=(self), geolocation=(), payment=(), usb=(self), bluetooth=(self)',
  },
];

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Workspace packages ship TypeScript source; Next compiles them.
  transpilePackages: ['@immersia/ui', '@immersia/shared', '@immersia/i18n', '@immersia/db'],
  typedRoutes: true,
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default withSerwist(withNextIntl(config));
