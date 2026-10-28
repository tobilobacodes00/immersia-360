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
  transpilePackages: [
    '@immersia/ui',
    '@immersia/shared',
    '@immersia/i18n',
    '@immersia/db',
    '@immersia/capture',
    '@immersia/offline',
    '@immersia/layout',
  ],
  typedRoutes: true,
  env: {
    // Cache-busts public/workers/*.js per deploy (see src/lib/workers.ts).
    NEXT_PUBLIC_BUILD_ID: process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.GITHUB_SHA ?? 'dev',
  },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
  // DL-2 short domain (optional): its root is the code form and `/{code}` looks the code up.
  async rewrites() {
    const short = process.env.NEXT_PUBLIC_SHORT_ORIGIN;
    if (!short) return [];
    const has = [{ type: 'host' as const, value: new URL(short).host }];
    return {
      beforeFiles: [
        { source: '/', has, destination: '/c' },
        { source: '/:code([2-9A-Za-z]{3}-?[2-9A-Za-z]{3})', has, destination: '/c/:code' },
      ],
      afterFiles: [],
      fallback: [],
    };
  },
};

export default withSerwist(withNextIntl(config));
